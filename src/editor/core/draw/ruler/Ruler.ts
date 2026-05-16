/**
 * MS Word-style ruler — horizontal + vertical interactive ruler strips attached
 * to each page. See `interface/Ruler.ts` for the architectural principle: the
 * ruler is a **projection of formatting state**, not a drawing overlay.
 *
 *  - **UI-layer separation** — rulers live in their own DOM canvases attached
 *    as absolute-positioned children of `.ce-page-wrapper` at *negative*
 *    coordinates (extending outside the wrapper's box into the surrounding
 *    editor margin). Crucially this keeps the page wrapper's flow position
 *    UNCHANGED — the cursor DOM (which positions itself relative to the
 *    editor container in *page-relative* coordinates) needs no adjustment.
 *    The editor container takes a `margin-top` / `margin-left` of one ruler
 *    width so the negative-positioned rulers stay visible in the surrounding
 *    space.
 *  - **Coordinates** — internal storage is logical document coordinates
 *    (CSS pixels at scale=1). Marker drags translate screen-delta back to
 *    logical-delta via `defaultTabWidth * scale` (for indent steps) or
 *    `1 / scale` (for absolute margin / tab-stop positions in pixels).
 *  - **Section-aware** — each page gets its own h+v ruler strip reflecting
 *    that page's section geometry; the active page (containing the cursor)
 *    additionally gets indent / tab-stop / column-boundary markers.
 *  - **Zoom-aware** — ruler thickness stays constant in *screen* pixels (Word
 *    UX), but tick spacing follows page-width and therefore scales with zoom.
 *    1 inch on the ruler always represents 1 logical inch.
 *  - **Mixed selection / non-paragraph contexts** — when the selection spans
 *    different paragraph indents, we currently show the first-paragraph
 *    state (Word shows indeterminate markers — TODO once mixed-state UX is
 *    wired up).
 */

import { EDITOR_PREFIX } from '../../../dataset/constant/Editor'
import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import {
  ITabStop,
  RulerUnit,
  TabStopType
} from '../../../interface/Ruler'
import { EventBus } from '../../event/eventbus/EventBus'
import { EventBusMap } from '../../../interface/EventBus'
import { Draw } from '../Draw'
import { LIST_INDENT_STEP } from '../../../dataset/constant/listLevel'

/** 1 inch = 96 CSS pixels at scale=1 (matches canvas-editor's px-as-units). */
const DPI = 96
/** Top half of the horizontal ruler is the label band, bottom half is the
 *  tick band. Markers float across both halves. */
const LABEL_BAND_FRACTION = 0.5

type MarkerKind =
  | 'first-line'
  | 'hanging'
  | 'left-indent'
  | 'right-indent'
  | 'left-margin'
  | 'right-margin'
  | 'top-margin'
  | 'bottom-margin'
  | 'col-boundary'
  | 'tab-stop'

interface MarkerHit {
  kind: MarkerKind
  /** colgroup index for col-boundary, tabStops index for tab-stop. */
  index?: number
  /** Marker center along the ruler, in screen px relative to the canvas. */
  centerPx?: number
}

interface PageFrame {
  pageNo: number
  wrapper: HTMLDivElement
  corner: HTMLDivElement
  hRuler: HTMLDivElement
  vRuler: HTMLDivElement
  hCanvas: HTMLCanvasElement
  vCanvas: HTMLCanvasElement
  hCtx: CanvasRenderingContext2D
  vCtx: CanvasRenderingContext2D
}

type DragMode =
  | { kind: 'first-line'; pageNo: number; startElIndent: number; startElFirst: number }
  | { kind: 'hanging'; pageNo: number; startIndent: number; startFirst: number }
  | { kind: 'left-indent'; pageNo: number; startIndent: number; startFirst: number }
  | { kind: 'right-indent'; pageNo: number; startRight: number }
  | { kind: 'left-margin'; pageNo: number; startMargin: number }
  | { kind: 'right-margin'; pageNo: number; startMargin: number }
  | { kind: 'top-margin'; pageNo: number; startMargin: number }
  | { kind: 'bottom-margin'; pageNo: number; startMargin: number }
  | { kind: 'col-boundary'; pageNo: number; colIndex: number; tableElIndex: number; startWidth: number; nextStartWidth: number }
  | { kind: 'tab-stop'; pageNo: number; tabIndex: number }

export class Ruler {
  private draw: Draw
  private options: DeepRequired<IEditorOption>
  private eventBus: EventBus<EventBusMap>
  private frames: PageFrame[] = []
  /** Mirrored from options for terser access; never mutated. */
  private size: number

  private drag: DragMode | null = null
  private dragStartScreenX = 0
  private dragStartScreenY = 0
  /** Tab-stop type a click on the empty content band will produce. Cycles via
   *  corner click (Word UX). */
  private nextTabStopType: TabStopType = TabStopType.LEFT
  /** Original editor-container border styles, restored on destroy. */
  private originalBorderTop: string | null = null
  private originalBorderLeft: string | null = null
  /** Marker hit tolerance in screen pixels. Larger = easier to grab; Word ≈ 6 px. */
  private static readonly HIT_TOLERANCE = 8

  private boundDocMouseMove: (e: MouseEvent) => void
  private boundDocMouseUp: (e: MouseEvent) => void
  private unsubscribers: Array<() => void> = []

  private destroyed = false
  private dpr = 1
  /** Currently open context menu DOM (`_openContextMenu` / `_closeContextMenu`).
   *  Kept as state so a second open closes the previous one and destroy()
   *  can tear it down. */
  private openMenu: HTMLDivElement | null = null
  /** Document-level click listener that closes the open menu on outside click.
   *  Lazily attached when a menu opens, detached on close. */
  private menuOutsideClick: ((e: MouseEvent) => void) | null = null
  /** Shared tooltip element that follows the cursor over ruler markers.
   *  Created once on construction, reused across all frames. */
  private tooltip: HTMLDivElement | null = null
  /** Last marker kind the tooltip was shown for; avoids redundant DOM writes
   *  when the cursor moves within the same marker's hit-box. */
  private lastTooltipKind: MarkerKind | null = null
  /**
   * Pending rAF id for `_scheduleRender`. We coalesce multiple ruler-affecting
   * events fired in the same frame (`rangeStyleChange`, `pageScaleChange`, …)
   * into one paint — on a 34-page doc each pass costs ~70 canvas resizes plus
   * 70 paints, so even 2 events per frame would noticeably stall scrolling.
   * `null` means no pending frame; otherwise the rAF callback will clear it.
   */
  private pendingRenderFrame: number | null = null
  /**
   * Paint-input signature per frame — `_renderNow` skips the per-frame paint
   * pass entirely when the previous signature matches. Keyed by wrapper (so
   * detaching a frame lets the entry become unreachable on the next
   * `_syncFrames`). Inputs that change the signature: page width/height,
   * scale, dpr, margins, unit, and (for the active page only) the active
   * paragraph's indent / firstLineIndent / rightIndent / tabStops, plus
   * table colgroup if in a table.
   */
  private framePaintKey = new WeakMap<HTMLDivElement, string>()
  /**
   * Last applied canvas-backing dimensions per frame. Reassigning
   * `canvas.width`/`height` always clears the canvas and reallocates the
   * pixel buffer — skipping the write when the value is identical is a big
   * win at scale (35 frames × 2 canvases × 2 dims per `_syncFrames` call).
   */
  private frameDims = new WeakMap<
    HTMLDivElement,
    { hW: number; hH: number; vW: number; vH: number }
  >()

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
    this.eventBus = (draw as unknown as { eventBus: EventBus<EventBusMap> }).eventBus
    this.size = this.options.ruler.size

    this.boundDocMouseMove = (e: MouseEvent) => this._onDocMouseMove(e)
    this.boundDocMouseUp = (e: MouseEvent) => this._onDocMouseUp(e)

    this._applyContainerSpacing()
    document.addEventListener('mousemove', this.boundDocMouseMove)
    document.addEventListener('mouseup', this.boundDocMouseUp)

    // Shared tooltip element — one per ruler, reused across all page frames.
    // Positioned fixed so it follows the cursor without being clipped by the
    // editor container overflow. Hidden by default.
    this.tooltip = document.createElement('div')
    this.tooltip.classList.add(`${EDITOR_PREFIX}-ruler-tooltip`)
    this.tooltip.style.position = 'fixed'
    this.tooltip.style.zIndex = '10001'
    this.tooltip.style.pointerEvents = 'none'
    this.tooltip.style.display = 'none'
    this.tooltip.style.backgroundColor = 'rgba(0,0,0,0.75)'
    this.tooltip.style.color = '#fff'
    this.tooltip.style.fontSize = '11px'
    this.tooltip.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    this.tooltip.style.padding = '2px 6px'
    this.tooltip.style.borderRadius = '3px'
    this.tooltip.style.whiteSpace = 'nowrap'
    document.body.appendChild(this.tooltip)

    // Re-render the ruler on the events that change what it visualises.
    //  - `rangeStyleChange` — every cursor move / selection change, plus the
    //    indent / shading commands that pass `isSubmitHistory: false`. The
    //    single most reliable hook for keeping active-paragraph markers in
    //    sync with the caret.
    //  - `visiblePageNoListChange` — Draw fires this when the user scrolls
    //    (after a 150 ms debounce in ScrollObserver). On large docs the
    //    initial paint deliberately skips off-screen frames; this hook is
    //    what lets them get painted on the first scroll that reveals them.
    if (this.eventBus) {
      const events: Array<keyof EventBusMap> = [
        'pageScaleChange',
        'pageSizeChange',
        'contentChange',
        'positionContextChange',
        'rangeStyleChange',
        'visiblePageNoListChange'
      ]
      for (const ev of events) {
        const fn = () => this.render()
        ;(this.eventBus.on as (k: typeof ev, f: () => void) => void)(ev, fn)
        this.unsubscribers.push(() =>
          (this.eventBus.off as (k: typeof ev, f: () => void) => void)(ev, fn)
        )
      }
    }
  }

  // ─── public API ────────────────────────────────────────────────────────

  /**
   * Schedule a ruler repaint. **rAF-coalesced** — multiple calls in the same
   * frame collapse into one paint pass. This is the single most important
   * cost lever on multi-page docs: ruler-affecting events
   * (`rangeStyleChange`, `contentChange`, `pageScaleChange`, …) often fire in
   * bursts (e.g. a typing batch resolves into rangeStyleChange + content
   * change in the same tick), and without coalescing each one would
   * synchronously do `_syncFrames` + 2N canvas paints. Public method kept
   * `render` for backwards compat with internal call sites — actual work
   * happens in `_renderNow` on the next animation frame.
   */
  public render() {
    if (this.destroyed) return
    if (this.options.ruler.disabled) return
    if (this.pendingRenderFrame !== null) return
    this.pendingRenderFrame = requestAnimationFrame(() => {
      this.pendingRenderFrame = null
      if (this.destroyed || this.options.ruler.disabled) return
      this._renderNow()
    })
  }

  /**
   * Synchronous render path. Called from the rAF callback in `render()` and
   * also directly from drag-commit paths that want to see the marker move on
   * the same frame (avoiding a one-frame visual lag between mouseup and the
   * new marker position).
   *
   * Two layers of work-skipping:
   *
   *   1. **Visible-page filter** — paint only frames whose `pageNo` is in
   *      Draw's current visible-page list (plus the active page, which the
   *      caret pins regardless of viewport). On a 34-page document with one
   *      or two visible pages, this turns a 35-frame paint loop into a
   *      2-frame loop. Off-screen frames are deferred by clearing their
   *      paint-key cache entry so they DO repaint the moment they become
   *      visible (`visiblePageNoListChange` is also wired to `render`).
   *
   *   2. **Paint-key cache** — even among visible frames, skip the per-
   *      frame paint when none of its inputs changed since last render. On
   *      cursor moves within the same page, only the active frame's key
   *      changes; the others hit the cache and exit early.
   *
   * The first-render guard (`framePaintKey.size === 0`) ensures the very
   * first render after the editor mounts paints ALL frames, not just the
   * ones the visible-page list happens to know about (ScrollObserver runs
   * with a setTimeout, so the visible list is empty on the synchronous
   * first paint).
   */
  private _renderNow() {
    this.dpr = this.draw.getPagePixelRatio()
    this._syncFrames()
    const visiblePages = this.draw.getVisiblePageNoList()
    const activePage = this.draw.getPageNo()
    // Only filter to visible pages if the list has been populated. On first
    // render ScrollObserver hasn't fired yet, so the list is empty — we
    // paint all frames in that case (initial paint pays for all visible
    // pages up to viewport height; off-screen pages still skip via the
    // paint-key cache once `visiblePageNoListChange` fires).
    const filterToVisible = visiblePages.length > 0
    const visible = filterToVisible ? new Set(visiblePages) : null
    for (const frame of this.frames) {
      if (
        visible &&
        !visible.has(frame.pageNo) &&
        frame.pageNo !== activePage
      ) {
        // Off-screen and not the active page — defer the paint by clearing
        // the cache entry so the next render (typically triggered by
        // `visiblePageNoListChange` on scroll) will repaint this frame.
        // Note: we do NOT clear the canvas — its last painted state stays
        // until the canvas is next overwritten. Off-screen content is
        // invisible anyway and any indent/tab-stop marker is correct as
        // long as the source paragraph didn't change.
        this.framePaintKey.delete(frame.wrapper)
        continue
      }
      const key = this._computePaintKey(frame)
      if (this.framePaintKey.get(frame.wrapper) === key) continue
      this.framePaintKey.set(frame.wrapper, key)
      this._paintHorizontal(frame)
      this._paintVertical(frame)
    }
  }

  public destroy() {
    if (this.destroyed) return
    this.destroyed = true
    if (this.pendingRenderFrame !== null) {
      cancelAnimationFrame(this.pendingRenderFrame)
      this.pendingRenderFrame = null
    }
    this._closeContextMenu()
    this._hideTooltip()
    if (this.tooltip) {
      this.tooltip.remove()
      this.tooltip = null
    }
    document.removeEventListener('mousemove', this.boundDocMouseMove)
    document.removeEventListener('mouseup', this.boundDocMouseUp)
    for (const u of this.unsubscribers) u()
    this.unsubscribers = []
    for (const f of this.frames) {
      this._detachFrame(f)
    }
    this.frames = []
    this._restoreContainerSpacing()
  }

  public invalidateActiveFramePaintKey() {
    const activeFrame = this.frames.find(
      f => f.pageNo === this.draw.getPageNo()
    )
    if (activeFrame) {
      this.framePaintKey.delete(activeFrame.wrapper)
    }
  }

  /**
   * Build a paint-input signature for one page frame. The signature must
   * include every value the paint path reads — change anything and the
   * skip-on-equal logic in `_renderNow` would let a stale frame stay
   * onscreen.
   *
   * Active-page-only inputs (indents, tabStops, table colgroup) are folded
   * in only when the frame IS the active page; for inactive pages those
   * inputs are irrelevant to the paint output, so omitting them lets
   * inactive frames hit the cache as the caret hops around the active page.
   */
  private _computePaintKey(f: PageFrame): string {
    const o = this.options
    const m = this.draw.getMargins()
    const isActive = f.pageNo === this.draw.getPageNo()
    let suffix = ''
    if (isActive) {
      const ind = this._getActiveIndents()
      const tabs = this._getActiveTabStops()
      const tabHash = tabs.map(t => `${t.position}:${t.type}`).join(',')
      const isTable = this.draw.getPosition().getPositionContext().isTable
      let colHash = ''
      if (isTable) {
        const info = this._getActiveTableColInfo()
        if (info) colHash = info.colgroup.join(',')
      }
      suffix =
        '|' +
        [
          ind?.indent ?? 0,
          ind?.firstLineIndent ?? 0,
          ind?.rightIndent ?? 0,
          ind?.listLevel ?? 0,
          tabHash,
          isTable ? 1 : 0,
          colHash
        ].join('|')
    }
    return (
      [
        f.pageNo,
        this.draw.getWidth(),
        this.draw.getHeight(),
        m[0],
        m[1],
        m[2],
        m[3],
        o.scale,
        this.dpr,
        o.ruler.unit,
        isActive ? 1 : 0
      ].join(',') + suffix
    )
  }

  /** Show or hide the ruler without destroying it. Idempotent.
   *  Pairs with `isVisible()` for external toggle buttons. */
  public setVisible(visible: boolean) {
    if (this.destroyed) return
    if (visible === !this.options.ruler.disabled) return
    if (visible) {
      this.options.ruler.disabled = false
      this._applyContainerSpacing()
      this.render()
    } else {
      this._closeContextMenu()
      for (const f of this.frames) this._detachFrame(f)
      this.frames = []
      this._restoreContainerSpacing()
      this.options.ruler.disabled = true
    }
  }

  /** Returns true when the ruler is currently visible. */
  public isVisible(): boolean {
    return !this.options.ruler.disabled && !this.destroyed
  }

  // ─── DOM lifecycle ─────────────────────────────────────────────────────

  /** Reserve space around the page wrappers for the negative-positioned ruler
   *  strips, **using a transparent `border-left` / `border-top`** on the
   *  editor container.
   *
   *  Why a border specifically (not padding, not margin, not page-container
   *  shifts):
   *
   *  - `position: absolute` children (the cursor + the hidden input textarea
   *    that captures keystrokes) resolve their `top:0` / `left:0` against the
   *    containing block's **padding-edge** — which is the *inside* edge of
   *    the border, i.e. the *outside* edge of the padding. Static children
   *    (the page-container) flow into the **content area**, which begins at
   *    the *inside* edge of the padding.
   *
   *      ┌── border ──┐
   *      │ ┌─padding─┐│
   *      │ │ content ││
   *      │ │   …     ││
   *
   *    With container padding, static `page-container` shifts inward by the
   *    padding amount, but the absolute `cursor` reference frame doesn't —
   *    they go out of alignment, and the cursor lands `(padding-left, top)`
   *    pixels off from where it should be.
   *
   *    A transparent **border** shifts the padding-edge inward by the border
   *    width. Both static children (page-container) and absolute children
   *    (cursor) move with it equally, so they stay aligned without any
   *    awareness in Cursor.ts.
   *
   *  - We can't use container `margin`: the demo CSS centers via
   *    `.editor > div { margin: 80px auto }`. Inline `marginLeft/Top` would
   *    override the auto-centering and push the page against the left edge.
   *
   *  - We can't pad `page-container`: it's a static child of the editor
   *    container, so its padding shifts wrappers but not the absolute cursor
   *    (which lives in the parent container).
   *
   *  With default `box-sizing: content-box`, the container's set `width` is
   *  the content-box width; the border adds outside, so the border-box width
   *  becomes `pageWidth + size`. `margin: 0 auto` on the parent still centers
   *  the whole thing. */
  private _applyContainerSpacing() {
    if (this.options.ruler.disabled) return
    const container = this.draw.getContainer()
    this.originalBorderTop = container.style.borderTop
    this.originalBorderLeft = container.style.borderLeft
    container.style.borderTop = `${this.size}px solid transparent`
    container.style.borderLeft = `${this.size}px solid transparent`
  }

  private _restoreContainerSpacing() {
    const container = this.draw.getContainer()
    if (this.originalBorderTop !== null)
      container.style.borderTop = this.originalBorderTop
    if (this.originalBorderLeft !== null)
      container.style.borderLeft = this.originalBorderLeft
  }

  /** Make sure every wrapper in Draw.pageWrapperList has a ruler set; drop
   *  rulers for pages that disappeared (e.g. content shrank). Rebuild canvas
   *  backing if zoom/size changed. */
  private _syncFrames() {
    const wrappers = this._getWrappers()
    while (this.frames.length > wrappers.length) {
      const f = this.frames.pop()!
      this._detachFrame(f)
    }
    for (let i = 0; i < wrappers.length; i++) {
      const wrapper = wrappers[i]
      let frame = this.frames[i]
      if (!frame || frame.wrapper !== wrapper) {
        if (frame) this._detachFrame(frame)
        frame = this._attachFrame(wrapper, i)
        this.frames[i] = frame
      } else {
        frame.pageNo = i
      }
      this._sizeFrame(frame)
    }
  }

  private _getWrappers(): HTMLDivElement[] {
    const container = this.draw.getPageContainer()
    return Array.from(
      container.querySelectorAll<HTMLDivElement>(
        `.${EDITOR_PREFIX}-page-wrapper, .${EDITOR_PREFIX}-page-base`
      )
    ).filter(el => {
      // Skip layered-mode base canvases that already have a `.ce-page-wrapper`
      // ancestor (we only want the outermost per-page DOM node).
      if (el.classList.contains(`${EDITOR_PREFIX}-page-base`)) {
        return !el.parentElement?.classList.contains(
          `${EDITOR_PREFIX}-page-wrapper`
        )
      }
      return true
    })
  }

  /** Attach ruler DOM children to the wrapper at *negative* coordinates so
   *  they sit *outside* the wrapper's visible box without shifting any
   *  document content. The wrapper is `position: relative` (existing CSS) so
   *  absolute-positioned children resolve against its top-left. */
  private _attachFrame(wrapper: HTMLDivElement, pageNo: number): PageFrame {
    const s = this.size

    const corner = document.createElement('div')
    corner.classList.add(`${EDITOR_PREFIX}-ruler-corner`)
    corner.title = 'Click to cycle tab-stop type'
    corner.style.position = 'absolute'
    corner.style.left = `${-s}px`
    corner.style.top = `${-s}px`
    corner.style.width = `${s}px`
    corner.style.height = `${s}px`
    corner.style.zIndex = '2'
    corner.addEventListener('mousedown', e => {
      // Stop propagation so this click doesn't fall through to the underlying
      // page (which would otherwise place the cursor in the page corner).
      e.stopPropagation()
      this._onCornerMouseDown()
    })

    const hRuler = document.createElement('div')
    hRuler.classList.add(`${EDITOR_PREFIX}-ruler-h`)
    hRuler.style.position = 'absolute'
    hRuler.style.left = '0'
    hRuler.style.top = `${-s}px`
    hRuler.style.height = `${s}px`
    hRuler.style.zIndex = '2'
    const hCanvas = document.createElement('canvas')
    hCanvas.classList.add(`${EDITOR_PREFIX}-ruler-h-canvas`)
    hRuler.appendChild(hCanvas)
    hRuler.addEventListener('mousedown', e => {
      e.stopPropagation()
      this._onHRulerMouseDown(e, this._frameFor(hRuler))
    })
    hRuler.addEventListener('dblclick', e => {
      e.stopPropagation()
      this._onHRulerDblClick(e, this._frameFor(hRuler))
    })
    // Right-click and double-click both open the same Word-style tab-stop /
    // ruler context menu (Word: right-click ruler → tab options; double-click
    // ruler → Tabs dialog). We support both for discoverability.
    hRuler.addEventListener('contextmenu', e => {
      e.preventDefault()
      e.stopPropagation()
      this._openContextMenu(e, this._frameFor(hRuler))
    })
    hRuler.addEventListener('mousemove', e =>
      this._onHRulerHover(e, this._frameFor(hRuler))
    )
    hRuler.addEventListener('mouseleave', () => {
      hRuler.style.cursor = ''
      this._hideTooltip()
    })

    const vRuler = document.createElement('div')
    vRuler.classList.add(`${EDITOR_PREFIX}-ruler-v`)
    vRuler.style.position = 'absolute'
    vRuler.style.left = `${-s}px`
    vRuler.style.top = '0'
    vRuler.style.width = `${s}px`
    vRuler.style.zIndex = '2'
    const vCanvas = document.createElement('canvas')
    vCanvas.classList.add(`${EDITOR_PREFIX}-ruler-v-canvas`)
    vRuler.appendChild(vCanvas)
    vRuler.addEventListener('mousedown', e => {
      e.stopPropagation()
      this._onVRulerMouseDown(e, this._frameFor(vRuler))
    })
    vRuler.addEventListener('mousemove', e =>
      this._onVRulerHover(e, this._frameFor(vRuler))
    )
    vRuler.addEventListener('mouseleave', () => {
      vRuler.style.cursor = ''
      this._hideTooltip()
    })

    // Tag the wrapper with its page index so `_frameFor` can resolve back to
    // the right PageFrame regardless of which inner element the event hit.
    wrapper.dataset.rulerPageIndex = String(pageNo)
    // Batch the three child appends through a DocumentFragment. Each direct
    // appendChild on a live DOM node can trigger style / layout invalidation
    // for the subtree; pumping them through a fragment collapses three
    // such hits per frame into one. With 35 wrappers that's the difference
    // between 105 layout-invalidations and 35 on the initial render.
    const fragment = document.createDocumentFragment()
    fragment.appendChild(corner)
    fragment.appendChild(hRuler)
    fragment.appendChild(vRuler)
    wrapper.appendChild(fragment)

    return {
      pageNo,
      wrapper,
      corner,
      hRuler,
      vRuler,
      hCanvas,
      vCanvas,
      hCtx: hCanvas.getContext('2d')!,
      vCtx: vCanvas.getContext('2d')!
    }
  }

  private _detachFrame(f: PageFrame) {
    f.corner.remove()
    f.hRuler.remove()
    f.vRuler.remove()
    delete f.wrapper.dataset.rulerPageIndex
  }

  /**
   * Update strip & canvas sizes to follow current page size, zoom, and DPR.
   *
   * Important: assigning `canvas.width` or `canvas.height` ALWAYS clears the
   * canvas and reallocates the GPU-backed pixel buffer, regardless of whether
   * the new value differs from the old. For a 34-page document this method
   * runs 35× per `_renderNow`, and an unconditional write was responsible for
   * 70 canvas-clears per ruler render. We cache the last applied dimensions
   * per wrapper and skip the writes when they match — common case during
   * cursor moves where neither page size, zoom, nor DPR have changed.
   *
   * The same logic applies to inline style.width/height writes (cheaper but
   * still forces a style recalc); the dim-cache short-circuit covers them
   * too as a side effect of the early return.
   */
  private _sizeFrame(f: PageFrame) {
    const pageW = this.draw.getWidth()
    const pageH = this.draw.getHeight()
    const s = this.size
    const dpr = this.dpr || 1
    const hW = Math.round(pageW * dpr)
    const hH = Math.round(s * dpr)
    const vW = Math.round(s * dpr)
    const vH = Math.round(pageH * dpr)

    const prev = this.frameDims.get(f.wrapper)
    if (
      prev &&
      prev.hW === hW &&
      prev.hH === hH &&
      prev.vW === vW &&
      prev.vH === vH
    ) {
      // Nothing changed since the last sizing pass — every assignment below
      // would be a no-op for the renderer but a write to a layout-affecting
      // property; bail out so the browser doesn't redo style recalc/paint
      // for the strip.
      return
    }

    f.hRuler.style.width = `${pageW}px`
    f.vRuler.style.height = `${pageH}px`

    f.hCanvas.width = hW
    f.hCanvas.height = hH
    f.hCanvas.style.width = `${pageW}px`
    f.hCanvas.style.height = `${s}px`
    f.hCanvas.style.display = 'block'
    f.vCanvas.width = vW
    f.vCanvas.height = vH
    f.vCanvas.style.width = `${s}px`
    f.vCanvas.style.height = `${pageH}px`
    f.vCanvas.style.display = 'block'

    this.frameDims.set(f.wrapper, { hW, hH, vW, vH })
    // Backing buffer reallocated — invalidate the paint cache so the next
    // paint pass for this frame actually runs (otherwise `_renderNow` would
    // see an unchanged paint key and skip painting onto the now-blank
    // canvas).
    this.framePaintKey.delete(f.wrapper)
  }

  private _frameFor(el: HTMLElement): PageFrame {
    const wrapper = el.closest(
      `.${EDITOR_PREFIX}-page-wrapper`
    ) as HTMLElement | null
    const idx = Number(wrapper?.dataset.rulerPageIndex)
    return this.frames[Number.isFinite(idx) ? idx : 0]
  }

  // ─── rendering: horizontal ─────────────────────────────────────────────

  private _paintHorizontal(f: PageFrame) {
    const ctx = f.hCtx
    const dpr = this.dpr || 1
    const opt = this.options.ruler
    const scale = this.options.scale
    const pageWidth = this.draw.getWidth()
    const margins = this.draw.getMargins()
    const size = this.size

    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, pageWidth, size)

    // Margin region fill (left + right gray bands).
    ctx.fillStyle = opt.marginColor
    ctx.fillRect(0, 0, pageWidth, size)
    // Content region (white centre band, between margins).
    ctx.fillStyle = opt.contentColor
    ctx.fillRect(margins[3], 0, pageWidth - margins[1] - margins[3], size)

    this._paintHorizontalTicks(ctx, pageWidth, margins, size, scale)

    // Active-page chrome: indent markers / tab stops / column boundaries.
    if (this._isActivePage(f.pageNo)) {
      const ctxInfo = this.draw.getPosition().getPositionContext()
      if (ctxInfo.isTable) {
        this._paintColumnBoundaries(ctx, f, size, scale, margins)
      } else {
        this._paintIndentMarkers(ctx, f, size, scale, margins)
        this._paintTabStops(ctx, f, size, scale, margins)
      }
    }

    // Separator hairline at the bottom edge — visual break between ruler
    // and the page content underneath.
    ctx.strokeStyle = opt.tickColor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, size - 0.5)
    ctx.lineTo(pageWidth, size - 0.5)
    ctx.stroke()

    ctx.restore()
  }

  /** Draw the inch / cm tick ladder. Numbers count outward from the left
   *  margin: positive going right (into content), negative going left (into
   *  margin). Mirrors Word. */
  private _paintHorizontalTicks(
    ctx: CanvasRenderingContext2D,
    pageWidth: number,
    margins: number[],
    size: number,
    scale: number
  ) {
    const opt = this.options.ruler
    const originX = margins[3]
    const innerWidth = pageWidth - margins[1] - margins[3]
    const labelBandH = size * LABEL_BAND_FRACTION

    ctx.fillStyle = opt.labelColor
    ctx.strokeStyle = opt.tickColor
    ctx.lineWidth = 1
    ctx.font = `${opt.labelSize}px ${opt.labelFont}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const unit = opt.unit
    const unitPx = this._unitPxAtScale(unit, scale)
    const subdivisions =
      unit === RulerUnit.IN ? 8 : unit === RulerUnit.CM ? 5 : 10

    this._paintTickSweep(
      ctx,
      originX,
      originX + innerWidth,
      unitPx,
      subdivisions,
      size,
      labelBandH,
      +1
    )
    this._paintTickSweep(
      ctx,
      originX,
      0,
      unitPx,
      subdivisions,
      size,
      labelBandH,
      -1
    )
    const rightOrigin = pageWidth - margins[1]
    this._paintTickSweep(
      ctx,
      rightOrigin,
      pageWidth,
      unitPx,
      subdivisions,
      size,
      labelBandH,
      +1,
      /*hideNumbers*/ true
    )
  }

  private _paintTickSweep(
    ctx: CanvasRenderingContext2D,
    originX: number,
    endX: number,
    unitPx: number,
    subdivisions: number,
    size: number,
    labelBandH: number,
    dir: 1 | -1,
    hideNumbers = false
  ) {
    const subPx = unitPx / subdivisions
    const tickY = size - labelBandH * 0.55
    const longLen = labelBandH * 0.55
    const midLen = labelBandH * 0.35
    const shortLen = labelBandH * 0.18

    let n = 0
    while (true) {
      const x = originX + dir * n * subPx
      if ((dir === 1 && x > endX) || (dir === -1 && x < endX)) break
      const isUnit = n % subdivisions === 0
      const isHalf = !isUnit && n % (subdivisions / 2) === 0
      const len = isUnit ? longLen : isHalf ? midLen : shortLen
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, tickY)
      ctx.lineTo(Math.round(x) + 0.5, tickY - len)
      ctx.stroke()

      if (isUnit && n > 0 && !hideNumbers) {
        ctx.fillText(String(n / subdivisions), Math.round(x), labelBandH / 2)
      }
      n++
      // Hard cap — protects against degenerate unitPx values from
      // pathological scales.
      if (n > 4096) break
    }
  }

  /** Convert a unit (in / cm / mm / px) to *screen* pixels at the current
   *  zoom level. 1 inch = 96 CSS px at scale=1. */
  private _unitPxAtScale(unit: RulerUnit, scale: number): number {
    switch (unit) {
      case RulerUnit.IN:
        return DPI * scale
      case RulerUnit.CM:
        return (DPI / 2.54) * scale
      case RulerUnit.MM:
        return (DPI / 25.4) * scale
      case RulerUnit.PX:
        return 50 * scale
    }
  }

  // ─── indent markers ────────────────────────────────────────────────────

  private _paintIndentMarkers(
    ctx: CanvasRenderingContext2D,
    f: PageFrame,
    size: number,
    scale: number,
    margins: number[]
  ) {
    const ind = this._getActiveIndents()
    if (!ind) return
    const opt = this.options.ruler
    const defaultTabWidth = this.options.defaultTabWidth
    const leftMargin = margins[3]
    const rightMargin = margins[1]
    const pageWidth = this.draw.getWidth()
    const innerWidth = pageWidth - leftMargin - rightMargin
    const stepPx = defaultTabWidth * scale
    // Multi-level list indent: listLevel translates to horizontal offset at
    // paint time (LIST_INDENT_STEP per level). Include it in the ruler marker
    // positions so they match the visual indent the user sees.
    const listLevelStepPx =
      ind.listLevel > 0 ? (ind.listLevel - 1) * LIST_INDENT_STEP * scale : 0
    const listLevelSteps = listLevelStepPx / stepPx
    const leftAtSteps = (steps: number) => leftMargin + (steps + listLevelSteps) * stepPx
    const rightAtSteps = (steps: number) =>
      leftMargin + innerWidth - steps * stepPx

    const xFirstLine = Math.max(
      leftMargin,
      leftAtSteps(ind.indent + ind.firstLineIndent)
    )
    const xHanging = leftAtSteps(ind.indent)
    const xLeftRect = leftAtSteps(ind.indent)
    const xRight = rightAtSteps(ind.rightIndent)

    ctx.fillStyle = opt.markerColor
    ctx.strokeStyle = opt.markerBorderColor

    this._drawTriangle(ctx, xFirstLine, 0, size * 0.45, 'down')
    this._drawTriangle(ctx, xHanging, size, size * 0.45, 'up')
    // Connector hairline between first-line triangle tip and hanging
    // triangle tip when the two markers are at different positions
    // (Word draws this to visually group them as one indent set).
    if (Math.abs(xFirstLine - xHanging) > 0.5) {
      ctx.strokeStyle = opt.markerBorderColor
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(xFirstLine, size * 0.45)
      ctx.lineTo(xHanging, size - size * 0.45)
      ctx.stroke()
    }
    const rectH = size * 0.18
    const rectW = size * 0.55
    ctx.fillRect(xLeftRect - rectW / 2, size - rectH - 1, rectW, rectH)
    ctx.strokeRect(
      Math.round(xLeftRect - rectW / 2) + 0.5,
      Math.round(size - rectH - 1) + 0.5,
      Math.round(rectW),
      Math.round(rectH)
    )
    this._drawTriangle(ctx, xRight, size, size * 0.45, 'up')

    // Stash hit positions on the strip element for hover/drag hit-testing.
    ;(f.hRuler as unknown as { _markers: Record<string, number> })._markers = {
      firstLine: xFirstLine,
      hanging: xHanging,
      leftRect: xLeftRect,
      right: xRight,
      leftMargin: leftMargin,
      rightMargin: leftMargin + innerWidth
    }
  }

  private _drawTriangle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    yBase: number,
    sizePx: number,
    dir: 'up' | 'down'
  ) {
    ctx.beginPath()
    if (dir === 'down') {
      ctx.moveTo(cx - sizePx / 2, yBase)
      ctx.lineTo(cx + sizePx / 2, yBase)
      ctx.lineTo(cx, yBase + sizePx)
    } else {
      ctx.moveTo(cx - sizePx / 2, yBase)
      ctx.lineTo(cx + sizePx / 2, yBase)
      ctx.lineTo(cx, yBase - sizePx)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  // ─── tab stops ─────────────────────────────────────────────────────────

  private _paintTabStops(
    ctx: CanvasRenderingContext2D,
    f: PageFrame,
    size: number,
    scale: number,
    margins: number[]
  ) {
    const tabs = this._getActiveTabStops()
    if (!tabs.length) return
    const leftMargin = margins[3]
    const opt = this.options.ruler
    ctx.save()
    ctx.fillStyle = opt.markerColor
    ctx.strokeStyle = opt.markerBorderColor
    for (const tab of tabs) {
      const x = leftMargin + tab.position * scale
      this._drawTabStopGlyph(ctx, x, size, tab.type)
    }
    ctx.restore()
    ;(f.hRuler as unknown as { _tabPositions?: number[] })._tabPositions =
      tabs.map(t => leftMargin + t.position * scale)
  }

  private _drawTabStopGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    size: number,
    type: TabStopType
  ) {
    const yBottom = size - 2
    const h = size * 0.4
    const w = size * 0.4
    ctx.beginPath()
    switch (type) {
      case TabStopType.LEFT:
        ctx.moveTo(x, yBottom - h)
        ctx.lineTo(x, yBottom)
        ctx.lineTo(x + w / 2, yBottom)
        break
      case TabStopType.RIGHT:
        ctx.moveTo(x, yBottom - h)
        ctx.lineTo(x, yBottom)
        ctx.lineTo(x - w / 2, yBottom)
        break
      case TabStopType.CENTER:
        ctx.moveTo(x, yBottom - h)
        ctx.lineTo(x, yBottom)
        ctx.moveTo(x - w / 2, yBottom)
        ctx.lineTo(x + w / 2, yBottom)
        break
      case TabStopType.DECIMAL:
        ctx.moveTo(x, yBottom - h)
        ctx.lineTo(x, yBottom)
        ctx.moveTo(x - w / 2, yBottom)
        ctx.lineTo(x + w / 2, yBottom)
        ctx.moveTo(x + 2, yBottom - h * 0.5)
        ctx.arc(x + 2, yBottom - h * 0.5, 1.2, 0, Math.PI * 2)
        break
      case TabStopType.BAR:
        ctx.moveTo(x, yBottom - h)
        ctx.lineTo(x, yBottom)
        break
    }
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // ─── table column boundaries ───────────────────────────────────────────

  private _paintColumnBoundaries(
    ctx: CanvasRenderingContext2D,
    f: PageFrame,
    size: number,
    scale: number,
    margins: number[]
  ) {
    const info = this._getActiveTableColInfo()
    if (!info) return
    const opt = this.options.ruler
    ctx.save()
    ctx.fillStyle = opt.markerColor
    ctx.strokeStyle = opt.markerBorderColor
    const baseX = margins[3] + (info.tableX || 0) * scale
    const positions: number[] = []
    let cum = 0
    positions.push(baseX)
    for (const w of info.colgroup) {
      cum += w
      positions.push(baseX + cum * scale)
    }
    for (let i = 1; i < positions.length - 1; i++) {
      const x = positions[i]
      const w = 6
      const h = size * 0.5
      ctx.fillRect(x - w / 2, size - h - 1, w, h)
      ctx.strokeRect(
        Math.round(x - w / 2) + 0.5,
        Math.round(size - h - 1) + 0.5,
        w,
        h
      )
    }
    ctx.restore()
    ;(f.hRuler as unknown as { _colPositions?: number[] })._colPositions =
      positions
  }

  // ─── rendering: vertical ───────────────────────────────────────────────

  private _paintVertical(f: PageFrame) {
    const ctx = f.vCtx
    const dpr = this.dpr || 1
    const opt = this.options.ruler
    const scale = this.options.scale
    const pageHeight = this.draw.getHeight()
    const margins = this.draw.getMargins()
    const size = this.size

    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, pageHeight)

    ctx.fillStyle = opt.marginColor
    ctx.fillRect(0, 0, size, pageHeight)
    ctx.fillStyle = opt.contentColor
    ctx.fillRect(0, margins[0], size, pageHeight - margins[0] - margins[2])

    this._paintVerticalTicks(ctx, pageHeight, margins, size, scale)

    ctx.strokeStyle = opt.tickColor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(size - 0.5, 0)
    ctx.lineTo(size - 0.5, pageHeight)
    ctx.stroke()
    ctx.restore()

    ;(f.vRuler as unknown as { _markers: Record<string, number> })._markers = {
      topMargin: margins[0],
      bottomMargin: pageHeight - margins[2]
    }
  }

  private _paintVerticalTicks(
    ctx: CanvasRenderingContext2D,
    pageHeight: number,
    margins: number[],
    size: number,
    scale: number
  ) {
    const opt = this.options.ruler
    const originY = margins[0]
    const innerH = pageHeight - margins[0] - margins[2]
    const labelBandW = size * LABEL_BAND_FRACTION

    ctx.fillStyle = opt.labelColor
    ctx.strokeStyle = opt.tickColor
    ctx.lineWidth = 1
    ctx.font = `${opt.labelSize}px ${opt.labelFont}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const unit = opt.unit
    const unitPx = this._unitPxAtScale(unit, scale)
    const subdivisions =
      unit === RulerUnit.IN ? 8 : unit === RulerUnit.CM ? 5 : 10
    const tickX = size - labelBandW * 0.55
    const longLen = labelBandW * 0.55
    const midLen = labelBandW * 0.35
    const shortLen = labelBandW * 0.18
    const subPx = unitPx / subdivisions

    const drawSweep = (
      originY0: number,
      endY: number,
      dir: 1 | -1,
      hideNumbers = false
    ) => {
      let n = 0
      while (true) {
        const y = originY0 + dir * n * subPx
        if ((dir === 1 && y > endY) || (dir === -1 && y < endY)) break
        const isUnit = n % subdivisions === 0
        const isHalf = !isUnit && n % (subdivisions / 2) === 0
        const len = isUnit ? longLen : isHalf ? midLen : shortLen
        ctx.beginPath()
        ctx.moveTo(tickX, Math.round(y) + 0.5)
        ctx.lineTo(tickX - len, Math.round(y) + 0.5)
        ctx.stroke()
        if (isUnit && n > 0 && !hideNumbers) {
          ctx.save()
          ctx.translate(labelBandW / 2, Math.round(y))
          ctx.rotate(-Math.PI / 2)
          ctx.fillText(String(n / subdivisions), 0, 0)
          ctx.restore()
        }
        n++
        if (n > 4096) break
      }
    }
    drawSweep(originY, 0, -1, true)
    drawSweep(originY, originY + innerH, +1)
    drawSweep(originY + innerH, pageHeight, +1, true)
  }

  // ─── hit testing & hover ───────────────────────────────────────────────

  private _hitTestHRuler(f: PageFrame, x: number, y: number): MarkerHit | null {
    const size = this.size
    const m = (f.hRuler as unknown as { _markers?: Record<string, number> })
      ._markers
    const tabPositions =
      (f.hRuler as unknown as { _tabPositions?: number[] })._tabPositions || []
    const colPositions =
      (f.hRuler as unknown as { _colPositions?: number[] })._colPositions || []
    const TOL = Ruler.HIT_TOLERANCE

    const ctxInfo = this.draw.getPosition().getPositionContext()
    if (ctxInfo.isTable && colPositions.length) {
      for (let i = 1; i < colPositions.length - 1; i++) {
        if (Math.abs(colPositions[i] - x) <= TOL) {
          return { kind: 'col-boundary', index: i - 1, centerPx: colPositions[i] }
        }
      }
    } else if (m) {
      if (y < size * 0.5) {
        if (Math.abs(m.firstLine - x) <= TOL) return { kind: 'first-line' }
      }
      // Bottom half — hanging triangle and left-indent rectangle share the same
      // x position. Zone them vertically: hanging covers the upper part of the
      // bottom half (0.5–0.75), left-indent rectangle covers the bottom 25%.
      if (y >= size * 0.75) {
        // Check left-indent rectangle first in the bottom strip — it is the
        // wider, more forgiving target (Word: the rectangle is the primary
        // left-indent handle when the user reaches the very bottom).
        if (Math.abs(m.leftRect - x) <= TOL + 4)
          return { kind: 'left-indent' }
        // Fallback: hanging triangle if the cursor is near the hanging position
        // but wasn't captured by the rectangle's wider hit-box (e.g. narrow
        // ruler where the rect is tiny).
        if (Math.abs(m.hanging - x) <= TOL) return { kind: 'hanging' }
      } else if (y >= size * 0.5) {
        if (Math.abs(m.hanging - x) <= TOL) return { kind: 'hanging' }
      }
      if (m.right !== undefined && Math.abs(m.right - x) <= TOL) {
        return { kind: 'right-indent' }
      }
      for (let i = 0; i < tabPositions.length; i++) {
        if (Math.abs(tabPositions[i] - x) <= TOL) {
          return { kind: 'tab-stop', index: i, centerPx: tabPositions[i] }
        }
      }
      if (Math.abs(m.leftMargin - x) <= TOL) return { kind: 'left-margin' }
      if (Math.abs(m.rightMargin - x) <= TOL) return { kind: 'right-margin' }
    }
    return null
  }

  private _hitTestVRuler(f: PageFrame, _x: number, y: number): MarkerHit | null {
    const m = (f.vRuler as unknown as { _markers?: Record<string, number> })
      ._markers
    if (!m) return null
    const TOL = Ruler.HIT_TOLERANCE
    if (Math.abs(m.topMargin - y) <= TOL) return { kind: 'top-margin' }
    if (Math.abs(m.bottomMargin - y) <= TOL) return { kind: 'bottom-margin' }
    return null
  }

  // ─── tooltip helpers ───────────────────────────────────────────────────

  /** Map a marker kind to a human-readable string for the hover tooltip. */
  private _markerLabel(kind: MarkerKind): string {
    switch (kind) {
      case 'first-line':
        return 'First Line Indent'
      case 'hanging':
        return 'Hanging Indent'
      case 'left-indent':
        return 'Left Indent'
      case 'right-indent':
        return 'Right Indent'
      case 'left-margin':
        return 'Left Margin'
      case 'right-margin':
        return 'Right Margin'
      case 'top-margin':
        return 'Top Margin'
      case 'bottom-margin':
        return 'Bottom Margin'
      case 'col-boundary':
        return 'Column Boundary'
      case 'tab-stop':
        return 'Tab Stop'
    }
  }

  /** Show the ruler tooltip at the given client coordinates for the given
   *  marker kind. No-ops when the kind hasn't changed since the last call
   *  (avoids redundant DOM style writes when the cursor moves within the
   *  same marker's hit-box). */
  private _showTooltip(kind: MarkerKind, clientX: number, clientY: number) {
    if (!this.tooltip) return
    if (this.lastTooltipKind === kind) return
    this.lastTooltipKind = kind
    this.tooltip.textContent = this._markerLabel(kind)
    this.tooltip.style.display = 'block'
    this.tooltip.style.left = `${clientX + 14}px`
    this.tooltip.style.top = `${clientY + 18}px`
  }

  /** Hide the ruler tooltip and reset the kind tracker. */
  private _hideTooltip() {
    if (!this.tooltip) return
    this.lastTooltipKind = null
    this.tooltip.style.display = 'none'
    this.tooltip.textContent = ''
  }

  /** Drive the hover cursor so users can *find* the interactive zones without
   *  having to discover them by trial-and-error. Word does the same — its
   *  ruler swaps to `ew-resize` / `col-resize` exactly when the pointer enters
   *  a marker hit-box. Outside marker hits we still flag the *content band*
   *  as clickable (will add a tab stop on click) so the user knows the ruler
   *  is interactive. Margin gray bands stay `default` (no interaction). */
  private _onHRulerHover(e: MouseEvent, f: PageFrame) {
    if (this.drag) return
    const rect = f.hRuler.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hit = this._hitTestHRuler(f, x, y)
    let cursor = 'default'
    if (hit) {
      this._showTooltip(hit.kind, e.clientX, e.clientY)
      switch (hit.kind) {
        case 'first-line':
        case 'hanging':
        case 'left-indent':
        case 'right-indent':
        case 'tab-stop':
          cursor = 'ew-resize'
          break
        case 'col-boundary':
        case 'left-margin':
        case 'right-margin':
          cursor = 'col-resize'
          break
      }
    } else {
      this._hideTooltip()
      // No direct hit — but the content band is still actionable (click to
      // add a tab stop in the active paragraph). Surface that affordance.
      const margins = this.draw.getMargins()
      const isInContent =
        x > margins[3] && x < this.draw.getWidth() - margins[1]
      const ctxInfo = this.draw.getPosition().getPositionContext()
      if (isInContent && !ctxInfo.isTable) {
        cursor = 'pointer'
      }
    }
    f.hRuler.style.cursor = cursor
  }

  /** Same hover treatment for the vertical ruler — only the margin boundary
   *  is interactive there (top/bottom margin drag), so we only flip to
   *  `row-resize` over the boundary; everything else stays `default`. */
  private _onVRulerHover(e: MouseEvent, f: PageFrame) {
    if (this.drag) return
    const rect = f.vRuler.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hit = this._hitTestVRuler(f, x, y)
    if (hit) {
      this._showTooltip(hit.kind, e.clientX, e.clientY)
    } else {
      this._hideTooltip()
    }
    f.vRuler.style.cursor = hit ? 'row-resize' : 'default'
  }

  // ─── mouse: horizontal ─────────────────────────────────────────────────

  private _onHRulerMouseDown(e: MouseEvent, f: PageFrame) {
    if (e.button !== 0) return
    const rect = f.hRuler.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hit = this._hitTestHRuler(f, x, y)
    this.dragStartScreenX = e.clientX
    this.dragStartScreenY = e.clientY

    const ctxInfo = this.draw.getPosition().getPositionContext()
    if (ctxInfo.isTable && hit?.kind === 'col-boundary') {
      const info = this._getActiveTableColInfo()
      if (!info) return
      const colIdx = hit.index!
      this.drag = {
        kind: 'col-boundary',
        pageNo: f.pageNo,
        colIndex: colIdx,
        tableElIndex: info.elementIndex,
        startWidth: info.colgroup[colIdx],
        nextStartWidth: info.colgroup[colIdx + 1] ?? 0
      }
      e.preventDefault()
      return
    }
    if (!hit) {
      const margins = this.draw.getMargins()
      const isInContent = x > margins[3] && x < this.draw.getWidth() - margins[1]
      if (isInContent && !ctxInfo.isTable) {
        const scale = this.options.scale
        const logicalX = (x - margins[3]) / scale
        this._addTabStop(logicalX)
        this.render()
      }
      return
    }
    const ind = this._getActiveIndents()
    if (!ind) return
    this._hideTooltip()
    switch (hit.kind) {
      case 'first-line':
        this.drag = {
          kind: 'first-line',
          pageNo: f.pageNo,
          startElIndent: ind.indent,
          startElFirst: ind.firstLineIndent
        }
        break
      case 'hanging':
        this.drag = {
          kind: 'hanging',
          pageNo: f.pageNo,
          startIndent: ind.indent,
          startFirst: ind.firstLineIndent
        }
        break
      case 'left-indent':
        this.drag = {
          kind: 'left-indent',
          pageNo: f.pageNo,
          startIndent: ind.indent,
          startFirst: ind.firstLineIndent
        }
        break
      case 'right-indent':
        this.drag = {
          kind: 'right-indent',
          pageNo: f.pageNo,
          startRight: ind.rightIndent
        }
        break
      case 'left-margin': {
        const m = this.draw.getOriginalMargins()
        this.drag = {
          kind: 'left-margin',
          pageNo: f.pageNo,
          startMargin: m[3]
        }
        break
      }
      case 'right-margin': {
        const m = this.draw.getOriginalMargins()
        this.drag = {
          kind: 'right-margin',
          pageNo: f.pageNo,
          startMargin: m[1]
        }
        break
      }
      case 'tab-stop':
        this.drag = {
          kind: 'tab-stop',
          pageNo: f.pageNo,
          tabIndex: hit.index!
        }
        break
    }
    if (this.drag) e.preventDefault()
  }

  /** Double-click always opens the context menu — same affordance as
   *  right-click. The user-facing affordance for removing a tab stop is the
   *  "Clear all tab stops" menu item (drag-off-ruler is a future
   *  enhancement). Using both gestures for the same outcome is intentional:
   *  matches the screenshot the user supplied and matches Word's "Tabs…"
   *  dialog being reachable via either right-click or double-click on a
   *  ruler tab stop. */
  private _onHRulerDblClick(e: MouseEvent, f: PageFrame) {
    this._openContextMenu(e, f)
  }

  // ─── mouse: vertical ───────────────────────────────────────────────────

  private _onVRulerMouseDown(e: MouseEvent, f: PageFrame) {
    if (e.button !== 0) return
    const rect = f.vRuler.getBoundingClientRect()
    const y = e.clientY - rect.top
    const hit = this._hitTestVRuler(f, e.clientX - rect.left, y)
    this.dragStartScreenY = e.clientY
    if (!hit) return
    this._hideTooltip()
    const m = this.draw.getOriginalMargins()
    if (hit.kind === 'top-margin') {
      this.drag = { kind: 'top-margin', pageNo: f.pageNo, startMargin: m[0] }
    } else if (hit.kind === 'bottom-margin') {
      this.drag = { kind: 'bottom-margin', pageNo: f.pageNo, startMargin: m[2] }
    }
    if (this.drag) e.preventDefault()
  }

  // ─── corner: cycle tab-stop type (Word UX) ─────────────────────────────

  private _onCornerMouseDown() {
    const order: TabStopType[] = [
      TabStopType.LEFT,
      TabStopType.CENTER,
      TabStopType.RIGHT,
      TabStopType.DECIMAL,
      TabStopType.BAR
    ]
    const idx = order.indexOf(this.nextTabStopType)
    this.nextTabStopType = order[(idx + 1) % order.length]
    this.render()
  }

  // ─── global drag handlers ──────────────────────────────────────────────

  private _onDocMouseMove(e: MouseEvent) {
    if (!this.drag) return
    void e
  }

  private _onDocMouseUp(e: MouseEvent) {
    if (!this.drag) return
    const drag = this.drag
    this.drag = null
    const scale = this.options.scale
    const defaultTabWidth = this.options.defaultTabWidth
    const stepPx = defaultTabWidth * scale

    const dx = e.clientX - this.dragStartScreenX
    const dy = e.clientY - this.dragStartScreenY

    // Click-without-drag short-circuit. The first mousedown of a double-click
    // (and any "I meant to click, not drag" gesture) lands on the marker
    // hit-box and arms `this.drag`, but the user never actually drags. If
    // we let the commit path run with a 0-or-near-0 delta, two things go
    // wrong: (a) cumulative floating-point drift across many dblclicks can
    // shift indents by tiny amounts; (b) the second mousedown of the
    // dblclick fires before our `dblclick` handler opens the menu — that
    // second mousedown also arms a drag, and its mouseup would commit again.
    // The 3-px threshold is below human jitter on a modern trackpad/mouse
    // but well above sub-pixel drift, so intentional drags are unaffected.
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
      return
    }

    switch (drag.kind) {
      case 'first-line': {
        const deltaSteps = dx / stepPx
        const raw = drag.startElFirst + deltaSteps
        const snapped = this._snap(raw)
        const newFirst = Math.max(-drag.startElIndent, snapped)
        this._commitParagraphIndents({ firstLineIndent: newFirst })
        break
      }
      case 'hanging': {
        // Hanging triangle moves `indent` AND compensates `firstLineIndent`
        // by the inverse, so the first-line marker stays put (Word UX:
        // hanging moves the BODY without affecting the first-line position).
        const deltaSteps = dx / stepPx
        const newIndent = Math.max(0, drag.startIndent + deltaSteps)
        const realDelta = newIndent - drag.startIndent
        const newFirst = drag.startFirst - realDelta
        this._commitParagraphIndents({
          indent: this._snap(newIndent),
          firstLineIndent: this._snap(newFirst)
        })
        break
      }
      case 'left-indent': {
        // Rectangle moves BOTH markers together — `indent` shifts, the
        // delta between first-line and hanging is preserved (no
        // compensation, unlike the hanging-marker case).
        // When indent hits 0 and the user keeps dragging left, absorb
        // the remaining delta into firstLineIndent toward 0 (Word: both
        // markers bump into the margin and stop together).
        const deltaSteps = dx / stepPx
        const rawIndent = drag.startIndent + deltaSteps
        if (rawIndent <= 0) {
          const excess = rawIndent
          const rawFirst = drag.startFirst + excess
          const newFirst = Math.max(-0, rawFirst)
          this._commitParagraphIndents({
            indent: 0,
            firstLineIndent: this._snap(newFirst)
          })
        } else {
          this._commitParagraphIndents({ indent: this._snap(rawIndent) })
        }
        break
      }
      case 'right-indent': {
        const deltaSteps = -dx / stepPx
        const newRight = Math.max(0, drag.startRight + deltaSteps)
        this._commitParagraphIndents({
          rightIndent: this._snap(newRight)
        })
        break
      }
      case 'left-margin': {
        const newMargin = Math.max(0, drag.startMargin + dx / scale)
        this._commitMargin(3, newMargin)
        break
      }
      case 'right-margin': {
        const newMargin = Math.max(0, drag.startMargin - dx / scale)
        this._commitMargin(1, newMargin)
        break
      }
      case 'top-margin': {
        const newMargin = Math.max(0, drag.startMargin + dy / scale)
        this._commitMargin(0, newMargin)
        break
      }
      case 'bottom-margin': {
        const newMargin = Math.max(0, drag.startMargin - dy / scale)
        this._commitMargin(2, newMargin)
        break
      }
      case 'col-boundary': {
        const deltaPx = dx / scale
        const newW = Math.max(20, drag.startWidth + deltaPx)
        const consumed = newW - drag.startWidth
        const newNext = Math.max(20, drag.nextStartWidth - consumed)
        this._commitColumnWidth(
          drag.tableElIndex,
          drag.colIndex,
          newW,
          newNext
        )
        break
      }
      case 'tab-stop': {
        const tabs = this._getActiveTabStops()
        const old = tabs[drag.tabIndex]
        if (!old) break
        const newLogical = Math.max(0, old.position + dx / scale)
        this._updateTabStop(drag.tabIndex, {
          position: newLogical,
          type: old.type
        })
        break
      }
    }
    // After any commit the ruler itself needs to repaint — the commit paths
    // pass `isSubmitHistory: false` to draw.render() which *suppresses* the
    // `contentChange` event we subscribe to, so we'd miss the resync without
    // an explicit render call here.
    this.render()
  }

  private _snap(steps: number): number {
    return Math.round(steps * 16) / 16
  }

  // ─── active-paragraph helpers ──────────────────────────────────────────

  private _isActivePage(pageNo: number): boolean {
    return this.draw.getPageNo() === pageNo
  }

  private _getActiveIndents(): {
    indent: number
    firstLineIndent: number
    rightIndent: number
    listLevel: number
  } | null {
    const range = this.draw.getRange()
    const info = range.getRangeParagraphInfo()
    if (!info || !info.elementList.length) return null
    const first = info.elementList[0]
    return {
      indent: first.indent || 0,
      firstLineIndent: first.firstLineIndent || 0,
      rightIndent: first.rightIndent || 0,
      listLevel: first.listId ? (first.listLevel ?? 1) : 0
    }
  }

  private _getActiveTabStops(): ITabStop[] {
    const range = this.draw.getRange()
    const info = range.getRangeParagraphInfo()
    if (!info || !info.elementList.length) return []
    return info.elementList[0].tabStops || []
  }

  private _getActiveTableColInfo(): {
    elementIndex: number
    colgroup: number[]
    tableX: number
  } | null {
    const ctxInfo = this.draw.getPosition().getPositionContext()
    if (!ctxInfo.isTable || ctxInfo.index === undefined) return null
    const elementList = this.draw.getOriginalElementList()
    const table = elementList[ctxInfo.index]
    if (!table?.colgroup) return null
    return {
      elementIndex: ctxInfo.index,
      colgroup: table.colgroup.map(c => c.width),
      tableX: table.translateX || 0
    }
  }

  // ─── model commit paths ────────────────────────────────────────────────

  private _commitParagraphIndents(payload: {
    indent?: number
    firstLineIndent?: number
    rightIndent?: number
  }) {
    const range = this.draw.getRange()
    const info = range.getRangeParagraphInfo()
    if (!info) return
    const elements = info.elementList
    const startIndex = info.startIndex
    const endIndex = startIndex + elements.length - 1

    const before = elements.map(el => ({
      el,
      indent: el.indent,
      firstLineIndent: el.firstLineIndent,
      rightIndent: el.rightIndent
    }))

    const apply = () => {
      for (const el of elements) {
        if (payload.indent !== undefined) {
          if (payload.indent === 0) delete el.indent
          else el.indent = payload.indent
        }
        if (payload.firstLineIndent !== undefined) {
          if (payload.firstLineIndent === 0) delete el.firstLineIndent
          else el.firstLineIndent = payload.firstLineIndent
        }
        if (payload.rightIndent !== undefined) {
          if (payload.rightIndent === 0) delete el.rightIndent
          else el.rightIndent = payload.rightIndent
        }
      }
    }
    const revert = () => {
      for (const item of before) {
        if (item.indent !== undefined) item.el.indent = item.indent
        else delete item.el.indent
        if (item.firstLineIndent !== undefined)
          item.el.firstLineIndent = item.firstLineIndent
        else delete item.el.firstLineIndent
        if (item.rightIndent !== undefined)
          item.el.rightIndent = item.rightIndent
        else delete item.el.rightIndent
      }
    }
    apply()
    const r = this.draw.getRange().getRange()
    const isSetCursor = r.startIndex === r.endIndex
    const curIndex = isSetCursor ? r.endIndex : r.startIndex
    this.draw.getHistoryManager().executeDelta({
      applyForward: () => {
        apply()
        this.draw.markDirty(startIndex, endIndex)
        this.draw.cancelScheduledRender()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      },
      applyBackward: () => {
        revert()
        this.draw.markDirty(startIndex, endIndex)
        this.draw.cancelScheduledRender()
        this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      }
    })
    this.draw.markDirty(startIndex, endIndex)
    this.draw.cancelScheduledRender()
    this.draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
  }

  private _commitMargin(slot: 0 | 1 | 2 | 3, value: number) {
    const margins = this.options.margins.slice() as [number, number, number, number]
    margins[slot] = value
    // Route through setPaperMargin so top/bottom-only drags hit the
    // computeRowList-skip fast path (Draw.ts:2010). Left/right drags fall
    // back to the slow path internally because innerWidth changes.
    this.draw.setPaperMargin(margins)
  }

  private _commitColumnWidth(
    tableIndex: number,
    colIndex: number,
    newW: number,
    newNextW: number
  ) {
    const elementList = this.draw.getOriginalElementList()
    const table = elementList[tableIndex]
    if (!table?.colgroup) return
    table.colgroup[colIndex].width = newW
    if (table.colgroup[colIndex + 1])
      table.colgroup[colIndex + 1].width = newNextW
    this.draw.markDirty(tableIndex, tableIndex)
    this.draw.render({ isSetCursor: false, isSubmitHistory: false })
  }

  private _addTabStop(logicalX: number) {
    const range = this.draw.getRange()
    const info = range.getRangeParagraphInfo()
    if (!info) return
    const stop: ITabStop = { position: logicalX, type: this.nextTabStopType }
    for (const el of info.elementList) {
      const existing = el.tabStops ? [...el.tabStops] : []
      existing.push(stop)
      existing.sort((a, b) => a.position - b.position)
      el.tabStops = existing
    }
    const start = info.startIndex
    const end = start + info.elementList.length - 1
    this.draw.markDirty(start, end)
    this.draw.render({ isSetCursor: false, isSubmitHistory: false })
  }

  private _removeTabStop(index: number) {
    const range = this.draw.getRange()
    const info = range.getRangeParagraphInfo()
    if (!info) return
    for (const el of info.elementList) {
      if (!el.tabStops) continue
      const copy = [...el.tabStops]
      copy.splice(index, 1)
      if (copy.length === 0) delete el.tabStops
      else el.tabStops = copy
    }
    const start = info.startIndex
    const end = start + info.elementList.length - 1
    this.draw.markDirty(start, end)
    this.draw.render({ isSetCursor: false, isSubmitHistory: false })
  }

  private _updateTabStop(index: number, stop: ITabStop) {
    const range = this.draw.getRange()
    const info = range.getRangeParagraphInfo()
    if (!info) return
    for (const el of info.elementList) {
      if (!el.tabStops) continue
      const copy = [...el.tabStops]
      copy[index] = stop
      copy.sort((a, b) => a.position - b.position)
      el.tabStops = copy
    }
    const start = info.startIndex
    const end = start + info.elementList.length - 1
    this.draw.markDirty(start, end)
    this.draw.render({ isSetCursor: false, isSubmitHistory: false })
  }

  /** Adjust indent for context menu / keyboard shortcut actions.
   *  `deltaIndent` and `deltaFirst` are added to the current values
   *  with appropriate clamping (indent >= 0, firstLineIndent >= -indent). */
  private _adjustIndent(deltaIndent: number, deltaFirst: number) {
    const ind = this._getActiveIndents()
    if (!ind) return
    const payload: { indent?: number; firstLineIndent?: number } = {}
    if (deltaIndent) {
      let newIndent = ind.indent + deltaIndent
      if (newIndent < 0) newIndent = 0
      payload.indent = this._snap(newIndent)
    }
    if (deltaFirst) {
      let newFirst = ind.firstLineIndent + deltaFirst
      const minFirst = -(payload.indent ?? ind.indent)
      if (newFirst < minFirst) newFirst = minFirst
      payload.firstLineIndent = this._snap(newFirst)
    }
    this._commitParagraphIndents(payload)
    this.render()
  }

  private _clearAllTabStops() {
    const range = this.draw.getRange()
    const info = range.getRangeParagraphInfo()
    if (!info) return
    for (const el of info.elementList) {
      if (el.tabStops) delete el.tabStops
    }
    const start = info.startIndex
    const end = start + info.elementList.length - 1
    this.draw.markDirty(start, end)
    this.draw.render({ isSetCursor: false, isSubmitHistory: false })
  }

  // ─── context menu ──────────────────────────────────────────────────────

  /** Open the Word-style ruler context menu rooted at the click position.
   *  The menu items mirror Word's "Tabs ▸" submenu plus a Hide-ruler entry.
   *  The user's click x (relative to the canvas) is captured so "Add … tab
   *  stop" items add a stop at exactly that column, matching Word's
   *  "right-click on the ruler to add a stop where you clicked" gesture. */
  private _openContextMenu(e: MouseEvent, f: PageFrame) {
    this._closeContextMenu()
    const rect = f.hRuler.getBoundingClientRect()
    const xInCanvas = e.clientX - rect.left
    const yInCanvas = e.clientY - rect.top
    const margins = this.draw.getMargins()
    const scale = this.options.scale
    // Convert click-x to a logical-px column relative to the paragraph's
    // content-left edge — the same origin tabStops are stored in. We don't
    // require the click to land in the content band; out-of-band clicks
    // (in the margin gray) still open the menu but grey the "Add tab stop"
    // entries when the column is < 0.
    const clickLogicalX = (xInCanvas - margins[3]) / scale
    // If the click was directly on an existing tab stop, surface "Remove
    // tab stop here" as the first menu entry (Word UX).
    const hit = this._hitTestHRuler(f, xInCanvas, yInCanvas)
    const onTabStopIndex =
      hit?.kind === 'tab-stop' && hit.index !== undefined ? hit.index : -1

    type Action =
      | { kind: 'remove-here'; index: number }
      | { kind: 'tab'; type: TabStopType; label: string }
      | { kind: 'separator' }
      | { kind: 'custom' }
      | { kind: 'clear-all' }
      | { kind: 'increase-indent' }
      | { kind: 'decrease-indent' }
      | { kind: 'hanging-indent' }
      | { kind: 'remove-hanging-indent' }
      | { kind: 'hide-ruler' }
    const items: Action[] = []
    if (onTabStopIndex !== -1) {
      items.push(
        { kind: 'remove-here', index: onTabStopIndex },
        { kind: 'separator' }
      )
    }
    items.push(
      { kind: 'tab', type: TabStopType.LEFT, label: 'Add left tab stop' },
      { kind: 'tab', type: TabStopType.CENTER, label: 'Add centre tab stop' },
      { kind: 'tab', type: TabStopType.RIGHT, label: 'Add right tab stop' },
      { kind: 'tab', type: TabStopType.DECIMAL, label: 'Add decimal tab stop' },
      { kind: 'tab', type: TabStopType.BAR, label: 'Add bar tab stop' },
      { kind: 'separator' },
      { kind: 'custom' },
      { kind: 'clear-all' },
      { kind: 'separator' },
      { kind: 'increase-indent' },
      { kind: 'decrease-indent' },
      { kind: 'hanging-indent' },
      { kind: 'remove-hanging-indent' },
      { kind: 'separator' },
      { kind: 'hide-ruler' }
    )

    const menu = document.createElement('div')
    menu.classList.add(`${EDITOR_PREFIX}-ruler-menu`)
    // Stop clicks inside the menu from closing it via the outside-click
    // listener (which checks `target` against the menu element).
    menu.addEventListener('mousedown', evt => evt.stopPropagation())
    menu.addEventListener('contextmenu', evt => {
      evt.preventDefault()
      evt.stopPropagation()
    })

    const isInContent = clickLogicalX >= 0
    for (const item of items) {
      if (item.kind === 'separator') {
        const sep = document.createElement('div')
        sep.classList.add(`${EDITOR_PREFIX}-ruler-menu-sep`)
        menu.appendChild(sep)
        continue
      }
      const row = document.createElement('div')
      row.classList.add(`${EDITOR_PREFIX}-ruler-menu-item`)
      let label = ''
      let glyph = ''
      let disabled = false
      let action = () => {}
      switch (item.kind) {
        case 'remove-here':
          label = 'Remove tab stop here'
          glyph = '×'
          action = () => {
            this._removeTabStop(item.index)
            this.render()
          }
          break
        case 'tab':
          label = item.label
          glyph = this._tabStopGlyphChar(item.type)
          disabled = !isInContent
          action = () => {
            this.nextTabStopType = item.type
            this._addTabStop(clickLogicalX)
            this.render()
          }
          break
        case 'custom':
          label = 'Custom tab stop'
          glyph = '⚙'
          disabled = !isInContent
          action = () => this._promptCustomTabStop(clickLogicalX)
          break
        case 'clear-all':
          label = 'Clear all tab stops'
          glyph = '🗑'
          action = () => {
            this._clearAllTabStops()
            this.render()
          }
          break
        case 'increase-indent':
          label = 'Increase indent \u2318M'
          glyph = '\u25B6\u25B6'
          disabled = !isInContent
          action = () => this._adjustIndent(1, 0)
          break
        case 'decrease-indent':
          label = 'Decrease indent \u2318\u21E7M'
          glyph = '\u25C0\u25C0'
          disabled = !isInContent
          action = () => this._adjustIndent(-1, 0)
          break
        case 'hanging-indent':
          label = 'Hanging indent \u2318T'
          glyph = '\u25B6'
          disabled = !isInContent
          action = () => this._adjustIndent(1, -1)
          break
        case 'remove-hanging-indent':
          label = 'Remove hanging indent \u2318\u21E7T'
          glyph = '\u25C0'
          disabled = !isInContent
          action = () => this._adjustIndent(-1, 1)
          break
        case 'hide-ruler':
          label = 'Hide ruler'
          glyph = '⌗'
          action = () => this._hideRuler()
          break
      }
      if (disabled) row.classList.add('disabled')
      // Lean DOM — a glyph cell + a label cell. Pure inline content; no
      // icons module to pull in, keeps the bundle delta minimal.
      const glyphEl = document.createElement('span')
      glyphEl.classList.add(`${EDITOR_PREFIX}-ruler-menu-glyph`)
      glyphEl.textContent = glyph
      const labelEl = document.createElement('span')
      labelEl.classList.add(`${EDITOR_PREFIX}-ruler-menu-label`)
      labelEl.textContent = label
      row.appendChild(glyphEl)
      row.appendChild(labelEl)
      if (!disabled) {
        row.addEventListener('mousedown', evt => {
          evt.stopPropagation()
          action()
          this._closeContextMenu()
        })
      }
      menu.appendChild(row)
    }

    // Positioning: anchor at the click client coords. Position is relative to
    // the document body (the menu is appended there) so it survives editor
    // scrolling without weird stacking-context issues from being inside the
    // editor container.
    menu.style.position = 'fixed'
    menu.style.left = `${e.clientX}px`
    menu.style.top = `${e.clientY}px`
    menu.style.zIndex = '10000'
    document.body.appendChild(menu)

    // Clamp into viewport in case the click was near the right/bottom edge.
    const menuRect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (menuRect.right > vw - 4) {
      menu.style.left = `${Math.max(4, vw - menuRect.width - 4)}px`
    }
    if (menuRect.bottom > vh - 4) {
      menu.style.top = `${Math.max(4, vh - menuRect.height - 4)}px`
    }

    this.openMenu = menu
    this.menuOutsideClick = (evt: MouseEvent) => {
      const target = evt.target as Node | null
      if (target && this.openMenu && !this.openMenu.contains(target)) {
        this._closeContextMenu()
      }
    }
    // Defer attachment so the same click that opened the menu doesn't
    // immediately close it (the click event is still mid-dispatch).
    setTimeout(() => {
      if (this.menuOutsideClick) {
        document.addEventListener('mousedown', this.menuOutsideClick, true)
      }
    }, 0)
  }

  private _closeContextMenu() {
    if (this.menuOutsideClick) {
      document.removeEventListener('mousedown', this.menuOutsideClick, true)
      this.menuOutsideClick = null
    }
    if (this.openMenu) {
      this.openMenu.remove()
      this.openMenu = null
    }
  }

  /** Word's Tabs dialog has a numeric field for a custom stop position. We
   *  emulate the bare minimum with `prompt()` — replace with a real dialog
   *  in a follow-up if desired. Position is parsed in the ruler's display
   *  unit (inches/cm/mm/px). */
  private _promptCustomTabStop(defaultLogicalX: number) {
    const unit = this.options.ruler.unit
    const unitPxAt1 = this._unitPxAtScale(unit, 1)
    const defaultInUnit = (defaultLogicalX / unitPxAt1).toFixed(2)
    const raw = window.prompt(
      `Tab stop position (${unit}):`,
      defaultInUnit
    )
    if (raw === null) return
    const parsed = parseFloat(raw)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const logicalX = parsed * unitPxAt1
    this._addTabStop(logicalX)
    this.render()
  }

  /** "Hide ruler" — flip the option and tear down our DOM. The option is
   *  mutable on the live `options` object (DeepRequired), so this is a
   *  one-way switch unless the host re-enables the ruler via updateOption.
   *  This matches Word's "View ▸ Ruler" toggle UX. */
  private _hideRuler() {
    this.options.ruler.disabled = true
    this._closeContextMenu()
    for (const f of this.frames) this._detachFrame(f)
    this.frames = []
    this._restoreContainerSpacing()
  }

  /** A single ASCII glyph standing in for each tab-stop type, used in the
   *  context menu (matches the icons Word draws in its submenu). */
  private _tabStopGlyphChar(type: TabStopType): string {
    switch (type) {
      case TabStopType.LEFT:
        return 'L'
      case TabStopType.CENTER:
        return '⊥'
      case TabStopType.RIGHT:
        return '⌐'
      case TabStopType.DECIMAL:
        return '⊥.'
      case TabStopType.BAR:
        return '|'
    }
  }
}
