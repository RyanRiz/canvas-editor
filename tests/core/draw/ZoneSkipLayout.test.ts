import { describe, it, expect, afterEach, vi } from 'vitest'
import { createTestEditor } from '../../factories/editor'
import { PageMode } from '@/editor/dataset/enum/Editor'
import { EditorZone } from '@/editor/dataset/enum/Editor'

/**
 * Phase 2 follow-up: render() 应根据当前 zone 与 main dirty 信号跳过主布局。
 *
 * 用户场景：4-page 主文档已就位，光标移入页眉/页脚开始输入。每次按键不应再
 * 重新对整篇主文档跑 computeRowList / computePositionList，否则 4 页内容会
 * 在每帧产生显著延迟。
 */
describe('Draw - skip main layout when editing header/footer', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  it('页眉 zone 且主元素未改时：不再调用主体的 computeRowList', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.CONTINUITY } })
    const draw = ctx.editor.draw
    // 先让首次 render 建立基线
    draw.render({ isCompute: true, isSubmitHistory: false })
    // 切到页眉
    draw.getZone().setZone(EditorZone.HEADER)
    // 监视 computeRowList。页眉 compute 内部也会调用 draw.computeRowList，
    // 但其 elementList 是 header 列表（小）；主体那次 O(N_main) 调用应被跳过。
    const computeSpy = vi.spyOn(draw, 'computeRowList')
    draw.render({ isCompute: true, isSubmitHistory: false })
    // 主元素列表对应的 computeRowList 调用应缺席
    const calledWithMain = computeSpy.mock.calls.some(
      args => args[0]?.elementList === draw.getOriginalMainElementList()
    )
    expect(calledWithMain).toBe(false)
  })

  it('页眉 zone 但显式 markDirty 主列表后：仍会重新布局主体', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.CONTINUITY } })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    draw.getZone().setZone(EditorZone.HEADER)
    draw.markDirty(0, 1)
    const computeSpy = vi.spyOn(draw, 'computeRowList')
    draw.render({ isCompute: true, isSubmitHistory: false })
    const calledWithMain = computeSpy.mock.calls.some(
      args => args[0]?.elementList === draw.getOriginalMainElementList()
    )
    expect(calledWithMain).toBe(true)
  })

  it('页眉 zone 且页眉 dirty 时：page mode 下仍会重新布局页眉，主体仍跳过', () => {
    // 仅 PAGING 模式才有页眉布局；CONTINUITY 模式没有页眉概念。
    ctx = createTestEditor({ options: { pageMode: PageMode.PAGING } })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    draw.getZone().setZone(EditorZone.HEADER)
    // 通过对页眉列表 splice 模拟用户输入：spliceElementList 自动置 _headerDirty
    draw.spliceElementList(draw.getHeaderElementList(), 0, 0, [{ value: 'h' }])
    const computeSpy = vi.spyOn(draw, 'computeRowList')
    draw.render({ isCompute: true, isSubmitHistory: false })
    // 至少调用一次（针对页眉），且没有针对主元素的调用
    expect(computeSpy).toHaveBeenCalled()
    const calledWithMain = computeSpy.mock.calls.some(
      args => args[0]?.elementList === draw.getOriginalMainElementList()
    )
    expect(calledWithMain).toBe(false)
  })

  it('主 zone 渲染时：主元素 computeRowList 必须执行', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.CONTINUITY } })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    // 默认就是 MAIN zone
    // 标记 dirty 以确保布局签名兼容时也会重新计算（不变时跳过）
    draw.markDirty(0, 1)
    const computeSpy = vi.spyOn(draw, 'computeRowList')
    draw.render({ isCompute: true, isSubmitHistory: false })
    const calledWithMain = computeSpy.mock.calls.some(
      args => args[0]?.elementList === draw.getOriginalMainElementList()
    )
    expect(calledWithMain).toBe(true)
  })

  it('首次渲染时（_prevPageRowCounts 为 null）：即便在页眉 zone 也走全量', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.CONTINUITY } })
    const draw = ctx.editor.draw
    draw.getZone().setZone(EditorZone.HEADER)
    draw.invalidatePaintCache()
    const computeSpy = vi.spyOn(draw, 'computeRowList')
    draw.render({ isCompute: true, isSubmitHistory: false })
    const calledWithMain = computeSpy.mock.calls.some(
      args => args[0]?.elementList === draw.getOriginalMainElementList()
    )
    expect(calledWithMain).toBe(true)
  })
})
