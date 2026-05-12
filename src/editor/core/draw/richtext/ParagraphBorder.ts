import { ZERO } from '../../../dataset/constant/Common'
import { ParagraphBorderStyle } from '../../../dataset/enum/ParagraphBorder'
import { IElement, IElementPosition } from '../../../interface/Element'
import {
  IParagraphBorder,
  IParagraphBorderSide
} from '../../../interface/ParagraphBorder'
import { IRow } from '../../../interface/Row'
import { Draw } from '../Draw'

/**
 * MS Word paragraph border (`<w:pBdr>`) — block decoration that wraps each
 * paragraph fragment.
 *
 * A "fragment" here is a maximal run of consecutive rows in the page's
 * `rowList` that all (a) belong to the same paragraph and (b) share a column.
 * The paragraph identity for a row is the index of the ZERO element the row
 * sits inside, recovered by walking back from `row.startIndex` — same
 * resolution path used by `ParagraphShading` so a paragraph's border and
 * shading always agree on extent.
 *
 * Why fragment-aware (and not "one rect per paragraph") matters:
 *
 *   - When a paragraph splits across a page break Word paints two visually
 *     distinct, bounded borders — one per page — and never a single
 *     border that "jumps" the page gap. Top stroke is only emitted on the
 *     fragment that contains the paragraph's first element; bottom stroke
 *     only on the fragment that contains the paragraph's last element.
 *     Left/right strokes paint on every fragment.
 *
 *   - The render pass is invoked per page (`drawRow` is called once per
 *     page's `rowList`), so cross-page fragmentation is already implicit:
 *     each page only sees its own slice of rows. We just need to detect, for
 *     a given fragment in this slice, whether the paragraph began earlier or
 *     continues later — that's what `paragraphAnchor` / `paragraphLastIdx`
 *     give us against the full elementList.
 *
 *   - Multi-column flow is handled by also breaking fragments at
 *     `columnIndex` changes; same paragraph in column 1 and column 2 gets
 *     two separately-bounded fragments, matching the spec line
 *     "borders clipped to column fragment — never cross column boundaries".
 *
 * `between` borders collapse adjacent shared-style paragraph boundaries into
 * a single stroke: when paragraph A's bottom and paragraph B's top would
 * normally double up, and both paragraphs declare matching `between`, we
 * emit only the `between` stroke between them and suppress the outer
 * bottom/top. Padding interacts with this — see `_paintFragment` below.
 *
 * z-order: rendered immediately after `ParagraphShading.render` and before
 * `_drawHighlight`, so the painted order on every row is
 *   shading → border → highlight → text → selection
 * matching Word's "shading, border, text, caret" layered model.
 */
export class ParagraphBorder {
  private draw: Draw

  constructor(draw: Draw) {
    this.draw = draw
  }

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
    const scale = this.draw.getOptions().scale
    const marginHeight = this.draw.getDefaultBasicRowMarginHeight()
    const highlightMarginHeight = this.draw.getHighlightMarginHeight()
    const margins = this.draw.getMargins()
    const leftMargin = margins[3]

    // Memoize the (border, paragraph-anchor index, paragraph-last index)
    // triple for each row's paragraph so we walk back to the ZERO only once
    // per paragraph rather than once per row.
    type ParagraphInfo = {
      anchor: number
      lastIdx: number
      border: IParagraphBorder | undefined
    }
    const paragraphCache = new Map<number, ParagraphInfo>()
    const resolveParagraph = (rowStartIndex: number): ParagraphInfo => {
      let walk = rowStartIndex
      while (walk > 0) {
        const el = elementList[walk]
        if (!el) break
        if (el.value === ZERO) break
        walk--
      }
      const cached = paragraphCache.get(walk)
      if (cached) return cached
      // Paragraph runs from `walk` (the anchor ZERO) up to but not including
      // the next ZERO. If no further ZERO exists the paragraph extends to
      // the end of the elementList.
      let next = walk + 1
      while (next < elementList.length && elementList[next].value !== ZERO) {
        next++
      }
      const info: ParagraphInfo = {
        anchor: walk,
        lastIdx: next - 1 >= walk ? next - 1 : walk,
        border: elementList[walk]?.paragraphBorder
      }
      paragraphCache.set(walk, info)
      return info
    }

    // Walk `rowList` and slice it into fragments. A fragment is a maximal
    // run of consecutive rows that share the same paragraph anchor and the
    // same column. We pre-compute fragments before painting so the "between"
    // logic (which needs to look at the *next* fragment to decide whether to
    // collapse a bottom/top pair) can peek ahead without an awkward
    // look-behind state machine in the paint loop.
    type Fragment = {
      info: ParagraphInfo
      rows: IRow[]
      // True when this fragment contains the paragraph's first element —
      // i.e. it is *not* a continuation from an earlier page. Drives whether
      // the top stroke is emitted.
      isFirstFragment: boolean
      // True when this fragment contains the paragraph's last element. Drives
      // whether the bottom stroke is emitted.
      isLastFragment: boolean
    }
    const fragments: Fragment[] = []
    let cur: Fragment | null = null
    for (let i = 0; i < rowList.length; i++) {
      const row = rowList[i]
      if (!row.elementList.length) {
        if (cur) {
          fragments.push(cur)
          cur = null
        }
        continue
      }
      const info = resolveParagraph(row.startIndex)
      if (!info.border) {
        if (cur) {
          fragments.push(cur)
          cur = null
        }
        continue
      }
      const sameParagraph = cur && cur.info.anchor === info.anchor
      const sameColumn =
        cur && (cur.rows[cur.rows.length - 1].columnIndex || 0) ===
          (row.columnIndex || 0)
      if (cur && sameParagraph && sameColumn) {
        cur.rows.push(row)
        continue
      }
      if (cur) fragments.push(cur)
      cur = { info, rows: [row], isFirstFragment: false, isLastFragment: false }
    }
    if (cur) fragments.push(cur)

    // Now decide first/last status for each fragment. A fragment is "first"
    // when its first row covers the paragraph anchor index, "last" when its
    // last row covers the paragraph's final element index. Both can be true
    // simultaneously for paragraphs that fit on a single page.
    for (const fragment of fragments) {
      const firstRow = fragment.rows[0]
      const lastRow = fragment.rows[fragment.rows.length - 1]
      const firstRowEnd =
        firstRow.startIndex + firstRow.elementList.length - 1
      const lastRowEnd =
        lastRow.startIndex + lastRow.elementList.length - 1
      fragment.isFirstFragment =
        firstRow.startIndex <= fragment.info.anchor &&
        firstRowEnd >= fragment.info.anchor
      fragment.isLastFragment =
        lastRow.startIndex <= fragment.info.lastIdx &&
        lastRowEnd >= fragment.info.lastIdx
    }

    // Paint pass.
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i]
      const next = fragments[i + 1]
      this._paintFragment(ctx, {
        fragment,
        nextFragment: next ?? null,
        positionList,
        innerWidth,
        leftMargin,
        marginHeight,
        highlightMarginHeight,
        scale
      })
    }
  }

  /**
   * Paint a single fragment's borders. The geometry mirrors
   * `ParagraphShading`'s vertical math so border + shading agree visually:
   * the band's vertical extent is `rowY + marginHeight - highlightMarginHeight`
   * (top of first row) to `rowY + height - marginHeight + highlightMarginHeight`
   * (bottom of last row), then `padding` extends the rectangle outward.
   *
   * Horizontal extent uses the first row's `offsetX` / `rightOffsetX` because
   * paragraph-level indent is uniform across a paragraph's rows in this
   * engine (indent is stamped on the paragraph ZERO and propagated by
   * `computeRowList`). If a future first-line-indent feature breaks that
   * assumption the paragraph-fragment min/max can be substituted here without
   * touching the caller.
   *
   * The "between" collapse: when both this fragment's bottom and the next
   * fragment's top would otherwise paint *and* both paragraphs declare
   * matching `between` sides, we paint the `between` stroke on this
   * fragment's bottom edge and suppress the next fragment's top emission.
   * Because we don't carry per-fragment state forward, we instead emit the
   * "between" stroke on the bottom edge here and let the next fragment's
   * `_paintFragment` see the same condition and skip its own top. That's
   * symmetric and idempotent — both fragments compute the same boolean.
   */
  private _paintFragment(
    ctx: CanvasRenderingContext2D,
    payload: {
      fragment: {
        info: { anchor: number; lastIdx: number; border: IParagraphBorder | undefined }
        rows: IRow[]
        isFirstFragment: boolean
        isLastFragment: boolean
      }
      nextFragment: {
        info: { anchor: number; lastIdx: number; border: IParagraphBorder | undefined }
        rows: IRow[]
        isFirstFragment: boolean
        isLastFragment: boolean
      } | null
      positionList: IElementPosition[]
      innerWidth: number
      leftMargin: number
      marginHeight: number
      highlightMarginHeight: number
      scale: number
    }
  ) {
    const {
      fragment,
      nextFragment,
      positionList,
      innerWidth,
      leftMargin,
      marginHeight,
      highlightMarginHeight,
      scale
    } = payload
    const border = fragment.info.border
    if (!border) return
    const firstRow = fragment.rows[0]
    const lastRow = fragment.rows[fragment.rows.length - 1]
    const firstPos = positionList[firstRow.startIndex]
    const lastPos = positionList[lastRow.startIndex]
    if (!firstPos || !lastPos) return

    // Horizontal extent — same math as ParagraphShading. Indents are pre-
    // scaled by computeRowList; padding values are stored unscaled and must
    // be multiplied by `scale` here so the visual "distance from text"
    // stays constant at every zoom level.
    const offsetX = firstRow.offsetX || 0
    const rightOffsetX = firstRow.rightOffsetX || 0
    const rowInnerWidth = firstRow.innerWidth || innerWidth
    const startXBase =
      (firstRow.pageStartX !== undefined ? firstRow.pageStartX : leftMargin) +
      offsetX
    const widthBase = Math.max(0, rowInnerWidth - offsetX - rightOffsetX)
    if (widthBase <= 0) return
    const padding = border.padding ?? [0, 0, 0, 0]
    const padTop = padding[0] * scale
    const padRight = padding[1] * scale
    const padBottom = padding[2] * scale
    const padLeft = padding[3] * scale

    // Vertical extent — first row's top down to last row's bottom, mirroring
    // ParagraphShading's vertical inset so the border tucks around the
    // shaded band exactly when both are applied to the same paragraph.
    const topRowY = firstPos.coordinate.leftTop[1]
    const top = topRowY + marginHeight - highlightMarginHeight - padTop
    const bottomRowY = lastPos.coordinate.leftTop[1]
    const bottom =
      bottomRowY +
      lastRow.height -
      marginHeight +
      highlightMarginHeight +
      padBottom
    if (bottom - top <= 0) return
    const left = startXBase - padLeft
    const right = startXBase + widthBase + padRight

    // Decide whether to paint each side. Top/bottom obey fragment continuity
    // (a continuation fragment suppresses its outer top and inner top alike);
    // left/right always paint when defined.
    const paintTop = fragment.isFirstFragment && !!border.top
    const paintBottom = fragment.isLastFragment && !!border.bottom

    // "between" collapse — only meaningful at the seam between two
    // immediately-stacked fragments on the same page. We require both
    // paragraphs to declare `between` with the same color/width/style so the
    // collapse is visually reversible (Word also requires matching borders).
    let paintBetween = false
    if (
      border.between &&
      nextFragment &&
      nextFragment.info.border?.between &&
      this._sidesMatch(border.between, nextFragment.info.border.between)
    ) {
      // Only collapse when this fragment's bottom edge meets the next
      // fragment's top edge vertically with no intervening fragment of a
      // different paragraph and no column break.
      const nextFirstRow = nextFragment.rows[0]
      const nextFirstPos = positionList[nextFirstRow.startIndex]
      if (
        nextFirstPos &&
        (nextFirstRow.columnIndex || 0) === (lastRow.columnIndex || 0)
      ) {
        paintBetween = true
      }
    }

    ctx.save()
    // Fast path: when all four sides are present *and* uniform (same color /
    // width / style), stroke the whole rectangle as one closed path. That's
    // what MS Word does — corners are exact miters, no per-side stub or
    // 1-pixel gap from where butt caps end. Falls back to per-side strokes
    // for partial / mixed borders (continuation fragments across pages,
    // single-edge "Bottom borders" toggles, between-only setups).
    const uniformRect =
      paintTop &&
      (paintBottom || paintBetween) &&
      border.left &&
      border.right &&
      border.top &&
      (paintBetween ? border.between! : border.bottom!) &&
      this._sidesMatch(border.top, border.left) &&
      this._sidesMatch(border.top, border.right) &&
      this._sidesMatch(border.top, paintBetween ? border.between! : border.bottom!)
    if (uniformRect) {
      this._strokeRect(ctx, border.top!, left, top, right, bottom, scale)
    } else {
      if (border.left) this._strokeSide(ctx, border.left, left, top, left, bottom, scale)
      if (border.right) this._strokeSide(ctx, border.right, right, top, right, bottom, scale)
      if (paintTop) this._strokeSide(ctx, border.top!, left, top, right, top, scale)
      if (paintBottom && !paintBetween) {
        this._strokeSide(ctx, border.bottom!, left, bottom, right, bottom, scale)
      }
      if (paintBetween) {
        // Paint the between stroke at the seam between this fragment's bottom
        // and the next fragment's top. Geometrically that's halfway through
        // the gap between `bottom` and the next fragment's `top`, but using
        // `bottom` is visually identical when padding/spacing is zero and
        // avoids a second positionList lookup.
        this._strokeSide(ctx, border.between!, left, bottom, right, bottom, scale)
      }
    }
    ctx.restore()
  }

  /**
   * Stroke a closed rectangle when all four sides are uniform. Single
   * `ctx.rect()` + `ctx.stroke()` so the canvas rasterizer handles the
   * corners with native miter joins — no per-side stubs, no gaps, no
   * doubled corner pixels at width ≥ 2. Same pixel-snapping rules apply
   * (snap each edge centerline so the stroke covers whole device pixels).
   */
  private _strokeRect(
    ctx: CanvasRenderingContext2D,
    side: IParagraphBorderSide,
    leftIn: number,
    topIn: number,
    rightIn: number,
    bottomIn: number,
    scale: number
  ) {
    const color = side.color || '#000000'
    const width = (side.width ?? 1) * scale
    const style = side.style || ParagraphBorderStyle.SOLID
    const snap = (n: number, w: number) => {
      const half = w / 2
      return Math.round(n - half) + half
    }
    const l = snap(leftIn, width)
    const t = snap(topIn, width)
    const r = snap(rightIn, width)
    const b = snap(bottomIn, width)
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = width
    // miter is the default but be explicit — the corner geometry is the
    // whole reason we're on this fast path.
    ctx.lineJoin = 'miter'
    if (style === ParagraphBorderStyle.DASHED) {
      ctx.setLineDash([width * 4, width * 2])
    } else if (style === ParagraphBorderStyle.DOTTED) {
      ctx.setLineDash([width, width * 2])
    } else {
      ctx.setLineDash([])
    }
    if (style === ParagraphBorderStyle.DOUBLE) {
      // Two concentric rectangles, gap = width.
      ctx.setLineDash([])
      const offset = width
      ctx.beginPath()
      ctx.rect(l - offset / 2, t - offset / 2, r - l + offset, b - t + offset)
      ctx.rect(l + offset / 2, t + offset / 2, r - l - offset, b - t - offset)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.rect(l, t, r - l, b - t)
      ctx.stroke()
    }
    ctx.restore()
  }

  private _sidesMatch(a: IParagraphBorderSide, b: IParagraphBorderSide) {
    return (
      (a.color || '#000000') === (b.color || '#000000') &&
      (a.width ?? 1) === (b.width ?? 1) &&
      (a.style || ParagraphBorderStyle.SOLID) ===
        (b.style || ParagraphBorderStyle.SOLID)
    )
  }

  /**
   * Stroke one edge.
   *
   * Pixel snapping (why the borders looked gray before): canvas strokes a
   * line of width W *centered* on the path. If the path coord falls between
   * pixels, the stroke spans two pixel rows/cols with ~50% coverage in each,
   * which reads as a thin gray smudge instead of a solid black line —
   * exactly what we were seeing on screen. The bare `translate(0.5)` trick
   * only fixes the case where the *caller's* coords are already integer; our
   * coords come from `pageStartX + offsetX - paddingLeft * scale` and are
   * fractional at any non-100% zoom or after indent. So we snap *every*
   * stroke's center line via `snapCenter`: for an odd-pixel width the center
   * is forced to N + 0.5; for an even-pixel width it's forced to N. That
   * guarantees the stroke fills whole device pixels at any width.
   *
   * DOUBLE style is implemented as two parallel solid strokes offset by
   * `width` pixels. The two centerlines are snapped independently so the
   * gap stays at integer-pixel widths even when the base coordinate is
   * fractional. Word's default rasterization for `w:val="double"` at
   * typical 1pt widths is two strokes of width `w` with a gap of `w`.
   */
  private _strokeSide(
    ctx: CanvasRenderingContext2D,
    side: IParagraphBorderSide,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    scale: number
  ) {
    const color = side.color || '#000000'
    const width = (side.width ?? 1) * scale
    const style = side.style || ParagraphBorderStyle.SOLID

    // Snap a stroke's centerline so its edges land on integer pixel
    // boundaries. `w` is the stroke width in canvas pixels.
    const snapCenter = (n: number, w: number) => {
      const half = w / 2
      return Math.round(n - half) + half
    }
    const isHorizontal = y1 === y2

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = width
    if (style === ParagraphBorderStyle.DASHED) {
      ctx.setLineDash([width * 4, width * 2])
    } else if (style === ParagraphBorderStyle.DOTTED) {
      ctx.setLineDash([width, width * 2])
    } else {
      ctx.setLineDash([])
    }
    // No `translate(0.5)` — snapCenter does the alignment explicitly so the
    // result is correct regardless of the input coordinate's fractional
    // part. Adding 0.5 on top of a snapped value would re-introduce a
    // half-pixel offset and the gray smudge would come back.

    if (style === ParagraphBorderStyle.DOUBLE) {
      ctx.setLineDash([])
      const gap = width
      const offset = gap // distance between the two stroke centerlines
      if (isHorizontal) {
        const yA = snapCenter(y1 - offset / 2, width)
        const yB = snapCenter(y1 + offset / 2, width)
        // Endpoints along the stroke direction don't need snapping for
        // crispness — only the perpendicular axis matters — but we snap
        // them too so the corner of the rectangle lines up with adjacent
        // edges and adjacent paragraphs.
        const xs = Math.round(x1)
        const xe = Math.round(x2)
        ctx.beginPath()
        ctx.moveTo(xs, yA)
        ctx.lineTo(xe, yA)
        ctx.moveTo(xs, yB)
        ctx.lineTo(xe, yB)
        ctx.stroke()
      } else {
        const xA = snapCenter(x1 - offset / 2, width)
        const xB = snapCenter(x1 + offset / 2, width)
        const ys = Math.round(y1)
        const ye = Math.round(y2)
        ctx.beginPath()
        ctx.moveTo(xA, ys)
        ctx.lineTo(xA, ye)
        ctx.moveTo(xB, ys)
        ctx.lineTo(xB, ye)
        ctx.stroke()
      }
    } else {
      // Solid / dashed / dotted: snap the perpendicular axis (where the
      // stroke has width and AA can blur) and round the along-stroke
      // endpoints so the corner joins line up with the adjacent edge.
      ctx.beginPath()
      if (isHorizontal) {
        const ys = snapCenter(y1, width)
        ctx.moveTo(Math.round(x1), ys)
        ctx.lineTo(Math.round(x2), ys)
      } else {
        const xs = snapCenter(x1, width)
        ctx.moveTo(xs, Math.round(y1))
        ctx.lineTo(xs, Math.round(y2))
      }
      ctx.stroke()
    }
    ctx.restore()
  }
}
