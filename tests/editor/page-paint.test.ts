import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestEditor } from '../factories/editor'

function makeRow(startIndex: number, rowIndex = 0, height = 20) {
  return {
    width: 0,
    height,
    ascent: 0,
    elementList: [],
    startIndex,
    rowIndex,
    rowFlex: undefined,
    pageColumns: { columnCount: 1, columnGap: 0 },
    innerWidth: 100
  } as any
}

describe('Draw page paint policy', () => {
  let ctx: ReturnType<typeof createTestEditor>

  afterEach(() => ctx?.destroy())

  it('editing above a visible downstream page keeps visible shifted pages sync and defers farther pages', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw as any
    draw.pageRowList = [
      [makeRow(0, 0), makeRow(10, 1)],
      [makeRow(20, 2), makeRow(30, 3)],
      [makeRow(40, 4)],
      [makeRow(50, 5)]
    ]
    draw._prevPageLayoutSignatures = draw._getPageLayoutSignatures([
      [makeRow(0, 0), makeRow(10, 1)],
      [makeRow(21, 2), makeRow(31, 3)],
      [makeRow(41, 4)],
      [makeRow(51, 5)]
    ])
    draw.visiblePageNoList = [1]
    draw.options.pagePaintOverscan = 0

    const plan = draw._buildPagePaintPlan()

    expect(plan.firstShiftedPage).toBe(1)
    expect(Array.from(plan.syncPages as Set<number>).sort((a, b) => a - b)).toEqual([1])
    expect(Array.from(plan.deferredPages as Set<number>).sort((a, b) => a - b)).toEqual([0, 2, 3])
  })

  it('unchanged pagination does not force unrelated far-off pages into sync repaint', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw as any
    draw.pageRowList = [
      [makeRow(0, 0)],
      [makeRow(10, 1)],
      [makeRow(20, 2)],
      [makeRow(30, 3)],
      [makeRow(40, 4)]
    ]
    draw._prevPageLayoutSignatures = draw._getPageLayoutSignatures()
    draw.visiblePageNoList = [1]
    draw.options.pagePaintOverscan = 1
    draw._dirtyRange = { start: 0, end: 0 }
    vi.spyOn(draw.position, 'getOriginalMainPositionList').mockReturnValue([
      { pageNo: 0 } as any
    ])

    const plan = draw._buildPagePaintPlan()

    expect(plan.firstShiftedPage).toBeNull()
    expect(plan.syncPages.has(0)).toBe(true)
    expect(plan.syncPages.has(1)).toBe(true)
    expect(plan.syncPages.has(2)).toBe(true)
    expect(plan.syncPages.has(4)).toBe(false)
    expect(plan.deferredPages.has(4)).toBe(true)
  })

  it('signature divergence at page k marks downstream pages deferred unless already visible', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw as any
    draw.pageRowList = [
      [makeRow(0, 0)],
      [makeRow(10, 1)],
      [makeRow(20, 2)],
      [makeRow(30, 3)]
    ]
    draw._prevPageLayoutSignatures = draw._getPageLayoutSignatures([
      [makeRow(0, 0)],
      [makeRow(10, 1)],
      [makeRow(21, 2)],
      [makeRow(31, 3)]
    ])
    draw.visiblePageNoList = [0]
    draw.options.pagePaintOverscan = 0

    const plan = draw._buildPagePaintPlan()

    expect(plan.firstShiftedPage).toBe(2)
    expect(Array.from(plan.syncPages as Set<number>).sort((a, b) => a - b)).toEqual([0])
    expect(Array.from(plan.deferredPages as Set<number>).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('page-geometry changes keep sync paint scoped to the intersection page even if visiblePageNoList is broad', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw as any
    draw.pageRowList = [
      [makeRow(0, 0)],
      [makeRow(10, 1)],
      [makeRow(20, 2)],
      [makeRow(30, 3)]
    ]
    draw._prevPageLayoutSignatures = draw._getPageLayoutSignatures([
      [makeRow(0, 0)],
      [makeRow(11, 1)],
      [makeRow(21, 2)],
      [makeRow(31, 3)]
    ])
    draw.visiblePageNoList = [0, 1, 2, 3]
    draw.intersectionPageNo = 1
    draw.options.pagePaintOverscan = 0
    draw._dirtyRange = { start: 0, end: 30 }
    vi.spyOn(draw.position, 'getOriginalMainPositionList').mockReturnValue([
      { pageNo: 0 } as any,
      { pageNo: 1 } as any,
      { pageNo: 2 } as any,
      { pageNo: 3 } as any
    ])

    const plan = draw._buildPagePaintPlan(null, {
      isPageGeometryChange: true
    })

    expect(plan.firstShiftedPage).toBe(1)
    expect(Array.from(plan.syncPages as Set<number>).sort((a, b) => a - b)).toEqual([1])
    expect(Array.from(plan.deferredPages as Set<number>).sort((a, b) => a - b)).toEqual([0, 2, 3])
  })

  it('falls back to full repaint when visible-page info is unavailable', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw as any
    draw.pageRowList = [[makeRow(0, 0)], [makeRow(10, 1)]]
    draw._prevPageLayoutSignatures = draw._getPageLayoutSignatures()
    draw.visiblePageNoList = []

    expect(draw._buildPagePaintPlan()).toBeNull()
  })

  it('decoration-only renders do not repaint the base layer', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw as any
    const drawPageSpy = vi.spyOn(draw, '_drawPage')
    const decorationSpy = vi.spyOn(draw, '_drawDecorationOnly')

    draw.render({
      isDecorationOnly: true,
      isCompute: false,
      isSetCursor: false,
      isSubmitHistory: false
    })

    expect(drawPageSpy).not.toHaveBeenCalled()
    expect(decorationSpy).toHaveBeenCalled()
  })

  it('reuses cached page chrome across repeated page paints', () => {
    ctx = createTestEditor()
    const draw = ctx.editor.draw as any
    const backgroundSpy = vi.spyOn(draw.background, 'render')

    draw.pageRowList = [[makeRow(0, 0)]]
    draw.chromeCacheKeyList[0] = null
    draw._drawPage({
      elementList: draw.getOriginalMainElementList(),
      positionList: [],
      rowList: [],
      pageNo: 0
    })
    draw._drawPage({
      elementList: draw.getOriginalMainElementList(),
      positionList: [],
      rowList: [],
      pageNo: 0
    })

    expect(backgroundSpy).toHaveBeenCalledTimes(1)
  })
})
