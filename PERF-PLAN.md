# canvas-editor — Fast-typing Latency: Root Cause & Refactor Plan

> Scope: research the cause of typing-input lag and propose a concrete plan,
> including a "mass refactor" path if warranted.
>
> Anchored entirely on the current source. Every claim links to file:line.

---

## TL;DR

When a user types a key, the editor **synchronously re-lays-out the entire
document and re-renders all visible pages on every single keystroke**, with
no rAF coalescing, no incremental layout, and no input batching.

For a small document this is ~free; for a few-page document the cumulative
cost of `computeRowList` + `computePositionList` + `_drawPage`(× visible
pages) easily exceeds the 16 ms / 8 ms / 4 ms budget you have between
keystrokes when typing fast (60-150 wpm) — so keystrokes pile up in the
event queue and the visible characters trail the keyboard.

The single highest-leverage change is **coalescing layout + paint into one
`requestAnimationFrame` per frame** (turning N keystrokes/frame into 1
layout pass instead of N). After that, the next-largest wins are:

1. **Incremental rowList / positionList** — only the affected paragraph
   between the last "hard break" before `curIndex` and the next one needs
   recompute; everything outside can be re-used and shifted.
2. **Drop synchronous history cloning on the hot path** — `submitHistory`
   does 9 deep-clones of the document on history boundaries. Snapshot a
   diff/patch instead of full clones, or schedule the clone on idle.
3. **Stop creating a throwaway `<canvas>` inside `computeRowList`** every
   call (line 1503).

Below: evidence, then a phased plan from "small surgical wins" to "mass
refactor".

---

## 1. Evidence — what runs on each keystroke

### 1.1 Critical path: keystroke → render

A keystroke from the hidden `textarea` agent
([src/editor/core/cursor/CursorAgent.ts:21-38](src/editor/core/cursor/CursorAgent.ts#L21-L38))
flows like this:

```
oninput
  └── CanvasEvent.input(data)                 (CanvasEvent.ts:188)
        └── handlers/input.ts:input(data, host)
              ├── splitText / formatElementContext   (input.ts:34, 98)
              ├── draw.spliceElementList(...)         (input.ts:96, 101)
              └── draw.render({ curIndex,
                                isSubmitHistory: !isComposing })   (input.ts:106)
```

`render` at [src/editor/core/draw/Draw.ts:3098-3247](src/editor/core/draw/Draw.ts#L3098-L3247)
is fully synchronous. With `isCompute=true` (default) it does, in order:

| Step | What | Cost | File:Line |
|------|------|------|-----------|
| 1 | header/footer compute (paging mode) | O(header+footer elements) | [Draw.ts:3128-3134](src/editor/core/draw/Draw.ts#L3128-L3134) |
| 2 | **`this.rowList = this.computeRowList(...)`** — full document re-flow | **O(N elements)** + canvas measure calls | [Draw.ts:3138](src/editor/core/draw/Draw.ts#L3138) |
| 3 | `_computePageList()` — pagination | O(R rows) | [Draw.ts:3149](src/editor/core/draw/Draw.ts#L3149) |
| 4 | `position.computePositionList()` — positions for cursor/click | O(N) | [Draw.ts:3151](src/editor/core/draw/Draw.ts#L3151), [Position.ts:300](src/editor/core/position/Position.ts#L300) |
| 5 | `area.compute()` | O(areas) | [Draw.ts:3153](src/editor/core/draw/Draw.ts#L3153) |
| 6 | search/control highlight compute | O(N) when active | [Draw.ts:3158-3161](src/editor/core/draw/Draw.ts#L3158-L3161) |
| 7 | paint pages — `_lazyRender` (paging) or `_immediateRender` (continuous) | O(visible pages × elements/page) | [Draw.ts:3189-3193](src/editor/core/draw/Draw.ts#L3189-L3193) |
| 8 | `setCursor(curIndex)` | O(1) | [Draw.ts:3196](src/editor/core/draw/Draw.ts#L3196) |
| 9 | `submitHistory(curIndex)` if `isSubmitHistory` | **9× `deepClone` / `getSlimCloneElementList`** of the whole doc | [Draw.ts:3202-3206, 3288-3315](src/editor/core/draw/Draw.ts#L3288-L3315) |
| 10 | `nextTick(...)` listener fan-out (`contentChange`, etc.) | mostly debounced in demo | [Draw.ts:3209-3246](src/editor/core/draw/Draw.ts#L3209-L3246) |

So an N-element document pays O(N) work at steps **2, 3, 4, 6, 7, and (on
boundaries) 9** for *every keystroke*.

### 1.2 `computeRowList` — the dominant cost

[Draw.ts:1483-2274](src/editor/core/draw/Draw.ts#L1483-L2274) — ~790 lines.
For each call it:

* creates a fresh `<canvas>` + `getContext('2d')` ([Draw.ts:1503](src/editor/core/draw/Draw.ts#L1503)) — small but pure waste once per keystroke;
* re-computes list-style offsets for the whole list ([Draw.ts:1506](src/editor/core/draw/Draw.ts#L1506));
* loops every element ([Draw.ts:1535](src/editor/core/draw/Draw.ts#L1535)) and:
  * for `TEXT`, calls `textParticle.measureText` ([Draw.ts:1979](src/editor/core/draw/Draw.ts#L1979));
  * for `BREAK_WORD`, additionally `measureWord` + `measurePunctuationWidth` ([Draw.ts:2053, 2066](src/editor/core/draw/Draw.ts#L2053));
  * for `TABLE`, **recursively** calls `computeRowList` per cell ([Draw.ts:1692](src/editor/core/draw/Draw.ts#L1692)) and runs nested pagination ([Draw.ts:1823-1844](src/editor/core/draw/Draw.ts#L1823-L1844));
  * computes wrap / surround / page-column transitions inline.

**Caching that already exists** — `TextParticle.measureText` memoises by
`element.value + ctx.font` ([TextParticle.ts:106-113](src/editor/core/draw/particle/TextParticle.ts#L106-L113)).
That's why the per-glyph cost is bearable in steady state. The cost that
*scales with N* is everything else: re-creating `IRow[]`, re-computing
list/page/column transitions, allocating `IRow.elementList` arrays.

### 1.3 Position list

[Position.ts:300-329](src/editor/core/position/Position.ts#L300-L329) clears
`this.positionList = []` and rebuilds it page-by-page. Inside,
`computePageRowPosition` ([Position.ts:110-298](src/editor/core/position/Position.ts#L110-L298))
also does a `deepClone(row)` per row in some paths
([Position.ts:339](src/editor/core/position/Position.ts#L339)) — i.e. every
keystroke allocates a full clone of every row object.

### 1.4 History on boundaries

[Draw.ts:3288-3315](src/editor/core/draw/Draw.ts#L3288-L3315) — `submitHistory`:

```ts
const oldElementList = getSlimCloneElementList(this.elementList)        // (1)
const oldHeaderElementList = getSlimCloneElementList(...header)          // (2)
const oldFooterElementList = getSlimCloneElementList(...footer)          // (3)
const oldRange = deepClone(this.range.getRange())                       // (4)
const oldPositionContext = deepClone(positionContext)                   // (5)
this.historyManager.execute(() => {
  // captured closure runs another 4 deepClones to take the *current*
  // snapshot before restoring the old one:
  const curPositionContext  = deepClone(...)                            // (6)
  const curHeaderElementList = deepClone(...)                           // (7)
  const curFooterElementList = deepClone(...)                           // (8)
  const curElementList       = deepClone(...)                           // (9)
  const curRange             = deepClone(...)
})
```

This isn't run *every* keystroke — `isSubmitHistory` is `false` while
`isComposing` ([input.ts:108](src/editor/core/event/handlers/input.ts#L108))
— but it runs on every Enter/Backspace/Delete/Tab/space-after-IME-end and
in many command paths. With `structuredClone` available it's still O(total
element-tree bytes) per call.

`getSlimCloneElementList` only omits `metrics` and `style`
([utils/element.ts:1815-1820](src/editor/utils/element.ts#L1815-L1820)) —
it still walks the whole list.

### 1.5 What does **not** run on the keystroke path (so we can stop worrying)

* **Workers** (word count, catalog, group, value) are only invoked on
  explicit commands — never automatically on input
  ([WorkerManager.ts](src/editor/core/worker/WorkerManager.ts), call sites
  are in `src/main.ts` only).
* **`contentChange` listener** in the demo is debounced 200 ms
  ([src/main.ts:2437](src/main.ts#L2437)). The library itself fires it via
  `nextTick(setTimeout 0)` ([utils/index.ts:211-215](src/editor/utils/index.ts#L211-L215))
  so it doesn't block the keystroke microtask, only the next macrotask.
* No MutationObserver / no per-keystroke serialization in the library
  itself; `JSON.stringify(getValue())` is only on Ctrl+S
  ([handlers/keydown/index.ts:67-72](src/editor/core/event/handlers/keydown/index.ts#L67-L72)).
* Image / Selection / Mouse observers don't fire on keyboard input.

### 1.6 What's missing from the perf toolbox

* **No `requestAnimationFrame` batching** anywhere on the input/render
  path. `rAF` is only used inside `SelectionObserver`
  ([SelectionObserver.ts:133](src/editor/core/observer/SelectionObserver.ts#L133)).
* **No debounce/throttle** on `render` or `computeRowList`.
* **No incremental reflow.** `computeRowList` always starts at element 0.
* **No dirty tracking.** There's no `dirtyStartIndex` / `dirtyEndIndex`
  signal flowing into `render`.
* **Throwaway `<canvas>`** is created inside `computeRowList`
  ([Draw.ts:1503](src/editor/core/draw/Draw.ts#L1503)) instead of reusing a
  long-lived measurement canvas.
* Some hot paths still do `deepClone` per item (e.g. row clone in
  position compute; per-cell clones in table flow at
  [Draw.ts:1859, 1865](src/editor/core/draw/Draw.ts#L1859-L1865)).

---

## 2. Why fast typing in particular is bad

When you type at e.g. 120 wpm ≈ 10 chars/s, you're issuing one keystroke
roughly every 100 ms — but key-repeat (holding a key) and bursty typing
can produce keystrokes spaced **<16 ms apart**. The current pipeline
turns each one into a synchronous reflow + repaint. So:

* If a single keystroke's reflow+paint takes 8 ms, a burst of 5
  keystrokes inside a frame consumes 40 ms — past the next vsync,
  visibly stutter.
* The IME/composition guard at
  [input.ts:21](src/editor/core/event/handlers/input.ts#L21) helps for
  CJK, but Latin typing always lands on the full-render path.
* `contentChange` fires inside `nextTick` (a macrotask) so even though
  the demo debounces it, the act of *queuing* it via `setTimeout(...,0)`
  costs a task-queue round-trip per keystroke ([utils/index.ts:211](src/editor/utils/index.ts#L211)).

---

## 3. Refactor plan

Three phases. **Phase 1** alone should remove the perceptible lag for
typical documents; phases 2-3 are for sustained perf on large docs and
for code-health.

### Phase 1 — High-leverage, low-risk (1-3 days)

These are surgical changes; no API churn.

1. **rAF-coalesce the input → render path.**
   - In `input.ts` and the keydown handlers, replace the direct
     `draw.render(...)` call with a `draw.scheduleRender(payload)` that:
     * merges payloads into a single `pendingRender` (taking the latest
       `curIndex`, OR-ing flags like `isSubmitHistory`, `isCompute`,
       carrying the smallest dirty range — see step 2);
     * schedules a single `requestAnimationFrame` callback if none is
       pending; on the callback, runs `_renderNow(merged)` and clears.
   - This alone collapses N keystrokes/frame to one full reflow.
   - Keep an immediate path (`renderSync`) for cases that need it
     (initial mount, programmatic `setValue`, print).
   - Files: [Draw.ts:3098](src/editor/core/draw/Draw.ts#L3098),
     [input.ts:106](src/editor/core/event/handlers/input.ts#L106), and
     all `draw.render(` call-sites under
     [event/handlers/](src/editor/core/event/handlers/) (~25 sites — they
     can keep the same signature).

2. **Skip `submitHistory` cloning on the hot path; commit on idle.**
   **(LANDED — Phase 1.2.)**
   - `submitHistory` now dispatches between two paths
     ([Draw.ts:`submitHistory` / `_submitDeltaHistory` / `_submitSnapshotHistory`](src/editor/core/draw/Draw.ts)):
     * **Delta path** (taken when *all* of: pending mutations exist,
       all are scope=`main`, no `_deltaHistoryUnsafe` flag, history
       stack non-empty). Pushes a `{ applyForward, applyBackward }`
       pair. Each function replays the captured `IMutationEvent[]`
       against `this.elementList` (forward = original splices in
       order, backward = inverse splices in reverse) inside an
       `_isReplayingHistory = true` guard so nested mutations do
       not re-enter the delta accumulator. Only ranged metadata
       (`range / positionContext / pageNo / zone`) is `deepClone`d —
       no full-document clone ever happens for typing.
     * **Snapshot path** (legacy, preserved verbatim — 9× `deepClone` /
       `getSlimCloneElementList`). Used when delta is unsafe:
       property-only commands (bold / italic / font / size / color /
       title — they bypass `spliceElementList`); first submit (stack
       empty); header / footer / table splices; the rare list-id
       cleanup branch in `spliceElementList`; `deletable`-rule skips
       inside delete; explicit `setEditorData` /
       `_invalidatePaintCache`.
   - **Mutation accumulator**
     ([`_pendingHistoryMutations`](src/editor/core/draw/Draw.ts)). Every
     `spliceElementList` (outside replay) pushes its `IMutationEvent`
     here. The accumulator is consumed verbatim by the delta path and
     discarded by the snapshot path; in both cases reset to empty
     after `submitHistory` returns. The `removedSnapshot` slice is now
     captured unconditionally on `deleteCount > 0` (was previously
     only when external mutation listeners existed) — needed for
     correct backward replay.
   - **Safety guards**:
     * `_deltaHistoryUnsafe` flag flips true the moment any path
       cannot be losslessly described by a sequence of main-scope
       splices. `_invalidatePaintCache` also flips it so big-bang
       document replacement (`setEditorData`) cleanly forces the next
       submit onto the snapshot path.
     * `IElement.id` is stamped at the Mutator boundary (Phase 3A)
       which means inserted elements are reference-stable across
       redo / undo — cursor restoration after `applyForward` /
       `applyBackward` finds the right anchor.
   - **HistoryManager extension**
     ([`HistoryManager.ts:executeDelta` + discriminated stack items](src/editor/core/history/HistoryManager.ts)).
     Internal stack now holds `Function | { kind: 'delta',
     applyForward, applyBackward }`. Legacy `execute(fn)` callers are
     untouched (Function path). `undo` / `redo` dispatch on item kind:
     for snapshots, behavior matches pre-1.2 ("call new top to
     restore"); for deltas, call the corresponding apply function.
     The `executeEntry` API (Phase 3A typed-entry stream) is
     unchanged.
   - **Tests**:
     [`tests/core/history/DeltaHistory.test.ts`](tests/core/history/DeltaHistory.test.ts)
     (7 cases) covers: pending accumulator clears after every submit,
     delta-path undo/redo equivalence with snapshot path across
     multiple inserts, property-only (`bold`) command falls back to
     snapshot, `setEditorData` invalidates the accumulator, header
     splices flip the unsafe flag, and delete operations roundtrip
     correctly. The complete suite (`42 files / 266 tests`) is green.
   - **Expected effect on the user-reported 11-page / 8 331-word
     doc**: typing-batch flushes (idle every 500 ms or non-input
     command) no longer trigger ~80–150 ms of full-document
     `structuredClone`. The "sometimes fast, sometimes lagged"
     pattern — fast during burst typing, lagged on every batch
     boundary — is the classic Phase 1.2 fingerprint and disappears
     once the delta path is taken.
   - Files: [Draw.ts (submitHistory + _submitDeltaHistory)](src/editor/core/draw/Draw.ts),
     [HistoryManager.ts (executeDelta)](src/editor/core/history/HistoryManager.ts).

3. **Reuse a single measurement `<canvas>`.**
   - Make `computeRowList`'s canvas a class field
     `this._measureCanvas` / `this._measureCtx` allocated in the
     `Draw` constructor.
   - Files: [Draw.ts:1503](src/editor/core/draw/Draw.ts#L1503).

4. **Drop the per-row `deepClone` in position compute.**
   - [Position.ts:339](src/editor/core/position/Position.ts#L339) — see
     why it clones; in most paths it's used to detach a row reference.
     Most callers can take a structured pointer instead. Where a clone
     is genuinely needed, prefer a hand-rolled shallow copy of just
     the fields read downstream.

5. **Replace `nextTick` macrotask with `queueMicrotask`** for
   intra-render callbacks where ordering allows
   ([utils/index.ts:211](src/editor/utils/index.ts#L211),
   [Draw.ts:3209](src/editor/core/draw/Draw.ts#L3209)). Cuts one
   task-queue round-trip per render.

**Expected effect of Phase 1**: typing latency dominated by *one*
`computeRowList` per frame (≈16 ms target). Bursts no longer stack.
History no longer stalls hot keys.

### Phase 2 — Incremental layout (1-2 weeks)

Make `computeRowList` *incremental* so per-keystroke cost stops being
O(N).

The shape:

```
computeRowList({ dirtyStart, dirtyEnd })
  ├── find the "stable boundary" before dirtyStart:
  │     walk back to nearest hard line break (\n / new paragraph /
  │     row.startIndex of the row that owns dirtyStart)
  ├── reuse rowList[0..rowBeforeBoundary] as-is
  ├── recompute rows from boundary forward
  ├── stop early when:
  │     (a) the produced row layout matches the pre-existing rows
  │         (same startIndex, same width/height/x/y, same elementList
  │         identity); AND
  │     (b) we are past dirtyEnd; AND
  │     (c) page-column / page-break state matches.
  └── splice the recomputed prefix into the old rowList
```

Concrete steps:

1. **Track a dirty range on every mutation point.**
   `spliceElementList(elementList, start, deleteCount, items)` records
   `(start, start + items.length)` as `Draw._dirtyRange` and merges
   with any pending range. Same in `formatElementContext`.

2. **Refactor `computeRowList`** to accept `{ startElementIndex,
   stableRowState }` and return `{ rows, lastTouchedElementIndex,
   stable }`. Re-laying-out from element 0 stays the fallback. The
   bulk of the function (lines 1535-2274) becomes the body of a
   `_layoutSegment` private method that runs on a *slice*.

3. **Position list incremental update.**
   `computePositionList` ([Position.ts:300](src/editor/core/position/Position.ts#L300))
   gets `recomputeFrom(rowIndex)` — keep prior positions for rows
   before the boundary; only walk rows after.

4. **Paint only invalidated pages.** `_immediateRender`
   ([Draw.ts:3085-3096](src/editor/core/draw/Draw.ts#L3085-L3096))
   currently redraws every page; the lazy path already uses
   `IntersectionObserver`. Add a `dirtyPages: Set<number>` that
   `render` populates from the affected row range, and only call
   `_drawPage` for those.

5. **Tables.** Recursive `computeRowList` for tables
   ([Draw.ts:1692](src/editor/core/draw/Draw.ts#L1692)) is the worst
   case. When the dirty range falls inside a single cell, only that
   cell's inner `computeRowList` should re-run.

Risk: this is the area most likely to introduce subtle bugs (off-by-one
on row boundaries; pagination drift). Mitigate with a hidden
dev-mode "validate full vs incremental" check that runs both paths and
diffs the result on every Nth keystroke.

**Expected effect of Phase 2**: per-keystroke cost decoupled from
document size. A 100-page doc edits as fast as a 1-page doc.

#### Phase 2 implementation status

Landed (Phase **2A**):

* §2.1 **Dirty-range tracking**. `Draw._dirtyRange`, public
  `markDirty(start, end)` / `getDirtyRange()` / `clearDirtyRange()`,
  auto-marked by `spliceElementList` when mutating the main element
  list. Cleared at the end of every `render()`. Header / footer / table
  cell splices intentionally do not mark — those scopes still go
  through the full path.
* §2.4 **Dirty-page paint**. `_computeDirtyPages()` returns a
  `Set<number> | null`; `null` falls back to "paint all" and is the
  conservative default whenever there's no `_dirtyRange`, no prior
  `_prevPageRowCounts`, or `isCompute=false`. Both `_immediateRender`
  and `_lazyRender` consult the set plus a per-page `_drawnPages`
  cache so off-screen lazy pages and clean pages skip their
  `_drawPage` call. Cache is invalidated by `setEditorData` /
  `invalidatePaintCache()` / `destroy()`.
* **Zone-aware layout skip** (follow-up after Phase 2A landed). When
  the user is editing in the header or footer zone and the main
  element list has not been mutated, `render()` now skips the entire
  main layout pipeline (`computeRowList(main)`, `_computePageList()`,
  `position.computePositionList()`, `area.compute()`,
  `search/control/graffiti.compute()`). `_headerDirty` / `_footerDirty`
  flags are auto-set by `spliceElementList` for the matching scope so
  `header.compute()` / `footer.compute()` themselves only run when the
  zone is active or the corresponding scope has changed. This is the
  fix for the case where typing in a 4-page document's header would
  re-flow all main content per keystroke. Tests live in
  `tests/core/draw/ZoneSkipLayout.test.ts`.
* New `IEditorOption` field is **not** required — the optimization is
  on by default and degrades cleanly to the original behavior when
  no signal is available.
* Tests: `tests/core/draw/DirtyRange.test.ts` (10 cases) covers the
  `markDirty` API, the auto-mark via `spliceElementList`, isolation
  from header / footer mutations, render clearing the dirty hint,
  paint-cache invalidation, and the differential vs full-paint
  branches in continuous mode (lazy paging skipped because jsdom
  doesn't fire IntersectionObserver).

Landed (Phase **2B** — incremental layout):

* §2.2 **Incremental `computeRowList`**. The 790-line for-loop now
  carries a *checkpoint sink* that records the loop-local state
  (`x / y / pageNo / listId / listIndex / controlRealWidth /
  currentPageColumns / surroundElementList`) at every row boundary.
  A new `IComputeRowListPayload.resumeFrom` (typed in
  [`interface/Draw.ts`](src/editor/interface/Draw.ts) as
  `IComputeRowListResumePayload`) lets the function rebuild only the
  tail of `rowList`: it seeds the array with the unchanged prefix,
  restores the saved loop locals, and re-enters the loop at the row
  containing the dirty range. The seed-row checkpoint is captured
  before iteration zero; row checkpoints land at both row-push sites
  (page-column branch and wrap branch). Memory cost: one shallow
  object per row (~6 numbers + an empty `[]` when no surrounds), so
  ~32 KB for a 1 000-row document.
* §2.5 **Per-table-cell dirty caching**. Each `td.value` now picks up
  a hidden `_owningTd` back-reference inside the table loop in
  `computeRowList`. `spliceElementList` checks for this back-reference
  on any non-main / non-header / non-footer mutation and flips
  `td._dirty = true` on the owning cell. The next time
  `computeRowList` reaches that cell it skips the recursive call when
  `(td.rowList && !td._dirty && cacheKey matches)` and reuses
  `td.rowList` verbatim. The cache key tracks
  `(innerWidth, scale, isPagingMode)` so a paper-size or scale change
  forces recomputation. Concrete win: in a doc whose main list
  changes but tables don't, every cell turns into one `Object.assign`
  + `td.rowList` reference reuse instead of a full inner
  `computeRowList`.
* **§2.2 wiring in `render()`**. A new `_tryBuildResumeFrom()` decides
  per-frame whether to take the incremental path. Safety conditions
  (all must hold or we fall back to full): a non-null `_dirtyRange`,
  a populated `_mainRowCheckpoints`, `_mainLayoutSig` matches current
  `(scale, innerWidth, isPagingMode, defaultSize, defaultRowMargin,
  defaultTabWidth)`, and `dirtyStart` is at or after row 1 (so we
  have at least one row to keep). `_invalidatePaintCache()` clears
  both `_mainRowCheckpoints` and `_mainLayoutSig`, so any path that
  invalidates the page-paint cache also forces a full recompute next
  frame.
* **Validation harness**. The hidden `__perfValidateLayout` editor
  option, when truthy, makes `render()` run the full
  `computeRowList` again on the same input after the incremental
  path completes and `console.error`s on any per-row mismatch
  (`startIndex / rowIndex / elementList.length / width / height /
  isPageBreak / isColumnBreak`). Off in production; one of the new
  tests asserts that turning it on for a typical edit produces no
  mismatches. The harness is what makes the §2.2 refactor reviewable
  — Phase 2B's risk is mismatched layout output, and the harness
  surfaces a mismatch on the first render that would have produced
  one.
* Tests:
  [`tests/core/draw/IncrementalLayout.test.ts`](tests/core/draw/IncrementalLayout.test.ts)
  (9 cases) covers checkpoint capture / sink alignment, resume-row
  selection, prefix-row reuse by reference, the `R = 0` early-return
  fallback, `setEditorData` invalidation, byte-equal output with the
  validation harness on, header-zone safety (does not over-invalidate
  main checkpoints), and the §2.5 table-cell cache hit-count
  reduction (`5 → ≤3` recursive `computeRowList` calls on a 2×2
  table after main-only edit).

Landed (Phase **2B** — incremental positions, follow-up pass):

* §2.3 **Incremental `computePositionList`**. New
  `Position.computePositionListIncremental({ fromRowGlobalIndex,
  fromElementIndex })` truncates `positionList.length` to
  `fromElementIndex`, filters `floatPositionList` to entries with
  `position.index < fromElementIndex`, then walks `pageRowList`
  skipping pages / rows whose global row index is `< fromRowGlobalIndex`
  and resumes `computePageRowPosition` from the matching `(pageNo,
  rowK)`. For 7 441 words / 10 pages this is the next dominant cost
  after §2.2 (~30 ms of `IElementPosition` allocation per keystroke
  at the worst position) and was the lever that closes the
  user-visible delay on docs of that size.
* **Last-prefix-row mutation detection**. The §2.2 incremental
  `computeRowList` loop can extend the *last* prefix row in place
  (`curRow.elementList.push(rowElement)` when the new element fits
  there, e.g. inserting a small character at a row boundary).
  `render()` now snapshots
  `prefixRowList[len-1].elementList.length` before calling
  `computeRowList`, then compares post-call: if it changed, the
  position resume point is bumped one row earlier (re-process the
  mutated prefix row + everything after). This is the safe path that
  preserves byte-equal output even when the splice element ends up
  back-flowing into the kept prefix row.
* Tests: two new cases in
  [`tests/core/draw/IncrementalLayout.test.ts`](tests/core/draw/IncrementalLayout.test.ts)
  — (a) byte-equal positionList between full and incremental paths
  after a mid-doc splice (compares `index / pageNo / rowIndex /
  coordinate.leftTop / rightBottom` per element), (b) prefix
  `IElementPosition` references are reused (proves the truncation
  path actually keeps the prefix array slots, not just structural
  equality).
* Wiring: `render()` calls `computePositionListIncremental` only when
  the §2.2 incremental path is also taken; otherwise full
  `computePositionList`. `floatPositionList` is no longer
  unconditionally cleared on `mainNeedsCompute` — the increment path
  filters by `position.index < fromElementIndex` so prefix surrounds
  keep their entries. 41 test files / 259 tests pass.

Deferred (Phase **2B follow-ups**, lower-priority):

* **Multi-page incremental benchmark fixture**. The validation
  harness proves correctness; a wall-clock benchmark over a fixed
  N-page document (say 50) on CI would close the loop on the perf
  target ("typing in page 50 of 100 has same latency as page 1").
* **Incremental `_computePageList`**. Currently rebuilt fresh every
  render. Cheap for single-column (just walks rowList accumulating
  page heights) so unlikely to be on the hot path; deferred.
* **Incremental `area.compute()` / `control.computeHighlightList`**.
  `area.compute` is one property-check per element so ~free even at
  37 K elements (measured: <1 ms for 10-page doc).
  `computeHighlightList` is gated behind a non-empty highlight list
  and is a no-op for typical docs.

### Phase 3 — Architectural cleanups (optional, 2-3 weeks)

Worthwhile only if you also want to tame `Draw.ts` (3 337 lines) and
`CommandAdapt.ts` (3 075 lines). These are not perf wins per se, but
they make Phase 2 invariants enforceable.

1. **Split `Draw.ts` along seams that already exist:**
   - `LayoutEngine` — `computeRowList`, `_computePageList`, page-column
     normalization, paginated table flow.
   - `Renderer` — `_lazyRender`, `_immediateRender`, `drawRow`,
     highlight/underline/strikeout coordination.
   - `Mutator` — `spliceElementList`, splice-aware dirty tracking.
   - `Draw` becomes the orchestrator; it still owns the public API.

2. **Make `IElement` mutations explicit.** Today, large swaths of code
   mutate `element.metrics`, `element.style`, etc. directly. A small
   `markDirty(elementIndex)` helper makes the dirty-range bookkeeping
   trustworthy.

3. **Type the render payload properly.** `IDrawOption` is a grab-bag of
   optional flags; split into `RenderInput` (dirty info, curIndex) and
   `RenderConfig` (compute? draw? submit history? paging mode?). Keep
   the old type as a deprecated alias.

4. **Extract history into a strategy.** `HistoryManager` already takes
   functions; make the *content of those functions* a `HistoryEntry`
   tagged union (`{ kind: 'insert'|'delete'|'replace'|'snapshot', ... }`)
   so we can compress consecutive `insert`s, replay deltas, and serialize
   undo state for crash-recovery later.

#### Phase 3 implementation status

Landed (Phase **3A** — seams that unlock the rest):

* §3.2 + §6.2b **Render payload types split**.
  `IDrawOption` decomposed into `IRenderInput` (curIndex,
  remoteDirtyRange, isTextInput, anchor) and `IRenderConfig`
  (isCompute, isLazy, isSubmitHistory, isSetCursor, isInit,
  isSourceHistory, isFirstRender). `IDrawOption` survives as a
  deprecated alias `IRenderInput & IRenderConfig` so existing call
  sites keep working unchanged. Also added
  [`IAnchorPosition`](src/editor/interface/Draw.ts) (`{ afterId?,
  beforeId?, offset? }`) as a type-only stub for the CRDT-ready
  selection anchor — no consumers yet, but every place that touches
  cursor positions can incrementally migrate without a flag day.
* §3.4 **`HistoryEntry` tagged union** ([new file](src/editor/interface/History.ts)).
  Existing `HistoryManager.execute(fn)` is unchanged. New
  `executeEntry(entry: HistoryEntry)` and `onEntry(listener)` APIs
  layer a typed entry-stream on top — the entry is still pushed onto
  the function stack internally (so undo / redo behave identically),
  but subscribers see structured `{ kind: 'insert' | 'delete' |
  'replace' | 'snapshot', scope, timestamp, undo, redo, ...payload }`
  records. This is the hook a CRDT runtime / audit log / crash-recovery
  persistence subscribes to without touching core code.
* §3.1 **Mutation event seam (light)**
  ([`Draw.onMutation`](src/editor/core/draw/Draw.ts),
  [`IMutationEvent`](src/editor/interface/Mutation.ts)).
  `spliceElementList` is the de-facto Mutator boundary — every
  structural mutation goes through it. It now emits an
  `IMutationEvent { kind: 'splice', scope, start, removed, inserted }`
  to subscribers. Scope is auto-detected (`main` / `header` / `footer`
  / `table`) by reference comparison. Subscribers see "what just
  happened" without re-reading the elementList. Subscriber exceptions
  are swallowed so the mutation path is never broken by a buggy
  listener.
* §6.2a **Auto-id at Mutator boundary**.
  `spliceElementList` now stamps `item.id = getUUID()` on inserted
  elements that don't already have one. `IElement.id` stays
  *typed-as-optional* so existing fixtures and serialized documents
  keep working, but every element that flows through the Mutator
  picks up a stable id. This is the precondition for
  `HistoryEntry` deltas to reference IDs (per §6.2a) and for CRDT
  ops to address anchors deterministically.
* Tests:
  [`tests/core/draw/Phase3Seams.test.ts`](tests/core/draw/Phase3Seams.test.ts)
  (11 cases) covers the mutation event seam, scope detection, listener
  isolation from exceptions, removed-slice snapshotting, auto-id
  assignment with preset-id preservation, and the typed-history-entry
  flow (executeEntry + onEntry + isCanUndo bookkeeping).

Deferred (Phase **3B**, future work):

* §3.1 **Physical class split** (`Draw.ts` → `LayoutEngine` /
  `Renderer` / `Mutator` / orchestrator). Mostly mechanical churn
  touching hundreds of `getDraw().*` call sites across `core/`,
  `command/`, particle / control / frame subsystems, and tests.
  Doesn't add behavior — the *load-bearing* parts of the split
  (mutation events, typed history entries, payload split, auto-id)
  all landed in 3A and are usable today. Worthwhile as a code-health
  PR after CRDT integration is up because by then we'll know which
  exact methods need to be on the Mutator's public face.
* §3.3 **Element-level `markDirty(elementIndex)`** for in-place
  mutations of `element.metrics` / `element.style`. Today these go
  unannounced; Phase 2A's `_dirtyRange` only covers `spliceElementList`.
  Adding this would let dirty-page paint catch style-only edits too
  (rare on the typing hot path, so deferred).
* §6.2b consumer wiring for `IAnchorPosition`. Type stub landed, but
  `RangeManager.setRange` / `getRange` still take indices. Wiring the
  index ↔ anchor conversion at the boundary is straightforward once
  there's a CRDT runtime to anchor against; doing it before that has
  no observable effect.

**Why 3B is deferred**: 3A's seams are the *integration points* the
plan really needs. The class split is a code-organization win
without runtime effects, and is best done together with the work it
enables (the CRDT integration itself), not as a precondition.

---

## 4. Suggested order of work / acceptance criteria

| # | Change | Acceptance |
|---|--------|------------|
| P1.1 | rAF-coalesce render | hold a key — reflow runs ≤1×/frame in devtools profile |
| P1.2 | delta-based history | typing 1 000 chars produces ≤1 ms total in `submitHistory` |
| P1.3 | reuse measure canvas | no per-keystroke `<canvas>` in heap snapshot diff |
| P1.4 | drop position-row deepClone | `computePositionList` self time halved on large doc |
| P1.5 | microtask `nextTick` | per-render task-queue overhead gone |
| P2.1 | dirty-range tracking | `spliceElementList` callers all flow into one signal |
| P2.2 | incremental `computeRowList` | typing in page 50 of 100 has same latency as page 1 |
| P2.3 | incremental positions | same |
| P2.4 | dirty-page paint | only the active page's canvas redraws on input |
| P2.5 | table-cell-local reflow | typing in one cell doesn't re-flow other cells |
| P3.\* | file splits, types, history-as-strategy | unblocks future work; no perf ask |

A simple regression harness to add (no Cypress overhead): a Vitest
benchmark that scripts 200 sequential `input` events on a 50-page
fixture and asserts a wall-clock ceiling. Run on CI on PRs touching
`Draw.ts`, `Position.ts`, `event/handlers/input.ts`,
`event/handlers/keydown/*`, `history/*`.

---

## 5. What we deliberately would *not* change

* **TextParticle.measureText cache** ([TextParticle.ts:106-113](src/editor/core/draw/particle/TextParticle.ts#L106-L113)) — already correct.
* **Worker boundaries** — workers are invoked only on explicit user
  commands, not on keystrokes. Moving more work to workers (e.g.
  layout) sounds appealing but the layout depends on a
  `CanvasRenderingContext2D` for `measureText`; doing that in a worker
  needs `OffscreenCanvas`, which works but adds a structured-clone
  cost per render that likely exceeds what's saved. Park unless
  Phase 2 measurements still aren't enough.
* **Public API.** Phase 1+2 should not change `editor.command.*` or
  the `Listener` shape. Phase 3 adds new types but keeps the old ones.

---

## 6. CRDT-readiness (collab in scope)

The plan is **structurally compatible** with CRDT-based collaboration
(Yjs / Automerge / Loro / similar) — and Phases 1.2 and 3.1 in
particular *remove* blockers that the current architecture would put in
front of any future collab work. With the four small adjustments below
(folded into the existing phases, no extra phases), it becomes
**structurally preparatory** for it. Nothing in Phase 1 or Phase 2 would
need to be undone later.

### 6.1 What's already aligned

| Plan item | Why it helps collab |
| --------- | ------------------- |
| Phase 1.1 — rAF-coalesced `scheduleRender` | Remote ops can use the same scheduler: `Network → CRDT → Mutator → scheduleRender` flows through one batched layout per frame, identical to local typing. |
| Phase 1.2 — delta-based history | CRDTs are inherently op-stream-based. A `HistoryEntry` tagged union of `insert / delete / replace` is ~80% of the shape sent over the wire. The current 9× full-document `deepClone` model ([Draw.ts:3288-3315](src/editor/core/draw/Draw.ts#L3288-L3315)) cannot reasonably project onto a CRDT runtime. |
| Phase 2.1 — dirty-range tracking | A remote op produces a localized change; the same incremental-reflow path works for it as for local input — for free. |
| Phase 2.2-2.4 — incremental layout / dirty-page paint | Pure layout. Layout always operates on a converged snapshot of the current frame; doesn't care whether ops were local or remote. |
| Phase 3.1 — `Mutator` / `LayoutEngine` / `Renderer` split | This is *the* seam for CRDTs. Without it, CRDT calls have to be sprinkled across `Draw.ts` / `CommandAdapt.ts`. With it: `Mutator → CRDTRuntime → LayoutEngine`. |
| Phase 3.4 — history as tagged-union strategy | Becomes (or feeds) the local op log a CRDT runtime subscribes to. |

### 6.2 Four adjustments to fold into the existing phases

These cost ~nothing to add *now* during the refactor and are expensive
to retrofit later.

#### (a) Phase 1.2 deltas must reference stable IDs, not raw indices

Recording `{ kind: 'insert', at: 5, items: [...] }` is fine for local
single-user undo. The moment a peer edits, "index 5" is no longer the
same position — local undo would clobber a remote insert. CRDT undo
(Yjs `UndoManager` etc.) anchors entries to op IDs.

* `IElement.id` is currently optional and sparse in the type
  ([interface/Element.ts](src/editor/interface/Element.ts)). **Make it
  mandatory at the `Mutator` boundary, assigned at insertion time**
  (uuid v7 or HLC+actorId — pick during the actual collab work, not
  now; just commit to "every element has a stable, unique id"
  invariant).
* Delta entries become:
  * `{ kind: 'insert', afterId | beforeId, items: [{id, …}] }`
  * `{ kind: 'delete', ids: [...] }`
* Layout still works off indices on the current snapshot; storage and
  replication work off IDs.

This is a strict superset of the original Phase 1.2 — same data
structure, with `id` fields populated and an alternative addressing
mode supported alongside indices.

#### (b) `RangeManager` needs anchor-based positions alongside indices

`RangeManager` ([core/range/RangeManager.ts](src/editor/core/range/RangeManager.ts))
stores `{ startIndex, endIndex }`. After a remote insert above the
cursor, those indices are stale. CRDT runtimes expose "relative
positions" (Yjs) / "cursors" (Automerge) that survive concurrent edits.

* Add an internal `AnchorPosition = { afterId: string, offset: number
  }` alongside the existing index pair.
* Convert anchor → index at the moment of layout/render (cheap; the
  position list already maps elements to coordinates).
* All `setRange` / `getRange` callers can keep their integer API; the
  anchor form is the source of truth, indices are derived.

Worth doing during **Phase 3.2** (typing the render payload) since
that's the moment we're touching cursor/range types anyway. Doing it
later means touching every command in `CommandAdapt.ts`.

#### (c) `scheduleRender` payload needs a remote-op input path

The merge logic from Phase 1.1 should accept remote-applied changes —
so a single `pendingFrame` carries `{ localDirtyRange, remoteDirtyRange,
curIndex, ... }` and they coalesce into one `_renderNow` per rAF.

Crucial invariant: **apply remote ops through the CRDT/Mutator first,
then layout once. Never diff the rendered output.** This is a
discipline thing, not extra code — the rAF scheduler already enforces
"one layout per frame", we just have to make sure remote ops feed it
the same way local ops do.

#### (d) Open question: tables / lists / controls / auto-numbering

This is where CRDT collab gets genuinely hard, and the perf plan does
not solve it. Examples:

* Two users add a row to the same table at the same logical position —
  whose row comes first? Yjs/Loro tree CRDTs handle this if rows are
  CRDT children, but the current table model is a flat
  `tr/td/elementList` tree mutated via direct splices ([Draw.ts:1645-1844](src/editor/core/draw/Draw.ts#L1645-L1844)).
* Auto-numbered list items (`listParticle.computeListStyle`,
  [Draw.ts:1506](src/editor/core/draw/Draw.ts#L1506)) — are derived,
  not stored, so they converge naturally; that's good.
* Controls with referential integrity (radio groups, controls that
  reference other controls' ids) — concurrent edits can break
  invariants.

**Action for this plan: just flag it.** Don't try to solve it during
the perf refactor. Phase 3.1's `Mutator` boundary is where the eventual
solution will live.

### 6.3 What we deliberately do *not* CRDT-ify

* **Layout** (`computeRowList`, `Position.computePositionList`,
  `_drawPage`). Layout consumes a converged snapshot for the frame;
  stable IDs and op streams have no business there. Keeping layout
  collab-agnostic is a feature.
* **Workers** (word count / catalog / value). They run on demand, not
  on input; collab doesn't change their inputs.
* **`TextParticle.measureText` cache** — content-keyed, already correct
  under any mutation source.

### 6.4 Recommended sequence with collab in scope

Same phases as Section 4, with the four adjustments slotted in:

| # | Change | CRDT-readiness adjustment |
| --- | --- | --- |
| P1.1 | rAF-coalesce render | scheduler payload also accepts `remoteDirtyRange` (6.2c) |
| P1.2 | delta-based history | entries carry `id` / `afterId`, not just indices (6.2a); make `IElement.id` mandatory at the Mutator boundary |
| P2.1 | dirty-range tracking | reused unchanged for remote ops |
| P2.2-2.4 | incremental layout | reused unchanged |
| P3.1 | `Mutator` split | designed as the future CRDT integration seam |
| P3.2 | type the render payload | introduce `AnchorPosition`, derive indices from it (6.2b) |
| P3.4 | history-as-strategy | becomes the local op log CRDT runtime subscribes to |
| (deferred) | table/list/control merge semantics | tracked as an open question (6.2d), not solved here |

Net cost above the original plan: a stable-id invariant, an
`AnchorPosition` type, and one extra field on the scheduler payload.
That's it.

---

## 7. One-screen summary for reviewers

> The editor reflows the whole document on every keystroke. The biggest
> single win is to coalesce the render into one `requestAnimationFrame`
> per frame and to stop deep-cloning the document for history on every
> history boundary. The biggest *structural* win is to give
> `computeRowList` and `computePositionList` a dirty range so that
> per-keystroke layout cost stops being O(N). All of this is
> backwards-compatible with the public API, and — with four small
> adjustments folded into Phases 1-3 (stable element IDs, anchor-based
> ranges, a remote-op input on the render scheduler, and an explicit
> Mutator seam) — leaves the codebase **prepared** for CRDT-based
> collaboration rather than merely compatible with it.
