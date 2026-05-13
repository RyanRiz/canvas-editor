import { describe, it, expect, afterEach } from 'vitest'
import { createTestEditor } from '../../factories/editor'
import { PageMode } from '@/editor/dataset/enum/Editor'

/**
 * Phase 2 dirty-range / dirty-page paint。
 *
 * 这些用例只验证「dirty 提示沿正确路径流过」与「渲染后被清空」——
 * 实际 paint 跳过逻辑要在 jsdom 之外用真实浏览器 / e2e 才能精确观测，
 * 这里通过对 Draw 公共 API 和内部缓存做行为断言。
 */
describe('Draw - dirty range tracking (P2.1)', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  it('markDirty 多次调用取并集', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    draw.clearDirtyRange()
    draw.markDirty(5, 10)
    draw.markDirty(3, 7)
    draw.markDirty(8, 20)
    const range = draw.getDirtyRange()
    expect(range).not.toBeNull()
    expect(range!.start).toBe(3)
    expect(range!.end).toBe(20)
  })

  it('clearDirtyRange 重置回 null', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    draw.markDirty(0, 1)
    draw.clearDirtyRange()
    expect(draw.getDirtyRange()).toBeNull()
  })

  it('spliceElementList 自动标记主元素列表 dirty 区间', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    // 强制 render 一次，让 dirty range 被清空
    draw.render({ isCompute: true, isSubmitHistory: false })
    expect(draw.getDirtyRange()).toBeNull()
    // 走主列表 splice：插入两个元素
    draw.spliceElementList(draw.getOriginalMainElementList(), 1, 0, [
      { value: 'a' },
      { value: 'b' }
    ])
    const range = draw.getDirtyRange()
    expect(range).not.toBeNull()
    expect(range!.start).toBe(1)
    expect(range!.end).toBe(3)
  })

  it('spliceElementList 操作 header 不会污染主列表 dirty 提示', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    expect(draw.getDirtyRange()).toBeNull()
    const header = draw.getHeaderElementList()
    draw.spliceElementList(header, 0, 0, [{ value: 'h' }])
    expect(draw.getDirtyRange()).toBeNull()
  })

  it('render 完成后 dirty 提示被清空', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    draw.markDirty(0, 5)
    expect(draw.getDirtyRange()).not.toBeNull()
    draw.render({ isCompute: true, isSubmitHistory: false })
    expect(draw.getDirtyRange()).toBeNull()
  })

  it('invalidatePaintCache 不抛错，可作为外部 setEditorData 之类的钩子', () => {
    ctx = createTestEditor()
    expect(() => ctx.editor.draw.invalidatePaintCache()).not.toThrow()
  })

  it('render 后 _prevPageRowCounts 被填充；invalidatePaintCache 清空缓存', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw
    const internal = draw as unknown as {
      _prevPageRowCounts: number[] | null
      _drawnPages: Set<number>
    }
    // 构造首次渲染后状态
    draw.render({ isCompute: true, isSubmitHistory: false })
    expect(internal._prevPageRowCounts).not.toBeNull()
    expect(internal._prevPageRowCounts!.length).toBeGreaterThan(0)
    // invalidate 后两个 paint cache 都应被清空
    draw.invalidatePaintCache()
    expect(internal._prevPageRowCounts).toBeNull()
    expect(internal._drawnPages.size).toBe(0)
  })

  // 以下用例验证 _immediateRender 的差量行为。jsdom 中 IntersectionObserver
  // 不会主动 fire，因此关闭分页（CONTINUITY）让渲染走 _immediateRender 路径。
  it('无 dirty 提示时 render 走全量重绘路径（_drawnPages 在本帧前被清空，再回填）', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.CONTINUITY } })
    const draw = ctx.editor.draw
    const internal = draw as unknown as { _drawnPages: Set<number> }
    draw.render({ isCompute: true, isSubmitHistory: false })
    const firstRunSize = internal._drawnPages.size
    expect(firstRunSize).toBeGreaterThan(0)
    // 不 markDirty 再渲染：dirtyPages=null，先 clear 再画——最终覆盖所有 page
    draw.render({ isCompute: true, isSubmitHistory: false })
    expect(internal._drawnPages.size).toBe(firstRunSize)
  })

  it('markDirty 后 render 走差量路径（不清空 _drawnPages）', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.CONTINUITY } })
    const draw = ctx.editor.draw
    const internal = draw as unknown as { _drawnPages: Set<number> }
    draw.render({ isCompute: true, isSubmitHistory: false })
    const baselinePages = new Set(internal._drawnPages)
    expect(baselinePages.size).toBeGreaterThan(0)
    draw.markDirty(0, 1)
    draw.render({ isCompute: true, isSubmitHistory: false })
    for (const idx of baselinePages) {
      expect(internal._drawnPages.has(idx)).toBe(true)
    }
  })

  it('isCompute=false 时不计算 dirtyPages（保留旧的全量行为）', () => {
    ctx = createTestEditor({ options: { pageMode: PageMode.CONTINUITY } })
    const draw = ctx.editor.draw
    draw.render({ isCompute: true, isSubmitHistory: false })
    // 仅光标重绘（如方向键）：isCompute=false 时 dirtyPages 强制为 null
    draw.markDirty(0, 1)
    draw.render({ isCompute: false, isSubmitHistory: false, isSetCursor: false })
    // 上述调用不应抛错，并清空 dirty 提示
    expect(draw.getDirtyRange()).toBeNull()
  })
})
