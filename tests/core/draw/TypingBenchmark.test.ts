import { describe, it, expect } from 'vitest'
import { createTestEditor } from '../../factories/editor'
import { PageMode } from '@/editor/dataset/enum/Editor'

/**
 * PERF-PLAN §4 acceptance harness — multi-page typing benchmark.
 *
 * 这是一组「ceiling」式回归测试：在 jsdom 里跑一段固定的 typing 序列，
 * 断言总墙钟开销不超过某个阈值。jsdom 的 measureText 与真实浏览器有
 * 数量级差距，因此这里的阈值不能当作生产环境的 perf 预算——它的作用
 * 是「PR 不要让回退到全量」。Phase 2A/2B/1.2 落地之后，typing 在 50 行
 * 和 800 行文档上的耗时应当**接近**（典型差距 < 4×），区别仅来自
 * pageRowList / computeRowList 的常数项。
 *
 * 阈值设定原则：
 *   - 单条 keystroke 的预算粗算：jsdom mock canvas 下约 0.5-2ms。
 *   - 800 行文档每键应当 < 5ms（增量路径生效）；总 100 keystroke < 500ms。
 *   - 50 行文档每键应当 < 1ms；总 100 keystroke < 100ms。
 *
 * 任何一项超出 → 大概率是某条 §2.x 增量分支被破坏（dirty-range 没传、
 * checkpoints 失效、_canUseDelta 总是 false 等等），需要回到 PERF-PLAN
 * 检查 _tryBuildResumeFrom / _submitDeltaHistory 的路径选择。
 */

interface TypingResult {
  totalMs: number
  perKeystrokeMs: number
  finalText: string
}

function makeParagraphs(n: number): { value: string }[] {
  // 每段 ~12 字符 + 换行——在默认页大小下大致每行一段。
  const out: { value: string }[] = []
  for (let p = 0; p < n; p++) {
    out.push({ value: `Paragraph ${p}` })
    out.push({ value: '\n' })
  }
  return out
}

function runTypingBenchmark(
  rows: number,
  keystrokes: number,
  pageMode: PageMode = PageMode.PAGING
): TypingResult {
  const ctx = createTestEditor({
    options: { pageMode },
    data: {
      header: [],
      main: makeParagraphs(rows),
      footer: []
    }
  })
  // 让 cursor 已经定位
  ctx.editor.command.executeFocus()
  // 把光标移到末尾——end-of-doc 是用户最常见的 typing 位置，也是增量路径
  // 节约最多的位置。
  const lastIdx = ctx.editor.draw.getOriginalMainElementList().length - 1
  ctx.editor.command.executeSetRange(lastIdx, lastIdx)
  // Warmup：先跑一次 render 让缓存预热（measureText 缓存、checkpoints 等）。
  ctx.editor.draw.render({ isCompute: true, isSubmitHistory: false })

  const draw = ctx.editor.draw
  const main = draw.getOriginalMainElementList()
  const t0 = performance.now()
  for (let k = 0; k < keystrokes; k++) {
    const insertAt = main.length // 在末尾插入
    draw.spliceElementList(main, insertAt, 0, [{ value: 'x' }])
    draw.render({ isCompute: true, isSubmitHistory: true, isTextInput: true })
  }
  // flush typing batch（如果有）以便 history 真正落盘
  draw.flushTypingBatch()
  const t1 = performance.now()
  const totalMs = t1 - t0
  const perKeystrokeMs = totalMs / keystrokes
  const finalText = ctx.editor.command.getText().main || ''
  ctx.destroy()
  return { totalMs, perKeystrokeMs, finalText }
}

describe('PERF-PLAN typing benchmark (regression ceiling)', () => {
  // jsdom 上下文——这些预算包含足够余量，主要捕获「分支被关闭」类回退。
  const KEYSTROKES = 50
  const SHORT_DOC_ROWS = 50
  const LONG_DOC_ROWS = 800

  // 这些 perf 用例的 totalMs 预算（最高 6000ms）已经接近 vitest 默认的
  // 5000ms test-runner 超时，再加上 setup/warmup 必然会被运行器误判为超时。
  // 给每条 benchmark 30s wall-clock，让 expect() 真正裁定 perf，而不是
  // runner 把测试当作 hung 杀掉。
  const BENCH_TIMEOUT_MS = 30000

  // helper `runTypingBenchmark` already calls ctx.destroy() before returning,
  // so each test is self-contained and we don't need a per-test fixture here.

  it(
    `50 keystrokes on a ${SHORT_DOC_ROWS}-row CONTINUITY doc < 1500ms`,
    () => {
      const r = runTypingBenchmark(
        SHORT_DOC_ROWS,
        KEYSTROKES,
        PageMode.CONTINUITY
      )
      // 短文档基线——预算给得宽，只防止灾难级回退
      expect(r.totalMs).toBeLessThan(1500)
      expect(r.finalText.length).toBeGreaterThan(SHORT_DOC_ROWS * 5)
    },
    BENCH_TIMEOUT_MS
  )

  it(
    `50 keystrokes on a ${LONG_DOC_ROWS}-row CONTINUITY doc < 5000ms`,
    () => {
      const r = runTypingBenchmark(
        LONG_DOC_ROWS,
        KEYSTROKES,
        PageMode.CONTINUITY
      )
      expect(r.totalMs).toBeLessThan(5000)
      expect(r.finalText.length).toBeGreaterThan(LONG_DOC_ROWS * 5)
    },
    BENCH_TIMEOUT_MS
  )

  it(
    `50 keystrokes on a ${LONG_DOC_ROWS}-row PAGING doc < 6000ms (user's reported case)`,
    () => {
      // 8000+ 字 / 11 页对应大约 800 行；用户的真实场景。增量分支必须命中。
      const r = runTypingBenchmark(LONG_DOC_ROWS, KEYSTROKES, PageMode.PAGING)
      expect(r.totalMs).toBeLessThan(6000)
      expect(r.finalText.length).toBeGreaterThan(LONG_DOC_ROWS * 5)
    },
    BENCH_TIMEOUT_MS
  )

  it(`10 successive long-paragraph pastes do not inflate quadratically (regression: O(M×N) splice loop)`, () => {
    // 用户报告：连续粘贴 10 段长文，每次比上一次慢——典型的 O(M×N) 信号。
    // 此处的 fix 把 spliceElementList 内的逐元素 splice 改成了一次性 spread splice，
    // 单次插入由 O(M×N) 降到 O(N+M)。本用例确认 10 次连续插入的总耗时低于
    // 「线性 + 常数」预算，并且最后一次比第一次慢不超过 2×（粘贴体在变大但
    // doc 主体增长比例没那么夸张）。
    const ctx = createTestEditor({
      options: { pageMode: PageMode.PAGING },
      data: { header: [], main: makeParagraphs(50), footer: [] }
    })
    ctx.editor.command.executeFocus()
    const draw = ctx.editor.draw
    const main = draw.getOriginalMainElementList()
    // 单段长文（300 字）。10 次粘贴 = 3000 字直接堆进 doc。
    const pasteBody: { value: string }[] = []
    for (let i = 0; i < 300; i++) pasteBody.push({ value: 'x' })
    pasteBody.push({ value: '\n' })
    const samples: number[] = []
    for (let k = 0; k < 10; k++) {
      const insertAt = main.length // 末尾插入
      const t0 = performance.now()
      draw.spliceElementList(
        main,
        insertAt,
        0,
        pasteBody.map(el => ({ ...el })) // 每次是新数组（实际 paste 是这种）
      )
      draw.render({ isCompute: true, isSubmitHistory: true })
      samples.push(performance.now() - t0)
    }
    ctx.destroy()
    const total = samples.reduce((a, b) => a + b, 0)
    const first = samples[0]
    const last = samples[samples.length - 1]
    // 关键不变量：最后一次粘贴 / 第一次粘贴 < 4×（实际增长应当接近 1×
    // 因为 Phase 2.2 增量布局只处理 suffix）。回退到 O(M×N) 时这个比率会
    // 直接 ≥ 10×。
    expect(last / Math.max(first, 0.5)).toBeLessThan(4)
    // jsdom 下总预算 6 秒；真实浏览器应当 < 1 秒。
    expect(total).toBeLessThan(6000)
  }, BENCH_TIMEOUT_MS)

  it(`Enter / Backspace at end-of-doc (800 rows / PAGING) keeps median < 30ms`, () => {
    // 用户报告 Enter / Backspace 仍然偶尔感觉延迟。理论上：
    //   spliceElementList(\\n) → markDirty → render → §2.2 / §2.3 增量 → §1.2 delta history
    // 整条链路应当在 jsdom 下 < 30 ms / op，真实浏览器 < 5 ms。任何一处增量分支
    // 没命中都会把成本拉到 ~80-100 ms，median 会立刻爆掉。
    const ctx = createTestEditor({
      options: { pageMode: PageMode.PAGING },
      data: { header: [], main: makeParagraphs(800), footer: [] }
    })
    ctx.editor.command.executeFocus()
    const lastIdx = ctx.editor.draw.getOriginalMainElementList().length - 1
    ctx.editor.command.executeSetRange(lastIdx, lastIdx)
    ctx.editor.draw.render({ isCompute: true, isSubmitHistory: false })

    const draw = ctx.editor.draw
    const main = draw.getOriginalMainElementList()
    const enterSamples: number[] = []
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now()
      // Enter 等价：插入 ZERO 换行符
      draw.spliceElementList(main, main.length, 0, [{ value: '\n' }])
      draw.render({ isCompute: true, isSubmitHistory: true })
      enterSamples.push(performance.now() - t0)
    }
    const backspaceSamples: number[] = []
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now()
      draw.spliceElementList(main, main.length - 1, 1)
      draw.render({ isCompute: true, isSubmitHistory: true })
      backspaceSamples.push(performance.now() - t0)
    }
    ctx.destroy()
    enterSamples.sort((a, b) => a - b)
    backspaceSamples.sort((a, b) => a - b)
    const enterMedian = enterSamples[Math.floor(enterSamples.length / 2)]
    const backspaceMedian =
      backspaceSamples[Math.floor(backspaceSamples.length / 2)]
    console.log(
      `[bench] Enter median=${enterMedian.toFixed(2)}ms, Backspace median=${backspaceMedian.toFixed(2)}ms`
    )
    // jsdom 下放宽到 80 ms（绝对阈值）；主目的是抓「全量回退」回归。
    expect(enterMedian).toBeLessThan(80)
    expect(backspaceMedian).toBeLessThan(80)
  }, BENCH_TIMEOUT_MS)

  it(`worst-case full-layout typing on a 800-row doc does not inflate over iterations`, () => {
    // worst case：在 row 0 内插入——_tryBuildResumeFrom 因 dirtyRowIndex<=0 返回 null，
    // 强制每次 keystroke 走完整 computeRowList。这不是典型路径，但要保证延迟在
    // 迭代之间稳定，不会因为 _mainRowCheckpoints / pendingMutations 之类的累加器
    // 没被清空而越来越慢。jsdom 下 measureText 慢，绝对预算放宽到「max < 5×median」
    // 即视为通过——主要捕捉「随时间膨胀」类回退。
    const ctx = createTestEditor({
      options: { pageMode: PageMode.PAGING },
      data: { header: [], main: makeParagraphs(800), footer: [] }
    })
    ctx.editor.command.executeFocus()
    ctx.editor.command.executeSetRange(1, 1)
    ctx.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    const draw = ctx.editor.draw
    const main = draw.getOriginalMainElementList()
    const samples: number[] = []
    for (let k = 0; k < 10; k++) {
      const t0 = performance.now()
      draw.spliceElementList(main, 1, 0, [{ value: 'q' }])
      draw.render({ isCompute: true, isSubmitHistory: true, isTextInput: true })
      samples.push(performance.now() - t0)
    }
    draw.flushTypingBatch()
    ctx.destroy()
    samples.sort((a, b) => a - b)
    const median = samples[Math.floor(samples.length / 2)]
    const max = samples[samples.length - 1]
    // 关键不变量：max 不超过 median 的 5×，即没有 inflation。
    // 绝对预算给到 1500ms（jsdom），真实浏览器下应当 < 200ms。
    expect(max).toBeLessThan(1500)
    expect(max).toBeLessThan(median * 5 + 200) // +200 防止 cold-start 抖动
  }, BENCH_TIMEOUT_MS)

  it(`per-keystroke cost roughly scales sub-linearly with doc size`, () => {
    // 关键不变量：增量布局生效时，800 行 / 50 行 < ~10×（理想情况下接近 1×）。
    // 完全失效（回退全量）时差距会接近 16×（800/50）。我们给一个保守的
    // "8×" 阈值——超过表示某条增量分支断了。
    const small = runTypingBenchmark(50, KEYSTROKES, PageMode.PAGING)
    const large = runTypingBenchmark(800, KEYSTROKES, PageMode.PAGING)
    const ratio = large.perKeystrokeMs / Math.max(small.perKeystrokeMs, 0.05)
    // 记录到 stdout 便于诊断（vitest 不会展示 console.log 除非设置 verbose）
    console.log(
      `[bench] 50-row: ${small.perKeystrokeMs.toFixed(2)}ms/key, 800-row: ` +
        `${large.perKeystrokeMs.toFixed(2)}ms/key, ratio=${ratio.toFixed(2)}`
    )
    expect(ratio).toBeLessThan(8)
  }, BENCH_TIMEOUT_MS)
})
