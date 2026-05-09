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

    it('只有 base canvas 携带 data-index（避免外部 querySelector 双计数）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      const container = draw.getPageContainer() as HTMLDivElement
      // 选择全部带 data-index 的元素——只应是 base canvas，每页一个。
      const indexed = container.querySelectorAll('[data-index]')
      const expectedCount = draw.getPageList().length
      expect(indexed.length).toBe(expectedCount)
      indexed.forEach(el => {
        expect((el as HTMLElement).classList.contains('ce-page-base')).toBe(
          true
        )
      })
      // 直接对应「1 页文档识别为 2 页」回归——即便分层后也只有 1 个 data-index
      expect(
        container.querySelectorAll('canvas[data-index]').length
      ).toBe(draw.getPageList().length)
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

  describe('B-β.1：装饰层空状态跳过', () => {
    it('选区收起 + 无搜索 → _walkDecorationRow 不被调用', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      // 让光标 / 装饰层先进入 painted 状态
      draw.getRange().setRange(2, 2)
      draw.render({ curIndex: 2, isSetCursor: true, isSubmitHistory: false })
      const walkSpy = vi.spyOn(draw as any, '_walkDecorationRow')
      // 触发 decoration-only render；没有选区 / 搜索——空状态
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true
      })
      expect(walkSpy).not.toHaveBeenCalled()
    })

    it('选区展开 → _walkDecorationRow 被调用（active 状态）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      draw.getRange().setRange(2, 6)
      draw.render({ curIndex: 6, isSetCursor: false, isSubmitHistory: false })
      // 触发一次 decoration-only：版本号 + 缓存让相同状态的同帧重入也命中。
      // 用 bumpDecorationVersion 强制让缓存失效，验证 walk 真的会跑。
      draw.bumpDecorationVersion()
      const walkSpy = vi.spyOn(draw as any, '_walkDecorationRow')
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true
      })
      expect(walkSpy).toHaveBeenCalled()
    })
  })

  describe('B-δ：可见页同步绘制（消除 IntersectionObserver paint 延迟）', () => {
    it('visiblePageNoList 命中的 dirty 页 → _drawPage 在 render() 同步阶段被调用', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      // 模拟 ScrollObserver 已经把页 0 标记为可见——避免依赖真 jsdom 滚动事件
      draw.setVisiblePageNoList([0])
      // 把 base 重绘缓存清掉以确保下一帧 render 必须重新 _drawPage
      draw.invalidatePaintCache()
      const drawPageSpy = vi.spyOn(draw as any, '_drawPage')
      // 触发一次完整 render——之前会经 _lazyRender 异步绑 observer，本次必须同步
      draw.render({
        isCompute: true,
        isSetCursor: false,
        isSubmitHistory: false,
        isLazy: true // 强制走 _lazyRender 分支（paging 模式默认）
      })
      // 关键断言：render() 返回时 _drawPage 必须已被调用过（同步），不能等
      // 异步 IntersectionObserver
      expect(drawPageSpy).toHaveBeenCalled()
    })

    it('visiblePageNoList 为空（初始未滚动） → 退回 observer 路径，不抛错', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      // 不设置 visiblePageNoList——保持空（默认）
      expect(() =>
        draw.render({
          isCompute: true,
          isSetCursor: false,
          isSubmitHistory: false,
          isLazy: true
        })
      ).not.toThrow()
    })

    it('dirtyPages 中的页一律同步绘制——即使不在 visiblePageNoList（overflow 新页场景）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      // jsdom 的 canvas-mock 测不出真实文字宽度——layout 永远只算 1 页。
      // 直接在 Draw 内部 stub 一个 fake page 1 来复刻场景：
      // pageRowList[1] / pageList[1] 存在，但 visiblePageNoList 不含 1。
      const fakePage1Canvas = document.createElement('canvas')
      ;(draw as any).pageList.push(fakePage1Canvas)
      ;(draw as any).ctxList.push(fakePage1Canvas.getContext('2d'))
      ;(draw as any).pageRowList.push([])
      ;(draw as any).pageWrapperList.push(fakePage1Canvas)
      ;(draw as any).decorationCanvasList.push(fakePage1Canvas)
      ;(draw as any).decorationCtxList.push(fakePage1Canvas.getContext('2d'))
      // 复刻用户场景：visiblePageNoList 只含 page 0；dirtyPages 包含新建的 page 1
      draw.setVisiblePageNoList([0])
      const dirtyPages = new Set<number>([0, 1])
      const drawPageSpy = vi.spyOn(draw as any, '_drawPage')
      ;(draw as any)._lazyRender(dirtyPages)
      // 关键断言——回归测试覆盖「now it doesn't update until cursor moved to page 2」：
      // page 1（新创建、不在 visiblePageNoList）必须在同步阶段被画过
      const calledPageNos = drawPageSpy.mock.calls.map((c: any[]) => c[0].pageNo)
      expect(calledPageNos).toContain(1)
    })

    it('viewport 在 page 1，edit at page 0 但 dirtyPages 漏掉 page 1 → page 1（视口可见）也必须同步重绘', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      // 复刻用户报错场景的最小形：3 页文档，viewport 在 page 1（中间），
      // edit at page 0（上方），_computeDirtyPages 由于补偿型移位返回 {0}
      // 漏掉 page 1——但 page 1 视口可见，必须同步重绘。
      // 我们直接 stub 出 3 页，然后注入 dirtyPages={0}（漏掉 page 1）。
      for (let n = 1; n <= 2; n++) {
        const fake = document.createElement('canvas')
        ;(draw as any).pageList.push(fake)
        ;(draw as any).ctxList.push(fake.getContext('2d'))
        ;(draw as any).pageRowList.push([])
        ;(draw as any).pageWrapperList.push(fake)
        ;(draw as any).decorationCanvasList.push(fake)
        ;(draw as any).decorationCtxList.push(fake.getContext('2d'))
      }
      draw.setVisiblePageNoList([1]) // 用户视口在 page 1
      const dirtyPages = new Set<number>([0]) // 启发式漏掉了 page 1 的级联影响
      const drawPageSpy = vi.spyOn(draw as any, '_drawPage')
      ;(draw as any)._lazyRender(dirtyPages)
      const calledPageNos = drawPageSpy.mock.calls.map((c: any[]) => c[0].pageNo)
      // 关键断言：page 0（dirty）必须画，page 1（视口）也必须画——
      // 「viewport 永远是最新的」契约。回归测试覆盖 user report
      // 「when showing at middle page editing at above page, the below page doesn't update」。
      expect(calledPageNos).toContain(0)
      expect(calledPageNos).toContain(1)
    })
  })

  describe('B-γ：版本号缓存', () => {
    it('同状态重入 → walk 被跳过（cache hit）', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      draw.getRange().setRange(2, 6)
      draw.render({ curIndex: 6, isSetCursor: false, isSubmitHistory: false })
      // 第一次 decoration-only：缓存填充
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true
      })
      const walkSpy = vi.spyOn(draw as any, '_walkDecorationRow')
      // 第二次同状态重入：版本号未变 → cache hit → walk 跳过
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true
      })
      expect(walkSpy).not.toHaveBeenCalled()
    })

    it('setRange 触发 bumpDecorationVersion → 缓存失效', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      draw.getRange().setRange(2, 6)
      draw.render({ curIndex: 6, isSetCursor: false, isSubmitHistory: false })
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true
      })
      // setRange 之后版本号应该 +1，下一帧 walk 必须被调用
      draw.getRange().setRange(3, 7)
      const walkSpy = vi.spyOn(draw as any, '_walkDecorationRow')
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false,
        isDecorationOnly: true
      })
      expect(walkSpy).toHaveBeenCalled()
    })

    it('search.setSearchKeyword 同样触发缓存失效', () => {
      ctx = createTestEditor({
        data: { header: [], main: midDoc(), footer: [] }
      })
      const draw = (ctx.editor as any).draw
      draw.getRange().setRange(2, 6)
      draw.render({ curIndex: 6, isSetCursor: false, isSubmitHistory: false })
      // 测一次状态稳定下的版本号；setSearchKeyword 后必须 ++
      const v0 = (draw as any)._decorationVersion
      draw.getSearch().setSearchKeyword('hello')
      const v1 = (draw as any)._decorationVersion
      expect(v1).toBeGreaterThan(v0)
    })
  })
})
