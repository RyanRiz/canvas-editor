import { ZERO } from '../../../dataset/constant/Common'
import { IElement, IElementPosition } from '../../../interface/Element'
import { IRow } from '../../../interface/Row'
import { Draw } from '../Draw'

/**
 * MS Word style paragraph shading — paints a colored rectangle behind each
 * row of a paragraph.
 *
 * Why this is *not* a subclass of AbstractRichText (the Highlight base):
 *   - AbstractRichText.recordFillInfo accumulates element runs into a single
 *     fillRect, sized to glyph metrics with a small ascent margin. That model
 *     is correct for character-level highlight but wrong for paragraph
 *     shading, which must span the full row from `pageStartX + leftIndent`
 *     to the right indent boundary regardless of how much text actually sits
 *     on that line. Empty rows (the paragraph ZERO on its own) must still
 *     paint, which AbstractRichText can't express because it only records
 *     when the caller has element metrics in hand.
 *
 * Geometry strategy mirrors `_drawHighlight`'s margin math: we trim
 * `defaultBasicRowMarginHeight` off the top/bottom of every row so adjacent
 * shaded paragraphs visually butt together without gaps, then add back the
 * `highlightMarginHeight` so the painted band hugs the text exactly the way
 * highlight does (consistent visual heaviness across the two features).
 *
 * Each paragraph emits one rectangle per row — Word fragments shading across
 * pages and columns, and the rowList we iterate is already paginated, so we
 * get that for free. Consecutive rows of the same paragraph are coalesced
 * into a single tall fillRect (visually identical, one rasterize call).
 */
export class ParagraphShading {
  private draw: Draw

  constructor(draw: Draw) {
    this.draw = draw
  }

  /**
   * Paint shading rectangles for every paragraph in `rowList` that has a
   * `paragraphShading` color on its ZERO delimiter. Called once per drawRow
   * invocation, before the highlight / text passes, so highlight overlays
   * shading and text overlays both — matching Word's z-order
   * (paragraph shading → text highlight → text → selection).
   */
  public render(
    ctx: CanvasRenderingContext2D,
    payload: {
      rowList: IRow[]
      elementList: IElement[]
      positionList: IElementPosition[]
      innerWidth: number
    }
  ) {
    const { rowList, elementList, positionList, innerWidth } = payload
    if (!rowList.length) return
    const marginHeight = this.draw.getDefaultBasicRowMarginHeight()
    const highlightMarginHeight = this.draw.getHighlightMarginHeight()
    const margins = this.draw.getMargins()
    const leftMargin = margins[3]

    // Resolve the paragraph-shading color for an absolute element index by
    // walking back to the paragraph's ZERO delimiter. Cache by ZERO index so
    // we only walk once per paragraph instead of once per row.
    const shadingCache = new Map<number, string | undefined>()
    const resolveShading = (absIndex: number): string | undefined => {
      let walk = absIndex
      while (walk > 0) {
        const el = elementList[walk]
        if (!el) break
        if (el.value === ZERO) break
        walk--
      }
      if (shadingCache.has(walk)) return shadingCache.get(walk)
      const color = elementList[walk]?.paragraphShading
      shadingCache.set(walk, color)
      return color
    }

    // Coalesce consecutive rows of the same color and same horizontal extent
    // into a single fillRect. Adjacent shaded paragraphs of the same color
    // visually merge (Word's behavior) for free because their geometry lines
    // up — the merge is just a rasterizer optimization, not a semantic one.
    type Run = {
      x: number
      y: number
      width: number
      height: number
      color: string
    }
    let run: Run | null = null
    const flushRun = () => {
      if (!run) return
      ctx.save()
      ctx.fillStyle = run.color
      ctx.fillRect(run.x, run.y, run.width, run.height)
      ctx.restore()
      run = null
    }

    for (let i = 0; i < rowList.length; i++) {
      const curRow = rowList[i]
      if (!curRow.elementList.length) continue
      const absStartIndex = curRow.startIndex
      const color = resolveShading(absStartIndex)
      if (!color) {
        flushRun()
        continue
      }
      // Horizontal extent: respect the paragraph's left/right indent (locked
      // onto the row in computePageRowPosition as offsetX/rightOffsetX). When
      // the row doesn't carry its own column width fall back to the page's
      // innerWidth + leftMargin.
      const offsetX = curRow.offsetX || 0
      const rightOffsetX = curRow.rightOffsetX || 0
      const rowInnerWidth = curRow.innerWidth || innerWidth
      const startX =
        (curRow.pageStartX !== undefined ? curRow.pageStartX : leftMargin) +
        offsetX
      const width = Math.max(0, rowInnerWidth - offsetX - rightOffsetX)
      if (!width) {
        flushRun()
        continue
      }
      // Vertical extent: the first element of the row holds the exact y of
      // the row's top in the position list. Use that instead of summing
      // sibling row heights — `pageStartY` only describes the first row, and
      // subsequent rows already absorb offsets we'd otherwise double-count.
      const pos = positionList[absStartIndex]
      if (!pos) {
        flushRun()
        continue
      }
      const rowY = pos.coordinate.leftTop[1]
      const rectY = rowY + marginHeight - highlightMarginHeight
      const rectHeight =
        curRow.height - 2 * marginHeight + 2 * highlightMarginHeight
      if (rectHeight <= 0) {
        flushRun()
        continue
      }
      // Merge with the prior row when it's vertically adjacent and matches in
      // color + horizontal extent. The 0.5px tolerance keeps subpixel
      // rounding (high-DPI scaling) from forcing a flush every row.
      if (
        run &&
        run.color === color &&
        Math.abs(run.x - startX) < 0.5 &&
        Math.abs(run.width - width) < 0.5 &&
        Math.abs(run.y + run.height - rectY) < 0.5
      ) {
        run.height += rectHeight
        continue
      }
      flushRun()
      run = { x: startX, y: rectY, width, height: rectHeight, color }
    }
    flushRun()
  }
}
