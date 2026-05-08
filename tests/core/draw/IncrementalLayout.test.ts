import { describe, it, expect, afterEach, vi } from 'vitest'
import { createTestEditor } from '../../factories/editor'
import { EditorZone, PageMode } from '@/editor/dataset/enum/Editor'
import type { ILayoutCheckpoint } from '@/editor/interface/Draw'
import type { IRow } from '@/editor/interface/Row'

/**
 * PERF-PLAN §2.2 / Phase 2B: 增量 computeRowList 行为校验。
 *
 * 这一组用例确保「上一帧 row checkpoint 仍可信」的前提下，render() 走的
 * 增量路径产出的 rowList 与「丢弃缓存重头跑一遍」的全量路径在结构上等价。
 * 不依赖具体像素几何（jsdom canvas 没有真实 measureText），只对 rowList
 * 的结构性字段（startIndex / rowIndex / 元素数量 / wrap 标志）做断言。
 *
 * 同时验证安全降级：dirty 落在第一行 / 布局签名变更 / setEditorData 等情况
 * 必须回退到全量。
 */

interface DrawInternals {
  _mainRowCheckpoints: ILayoutCheckpoint[]
  _mainLayoutSig: unknown
  _dirtyRange: { start: number; end: number } | null
  rowList: IRow[]
  _tryBuildResumeFrom: (extra: {
    isPagingMode: boolean
    innerWidth: number
  }) => unknown
}

function makeManyParagraphs(n: number) {
  // 每段：若干文本 + 换行符——制造若干 wrap 行，模拟典型 1900 字文档。
  const out: { value: string }[] = []
  for (let p = 0; p < n; p++) {
    out.push({ value: `Paragraph ${p}` })
    out.push({ value: '\n' })
  }
  return out
}

describe('Draw - incremental computeRowList (P2.2)', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  it('首次渲染后 _mainRowCheckpoints 与 rowList 长度对齐', () => {
    ctx = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: {
        header: [],
        main: makeManyParagraphs(30),
        footer: []
      }
    })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    const internal = draw as unknown as DrawInternals
    expect(internal._mainRowCheckpoints.length).toBeGreaterThan(0)
    expect(internal._mainRowCheckpoints.length).toBe(internal.rowList.length)
    // 第 0 个 checkpoint 描述「i=0 之前」的初始状态。
    const first = internal._mainRowCheckpoints[0]
    expect(first.x).toBeGreaterThan(0) // startX 由 margin 决定，必为正值
    expect(first.pageNo).toBe(0)
    expect(first.listId).toBeUndefined()
    expect(first.listIndex).toBe(0)
    expect(first.controlRealWidth).toBe(0)
  })

  it('每个 checkpoint 与对应 rowList[R] 的页列配置一致', () => {
    ctx = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { header: [], main: makeManyParagraphs(20), footer: [] }
    })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    const internal = draw as unknown as DrawInternals
    for (let i = 0; i < internal.rowList.length; i++) {
      const row = internal.rowList[i]
      const ckpt = internal._mainRowCheckpoints[i]
      expect(ckpt).toBeDefined()
      // checkpoint 的 currentPageColumns 应该是「即将进入该行第一元素时」的列配置；
      // 它应等于 row.pageColumns（行已落定的列设置）。
      if (row.pageColumns) {
        expect(ckpt.currentPageColumns).toEqual(row.pageColumns)
      }
    }
  })

  it('dirty 落在第二行之后：后续 render 命中增量分支并保留前缀行引用', () => {
    ctx = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { header: [], main: makeManyParagraphs(40), footer: [] }
    })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    const internal = draw as unknown as DrawInternals
    expect(internal.rowList.length).toBeGreaterThanOrEqual(3)

    // 记录前 2 行的引用——增量路径必须复用它们而不是重新创建。
    const baselineRow0 = internal.rowList[0]
    const baselineRow1 = internal.rowList[1]
    const baselineRowCount = internal.rowList.length

    // 在「第 3 行起点之后」的位置标 dirty——保证至少存在 R=2 的可保留前缀。
    const dirtyStart = internal.rowList[2].startIndex + 1
    draw.markDirty(dirtyStart, dirtyStart + 1)

    // 增量决策：返回非 null 表示进入增量路径
    const resume = internal._tryBuildResumeFrom({
      isPagingMode: false,
      innerWidth: 794 - 240
    })
    expect(resume).not.toBeNull()

    draw.render({ isCompute: true, isSubmitHistory: false })

    // 前两行的对象引用应保持不变（增量路径靠 prefixRowList = rowList.slice(0, R) 复用）。
    expect(internal.rowList[0]).toBe(baselineRow0)
    expect(internal.rowList[1]).toBe(baselineRow1)
    // 总行数不应改变（仅在元素未实际变更时；这里只是 markDirty 不动 elementList）
    expect(internal.rowList.length).toBe(baselineRowCount)
  })

  it('dirty 落在第一行内：回退到全量，增量决策返回 null', () => {
    ctx = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { header: [], main: makeManyParagraphs(10), footer: [] }
    })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    const internal = draw as unknown as DrawInternals
    // dirty 起点 = 第一行任一元素索引 → 没有可保留的前缀
    draw.markDirty(0, 1)
    const resume = internal._tryBuildResumeFrom({
      isPagingMode: false,
      innerWidth: 794 - 240
    })
    expect(resume).toBeNull()
  })

  it('setEditorData 后 _mainRowCheckpoints 被失效，下一帧走全量', () => {
    ctx = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { header: [], main: makeManyParagraphs(15), footer: [] }
    })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    const internal = draw as unknown as DrawInternals
    expect(internal._mainRowCheckpoints.length).toBeGreaterThan(0)
    draw.setEditorData({
      main: makeManyParagraphs(5)
    })
    expect(internal._mainRowCheckpoints.length).toBe(0)
    expect(internal._mainLayoutSig).toBeNull()
  })

  it('增量路径与全量路径在结构性字段上字节相等（spliceElementList 后）', () => {
    // 跑两遍：一遍允许增量，一遍每帧之前 invalidatePaintCache() 强制全量。
    // 比较两条路径产出的 rowList 关键字段是否一致。
    function snapshot(rowList: IRow[]) {
      return rowList.map(r => ({
        startIndex: r.startIndex,
        rowIndex: r.rowIndex,
        elementCount: r.elementList.length,
        isPageBreak: !!r.isPageBreak,
        isColumnBreak: !!r.isColumnBreak
      }))
    }

    const data = {
      header: [],
      main: makeManyParagraphs(25),
      footer: []
    }

    // 全量基线
    const a = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { ...data, main: data.main.slice() } as any
    })
    a.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    a.editor.draw.invalidatePaintCache()
    a.editor.draw.spliceElementList(
      a.editor.draw.getOriginalMainElementList(),
      10,
      0,
      [{ value: 'X' }]
    )
    a.editor.draw.invalidatePaintCache() // 强制全量
    a.editor.draw.markDirty(10, 11)
    a.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    const fullSnap = snapshot(
      (a.editor.draw as unknown as DrawInternals).rowList
    )
    a.destroy()

    // 增量路径
    const b = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { ...data, main: data.main.slice() } as any
    })
    b.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    b.editor.draw.spliceElementList(
      b.editor.draw.getOriginalMainElementList(),
      10,
      0,
      [{ value: 'X' }]
    )
    // 不调用 invalidatePaintCache → 走增量
    b.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    const incSnap = snapshot(
      (b.editor.draw as unknown as DrawInternals).rowList
    )
    b.destroy()

    expect(incSnap).toEqual(fullSnap)
  })

  it('开启 __perfValidateLayout 时校验桩成功跑完，不上报 console.error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ctx = createTestEditor({
      options: {
        pageMode: PageMode.CONTINUITY,
        // 隐藏字段：仅供本测试 / dev 验证使用，不在公开类型中暴露。
        __perfValidateLayout: true
      } as any,
      data: { header: [], main: makeManyParagraphs(20), footer: [] }
    })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    // 触发增量
    draw.spliceElementList(draw.getOriginalMainElementList(), 8, 0, [
      { value: 'Y' }
    ])
    draw.render({ isCompute: true, isSubmitHistory: false })

    // 校验桩跑过，但不应出现 row mismatch 报错
    const layoutMismatch = errSpy.mock.calls.some(args =>
      String(args[0] ?? '').includes('[Phase2B/validate]')
    )
    expect(layoutMismatch).toBe(false)
    errSpy.mockRestore()
  })

  it('PERF-PLAN §2.5: 未变更的 td 在第二帧渲染中显著减少递归 computeRowList 调用', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.CONTINUITY } })
    const editor = ctx.editor
    editor.command.executeFocus()
    editor.command.executeInsertTable(2, 2)
    // 首次渲染：所有 td 走 recompute 分支并落盘 cacheKey
    editor.draw.render({ isCompute: true, isSubmitHistory: false })
    // 第一帧实际调用次数（主体 + 4 cells = 至少 5）作为上界基准
    const computeSpy1 = vi.spyOn(editor.draw, 'computeRowList')
    editor.draw.markDirty(0, 1)
    editor.draw.render({ isCompute: true, isSubmitHistory: false })
    // 主体一次 + 部分 cell 可能因为 PAGING 表格分页等原因无法命中（保守上限）。
    // 第一次 baseline 至少是 1 + 4 = 5；命中缓存后总调用应明显下降。
    const calls = computeSpy1.mock.calls.length
    // 至少能命中 2 个 cell（共 4 个）即视为缓存生效。即调用 ≤ 1 (main) + 2 (miss) = 3
    expect(calls).toBeLessThanOrEqual(3)
    computeSpy1.mockRestore()
  })

  it('PERF-PLAN §2.3: 增量 positionList 与全量 positionList 字节相等', () => {
    // 与 §2.2 平行——构造相同初始文档，分别走全量与增量两条路径，断言
    // positionList 在 (index / pageNo / coordinate.leftTop) 这些用户可见字段上一致。
    function snapshot(positions: any[]) {
      return positions.map(p => ({
        index: p.index,
        pageNo: p.pageNo,
        rowIndex: p.rowIndex,
        leftTop: p.coordinate.leftTop.slice(),
        rightBottom: p.coordinate.rightBottom.slice()
      }))
    }
    const data = {
      header: [],
      main: makeManyParagraphs(30),
      footer: []
    }

    // 全量基线
    const a = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { ...data, main: data.main.slice() } as any
    })
    a.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    a.editor.draw.invalidatePaintCache()
    a.editor.draw.spliceElementList(
      a.editor.draw.getOriginalMainElementList(),
      12,
      0,
      [{ value: 'Z' }]
    )
    a.editor.draw.invalidatePaintCache() // 强制全量
    a.editor.draw.markDirty(12, 13)
    a.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    const fullSnap = snapshot(
      a.editor.draw.getPosition().getOriginalMainPositionList()
    )
    a.destroy()

    // 增量路径
    const b = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { ...data, main: data.main.slice() } as any
    })
    b.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    b.editor.draw.spliceElementList(
      b.editor.draw.getOriginalMainElementList(),
      12,
      0,
      [{ value: 'Z' }]
    )
    b.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    const incSnap = snapshot(
      b.editor.draw.getPosition().getOriginalMainPositionList()
    )
    b.destroy()

    expect(incSnap.length).toBe(fullSnap.length)
    expect(incSnap).toEqual(fullSnap)
  })

  it(
    'PERF-PLAN §2.3: 增量分支下 positionList 前缀对象引用被复用',
    () => {
      ctx = createTestEditor({
        options: { pageMode: PageMode.CONTINUITY },
        data: { header: [], main: makeManyParagraphs(40), footer: [] }
      })
      const draw = ctx.editor.draw
      draw.render({ isCompute: true, isSubmitHistory: false })
      const internal = draw as unknown as DrawInternals
      expect(internal.rowList.length).toBeGreaterThanOrEqual(3)

      // 拿到当前 positionList 的若干前缀引用
      const beforePos = draw.getPosition().getOriginalMainPositionList()
      const baselinePos0 = beforePos[0]
      const baselinePos1 = beforePos[1]

      // 在第三行之后 splice，迫使增量分支生效
      const dirtyStart = internal.rowList[2].startIndex + 1
      draw.spliceElementList(
        draw.getOriginalMainElementList(),
        dirtyStart,
        0,
        [{ value: 'q' }]
      )
      draw.render({ isCompute: true, isSubmitHistory: false })

      const afterPos = draw.getPosition().getOriginalMainPositionList()
      // 前缀位置对象应保持同一引用——增量靠 positionList.length 截断 + 复用
      expect(afterPos[0]).toBe(baselinePos0)
      expect(afterPos[1]).toBe(baselinePos1)
    },
    // 40-paragraph CONTINUITY render + splice + re-render in jsdom can run
    // longer than the 5s default test-runner timeout on slower machines —
    // the assertion itself doesn't have a perf budget, so give the test
    // wall-clock room to finish.
    30000
  )

  it('PERF-PLAN §2.2: 收敛检测命中 — 中段插入 1 字符仅重排受影响段落', () => {
    // 构造一个足够大的文档（多段 + 多 wrap），在中段插入一个字符。
    // 增量布局应在跨过 dirty.end 后命中收敛、立即停止；后续行通过
    // oldRowsAfterCut 接驳，不再走 measureText / wrap 判定。
    ctx = createTestEditor({
      options: {
        pageMode: PageMode.CONTINUITY,
        // 同时打开校验桩——增量与全量必须字节相等，否则 console.error 会被监控到。
        __perfValidateLayout: true
      } as any,
      data: { header: [], main: makeManyParagraphs(40), footer: [] }
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    const internal = draw as unknown as DrawInternals & {
      _tryBuildResumeFrom: (extra: {
        isPagingMode: boolean
        innerWidth: number
      }) => {
        startElementIndex: number
        prefixRowList: IRow[]
        checkpoint: ILayoutCheckpoint
        convergenceTarget: {
          oldRowsAfterCut: IRow[]
          oldCheckpointsAfterCut: ILayoutCheckpoint[]
          dirtyEndAbs: number
          matched: { atOldIdx: number } | null
        }
      } | null
    }

    // 在文档中段（足够远离开头让收敛能跳过显著前缀）切一个字
    const midRowIdx = Math.floor(internal.rowList.length / 2)
    const dirtyStart = internal.rowList[midRowIdx].startIndex + 1
    const before = draw.getOriginalMainElementList().length
    draw.spliceElementList(
      draw.getOriginalMainElementList(),
      dirtyStart,
      0,
      [{ value: 'Z' }]
    )

    // 拦截 _tryBuildResumeFrom 拿到本次构造出的 convergenceTarget——render
    // 之后我们能看到 matched 是否被写入。
    let observedTarget:
      | {
          matched: { atOldIdx: number } | null
        }
      | null = null
    const orig = internal._tryBuildResumeFrom.bind(internal)
    ;(internal as unknown as Record<string, unknown>)._tryBuildResumeFrom = (
      extra: { isPagingMode: boolean; innerWidth: number }
    ): unknown => {
      const result = orig(extra) as {
        convergenceTarget?: { matched: { atOldIdx: number } | null }
      } | null
      if (result?.convergenceTarget) observedTarget = result.convergenceTarget
      return result
    }

    draw.render({ isCompute: true, isSubmitHistory: false })

    // 元素数加 1
    expect(draw.getOriginalMainElementList().length).toBe(before + 1)
    // 收敛必须命中：增量布局只重排到 dirty 段落末尾，旧尾部直接接驳。
    expect(observedTarget).not.toBeNull()
    expect(observedTarget!.matched).not.toBeNull()
    // 校验桩没报错——增量结果与全量字节相等
    const layoutMismatch = errSpy.mock.calls.some(args =>
      String(args[0] ?? '').includes('[Phase2B/validate]')
    )
    expect(layoutMismatch).toBe(false)
    errSpy.mockRestore()
  })

  it('PERF-PLAN follow-up: 收敛 + pagination 稳定时，positionList 与全量字节相等', () => {
    // 平行场景：A 走增量 + 收敛尾部复用；B 强制全量。比较 positionList 关键
    // 字段（pageNo / index / coordinate.leftTop[0..1]）必须字节相等。
    function snapshot(positions: { pageNo: number; index: number; coordinate: { leftTop: number[] } }[]) {
      return positions.map(p => ({
        pageNo: p.pageNo,
        index: p.index,
        x: p.coordinate.leftTop[0],
        y: p.coordinate.leftTop[1]
      }))
    }
    const data = {
      header: [],
      main: makeManyParagraphs(40),
      footer: []
    }
    const a = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { ...data, main: data.main.slice() } as any
    })
    a.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    const internalA = a.editor.draw as unknown as DrawInternals
    const midRowIdx = Math.floor(internalA.rowList.length / 2)
    const dirtyStart = internalA.rowList[midRowIdx].startIndex + 1
    a.editor.draw.spliceElementList(
      a.editor.draw.getOriginalMainElementList(),
      dirtyStart,
      0,
      [{ value: 'Z' }]
    )
    a.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    const incSnap = snapshot(
      a.editor.draw.getPosition().getOriginalMainPositionList()
    )
    a.destroy()

    const b = createTestEditor({
      options: { pageMode: PageMode.CONTINUITY },
      data: { ...data, main: data.main.slice() } as any
    })
    b.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    b.editor.draw.spliceElementList(
      b.editor.draw.getOriginalMainElementList(),
      dirtyStart,
      0,
      [{ value: 'Z' }]
    )
    b.editor.draw.invalidatePaintCache() // 强制全量
    b.editor.draw.render({ isCompute: true, isSubmitHistory: false })
    const fullSnap = snapshot(
      b.editor.draw.getPosition().getOriginalMainPositionList()
    )
    b.destroy()

    expect(incSnap.length).toBe(fullSnap.length)
    for (let i = 0; i < incSnap.length; i++) {
      expect(incSnap[i]).toEqual(fullSnap[i])
    }
  })

  it('页眉 zone 输入不应误启用主体增量（mainNeedsCompute=false 路径）', () => {
    // 跨 zone 安全：页眉/页脚 zone 输入不动主元素 dirty range，render() 跳过主体
    // 整个 if (mainNeedsCompute) 块——增量决策 / checkpointSink 都不参与。
    ctx = createTestEditor({
      options: { pageMode: PageMode.PAGING },
      data: { header: [], main: makeManyParagraphs(15), footer: [] }
    })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    // 切到页眉
    draw.getZone().setZone(EditorZone.HEADER)
    draw.spliceElementList(draw.getHeaderElementList(), 0, 0, [{ value: 'h' }])
    const internal = draw as unknown as DrawInternals
    const beforeCkptLen = internal._mainRowCheckpoints.length
    draw.render({ isCompute: true, isSubmitHistory: false })
    // 主体 checkpoint 不应被覆盖
    expect(internal._mainRowCheckpoints.length).toBe(beforeCkptLen)
  })
})
