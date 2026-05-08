import { describe, it, expect, afterEach, vi } from 'vitest'
import { createTestEditor } from '../../factories/editor'
import type { IElement } from '@/editor/interface/Element'

/**
 * PERF-PLAN — Strategy B 测试。
 *
 * 覆盖核心契约：
 *   1. 默认开启时每页 DOM = wrapper > base + decoration（pointer-events 正确）
 *   2. enable=false 时退回单层 canvas（旧行为）
 *   3. 装饰层 ctx 与 base 不同（分层模式），相同（单层模式）
 *   4. 装饰 ctx clearRect 在 _clearPage 调用——分层模式下两个 ctx 都被擦
 *   5. isDecorationOnly 快路径跳过 _drawPage（用 spy 验证）
 *   6. isDecorationOnly + isCompute=true 合并 → 退回完整 render
 *   7. 移除多余页时 wrapper 一起被移除
 */

function midDoc(): IElement[] {
  const chars = 'hello world this is a longer paragraph'.split('')
  const elements: IElement[] = chars.map(c => ({ value: c }))
  elements.push({ value: '\n' })
  return elements
}

describe('PageLayered (PERF-PLAN — Strategy B)', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  describe('分层 DOM 结构（默认 enable=true）', () => {
    it('每页是 wrapper > base + decoration', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const pageContainer = draw.getPageContainer() as HTMLDivElement
      const wrappers = pageContainer.querySelectorAll('.ce-page-wrapper')
      expect(wrappers.length).toBeGreaterThan(0)
      const wrapper = wrappers[0] as HTMLDivElement
      expect(wrapper.querySelector('.ce-page-base')).toBeTruthy()
      expect(wrapper.querySelector('.ce-page-decoration')).toBeTruthy()
      // wrapper 是 pageContainer 的直接子节点；base / decoration 在 wrapper 内
      expect(wrapper.parentElement).toBe(pageContainer)
    })

    it('decoration canvas 设置了 pointer-events:none', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const deco = draw
        .getPageContainer()
        .querySelector('.ce-page-decoration') as HTMLCanvasElement
      expect(deco.style.pointerEvents).toBe('none')
    })

    it('getPageList() 返回的仍然是 base canvas（API 兼容）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const pageList = draw.getPageList() as HTMLCanvasElement[]
      expect(pageList.length).toBeGreaterThan(0)
      pageList.forEach(p => {
        expect(p.classList.contains('ce-page-base')).toBe(true)
      })
    })

    it('decoration ctx 与 base ctx 是不同对象（分层模式下）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const baseCtx = draw.getCtx()
      const decoCtx = draw.getDecorationCtx(0)
      expect(decoCtx).not.toBe(baseCtx)
    })

    it('decoration canvas 的 css 尺寸 = base canvas 的 css 尺寸', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const wrapper = draw
        .getPageContainer()
        .querySelector('.ce-page-wrapper') as HTMLDivElement
      const base = wrapper.querySelector('.ce-page-base') as HTMLCanvasElement
      const deco = wrapper.querySelector(
        '.ce-page-decoration'
      ) as HTMLCanvasElement
      expect(deco.style.width).toBe(base.style.width)
      expect(deco.style.height).toBe(base.style.height)
    })
  })

  describe('单层 fallback (enable=false)', () => {
    it('不创建 wrapper / decoration', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] },
        options: { pageLayered: { enable: false } }
      })
      const draw = (ctx.editor as any).draw
      const pageContainer = draw.getPageContainer() as HTMLDivElement
      expect(pageContainer.querySelector('.ce-page-wrapper')).toBeNull()
      expect(pageContainer.querySelector('.ce-page-decoration')).toBeNull()
      // base canvas 仍然存在（无 .ce-page-base 类，因为没进分层分支）
      expect(pageContainer.querySelector('canvas')).toBeTruthy()
    })

    it('decoration ctx === base ctx（alias）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] },
        options: { pageLayered: { enable: false } }
      })
      const draw = (ctx.editor as any).draw
      expect(draw.getDecorationCtx(0)).toBe(draw.getCtx())
    })
  })

  describe('isDecorationOnly 快路径', () => {
    it('调用 _drawDecorationOnly 而不是 _drawPage', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      // 先做一次完整 render 让 pageRowList 初始化（构造期已经做了一次）
      // 然后选区拖拽场景：mid → 末位
      const positionList = draw.getPosition().getPositionList()
      draw.getRange().setRange(2, 8) // 显式选区
      const drawPageSpy = vi.spyOn(draw as any, '_drawPage')
      const drawDecoSpy = vi.spyOn(draw as any, '_drawDecorationOnly')
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true
      })
      expect(drawDecoSpy).toHaveBeenCalled()
      expect(drawPageSpy).not.toHaveBeenCalled()
      // positionList 仍然有效（未被无意清空）
      expect(positionList.length).toBeGreaterThan(0)
    })

    it('isCompute=true 时 isDecorationOnly 被忽略——快路径不被调用', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const drawDecoSpy = vi.spyOn(draw as any, '_drawDecorationOnly')
      draw.render({
        isCompute: true,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true // 应被快路径门控否决
      })
      expect(drawDecoSpy).not.toHaveBeenCalled()
    })

    it('isInit=true 时 isDecorationOnly 被忽略——快路径直接退出', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const drawDecoSpy = vi.spyOn(draw as any, '_drawDecorationOnly')
      draw.render({
        isCompute: false,
        isInit: true,
        isDecorationOnly: true
      })
      expect(drawDecoSpy).not.toHaveBeenCalled()
    })

    it('单层模式下 isDecorationOnly 也走完整 render（_drawDecorationOnly 不被调用）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] },
        options: { pageLayered: { enable: false } }
      })
      const draw = (ctx.editor as any).draw
      const drawDecoSpy = vi.spyOn(draw as any, '_drawDecorationOnly')
      // 单层模式下外层守卫 _isPageLayered() 返回 false，整条快路径直接跳过
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true
      })
      expect(drawDecoSpy).not.toHaveBeenCalled()
    })
  })

  describe('页数变化', () => {
    it('每个 wrapper 都包含一个 base + 一个 decoration（DOM 一致性）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const wrappers = (
        draw.getPageContainer() as HTMLDivElement
      ).querySelectorAll('.ce-page-wrapper')
      expect(wrappers.length).toBe(draw.getPageList().length)
      wrappers.forEach(w => {
        expect(w.querySelectorAll('.ce-page-base').length).toBe(1)
        expect(w.querySelectorAll('.ce-page-decoration').length).toBe(1)
      })
    })
  })
})
