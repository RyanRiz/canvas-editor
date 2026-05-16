import { maxHeightRadioMapping } from '../../../dataset/constant/Common'
import { EditorZone } from '../../../dataset/enum/Editor'
import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { IElement, IElementPosition } from '../../../interface/Element'
import { IRow } from '../../../interface/Row'
import {
  formatElementList,
  pickSurroundElementList
} from '../../../utils/element'
import { convertNumberToChinese, convertNumberToRoman } from '../../../utils'
import { Position } from '../../position/Position'
import { Zone } from '../../zone/Zone'
import { Draw } from '../Draw'

export type ChromeVariant = 'default' | 'first' | 'even'

interface IVariantLayout {
  rowList: IRow[]
  positionList: IElementPosition[]
}

interface IHeaderVariantInit {
  first?: IElement[]
  even?: IElement[]
}

export class Header {
  private draw: Draw
  private position: Position
  private zone: Zone
  private options: DeepRequired<IEditorOption>

  // Active-variant live data — what cursor / range / commands operate on.
  private elementList: IElement[]
  private rowList: IRow[]
  private positionList: IElementPosition[]

  // Storage for the inactive variants. Active variant's content is the same
  // reference as `elementList` so direct edits flow through automatically.
  private variantStorage: Record<ChromeVariant, IElement[]>
  private activeVariant: ChromeVariant
  // Lazy-computed layouts for inactive variants (rendering only — no cursor).
  private cachedVariantLayouts: Map<ChromeVariant, IVariantLayout>

  constructor(draw: Draw, data?: IElement[], extras?: IHeaderVariantInit) {
    this.draw = draw
    this.position = draw.getPosition()
    this.zone = draw.getZone()
    this.options = draw.getOptions()

    const defaultList = data || []
    this.variantStorage = {
      default: defaultList,
      first: extras?.first ?? [],
      even: extras?.even ?? []
    }
    this.activeVariant = 'default'
    this.elementList = this.variantStorage.default
    this.rowList = []
    this.positionList = []
    this.cachedVariantLayouts = new Map()
  }

  public getRowList(): IRow[] {
    return this.rowList
  }

  public setElementList(elementList: IElement[]) {
    this.elementList = elementList
    this.variantStorage[this.activeVariant] = elementList
    this.cachedVariantLayouts.delete(this.activeVariant)
    // Replacing the elementList reference invalidates any in-flight delta
    // history mutations that captured the OLD reference. Force the next
    // submitHistory to snapshot so the change is recorded correctly.
    this.draw.markDeltaHistoryUnsafe()
  }

  public getElementList(): IElement[] {
    return this.elementList
  }

  public getPositionList(): IElementPosition[] {
    return this.positionList
  }

  public getActiveVariant(): ChromeVariant {
    return this.activeVariant
  }

  public getVariantElementList(variant: ChromeVariant): IElement[] {
    if (variant === this.activeVariant) return this.elementList
    return this.variantStorage[variant]
  }

  public setVariantElementList(variant: ChromeVariant, list: IElement[]) {
    this.variantStorage[variant] = list
    if (variant === this.activeVariant) {
      this.elementList = list
    }
    this.cachedVariantLayouts.delete(variant)
    this.draw.markDeltaHistoryUnsafe()
  }

  /**
   * Switch the active variant. The current active variant's content is
   * persisted into storage; the requested variant's content becomes the live
   * elementList that cursor/range/commands operate on.
   */
  public setActiveVariant(variant: ChromeVariant) {
    if (variant === this.activeVariant) return
    // Variant switch swaps `this.elementList` to a different array — any
    // pending delta mutations captured against the previous variant's
    // reference are no longer valid. Force snapshot for this submit.
    this.draw.markDeltaHistoryUnsafe()
    // Persist current edits back into storage (elementList may have been
    // re-bound by setElementList; ensure storage is in sync).
    this.variantStorage[this.activeVariant] = this.elementList
    this.activeVariant = variant
    const next = this.variantStorage[variant]
    // Ensure the variant's elementList has a ZERO terminator on first
    // activation. formatElementList without `isForceCompensation` is
    // idempotent — it only prepends ZERO when the first element doesn't
    // already start with ZERO/\n, so toggling variants repeatedly will not
    // accumulate empty paragraphs.
    formatElementList(next, {
      editorOptions: this.options
    })
    this.variantStorage[variant] = next
    this.elementList = next
    this.rowList = []
    this.positionList = []
    this.cachedVariantLayouts.clear()
  }

  /**
   * Resolve which variant should be displayed on the given 0-indexed pageNo,
   * honoring the firstPageEnabled / oddEvenEnabled options.
   */
  public resolveVariantForPage(pageNo: number): ChromeVariant {
    const { firstPageEnabled, oddEvenEnabled } = this.options.header
    if (firstPageEnabled && pageNo === 0) return 'first'
    // pageNo is 0-indexed: page 1 -> 0 (odd), page 2 -> 1 (even), page 3 -> 2 (odd)
    if (oddEvenEnabled && pageNo % 2 === 1) return 'even'
    return 'default'
  }

  public compute() {
    this.recovery()
    // Per-section orientation MVP: compute the cached rowList /
    // positionList under the ACTIVE page's direction. The cached
    // positionList is what `Position.getOriginalPositionList()` returns
    // when the header zone is active, and the cursor logic reads X/Y from
    // it — so a cursor on a landscape page needs landscape margins/inner
    // width, not the document's base direction. `Header.render` still
    // recomputes a per-paint positionList for non-active pages (so a
    // portrait page in the same doc paints its header at portrait coords);
    // this cached one is dedicated to whatever the cursor is on.
    const prevOverride = this.draw.getPaintDirectionOverride()
    this.draw.setPaintDirectionOverride(
      this.draw.getPageDirection(this.draw.getPageNo())
    )
    try {
      this._computeRowList()
      this._computePositionList()
    } finally {
      this.draw.setPaintDirectionOverride(prevOverride)
    }
  }

  public recovery() {
    this.rowList = []
    this.positionList = []
    this.cachedVariantLayouts.clear()
  }

  private _computeRowList() {
    this.rowList = this._computeRowListFor(this.elementList)
  }

  private _computeRowListFor(elementList: IElement[]): IRow[] {
    const innerWidth = this.draw.getInnerWidth()
    const margins = this.draw.getMargins()
    const surroundElementList = pickSurroundElementList(elementList)
    return this.draw.computeRowList({
      startX: margins[3],
      startY: this.getHeaderTop(),
      innerWidth,
      elementList,
      surroundElementList
    })
  }

  private _computePositionList() {
    this._computePositionListFor(this.rowList, this.positionList)
  }

  private _computePositionListFor(
    rowList: IRow[],
    positionList: IElementPosition[]
  ) {
    const headerTop = this.getHeaderTop()
    const innerWidth = this.draw.getInnerWidth()
    const margins = this.draw.getMargins()
    const startX = margins[3]
    const startY = headerTop
    this.position.computePageRowPosition({
      positionList,
      rowList,
      pageNo: 0,
      startRowIndex: 0,
      startIndex: 0,
      startX,
      startY,
      innerWidth,
      zone: EditorZone.HEADER
    })
  }

  private _ensureVariantLayout(variant: ChromeVariant): IVariantLayout {
    const cached = this.cachedVariantLayouts.get(variant)
    if (cached) return cached
    const elementList = this.variantStorage[variant] ?? []
    const layout: IVariantLayout = { rowList: [], positionList: [] }
    if (elementList.length) {
      layout.rowList = this._computeRowListFor(elementList)
      this._computePositionListFor(layout.rowList, layout.positionList)
    }
    this.cachedVariantLayouts.set(variant, layout)
    return layout
  }

  public getHeaderTop(): number {
    const {
      header: { top, disabled },
      scale
    } = this.options
    if (disabled) return 0
    return Math.floor(top * scale)
  }

  public getMaxHeight(): number {
    const {
      header: { maxHeightRadio }
    } = this.options
    const height = this.draw.getHeight()
    return Math.floor(height * maxHeightRadioMapping[maxHeightRadio])
  }

  public getHeight(pageNo?: number): number {
    if (this.options.header.disabled) return 0
    const maxHeight = this.getMaxHeight()
    const rowHeight =
      pageNo === undefined
        ? this.getRowHeight()
        : this.getVariantRowHeight(this.resolveVariantForPage(pageNo))
    return rowHeight > maxHeight ? maxHeight : rowHeight
  }

  public getRowHeight(): number {
    return this.rowList.reduce((pre, cur) => pre + cur.height, 0)
  }

  private getVariantRowHeight(variant: ChromeVariant): number {
    if (variant === this.activeVariant) return this.getRowHeight()
    const layout = this._ensureVariantLayout(variant)
    return layout.rowList.reduce((pre, cur) => pre + cur.height, 0)
  }

  public getExtraHeight(pageNo?: number): number {
    const margins = this.draw.getMargins()
    const headerHeight = this.getHeight(pageNo)
    const headerTop = this.getHeaderTop()
    const extraHeight = headerTop + headerHeight - margins[0]
    return extraHeight <= 0 ? 0 : extraHeight
  }

  public render(ctx: CanvasRenderingContext2D, pageNo: number) {
    const variant = this.resolveVariantForPage(pageNo)
    const isActive = variant === this.activeVariant
    const elementList = isActive
      ? this.elementList
      : (this.variantStorage[variant] ?? [])
    if (!elementList.length) return
    const sourceRowList = isActive
      ? this.rowList
      : this._ensureVariantLayout(variant).rowList
    if (!sourceRowList.length) return

    // Per-section orientation MVP: same treatment as Footer.render. The
    // header's X start and the rendered margins/innerWidth all flow from
    // direction-sensitive Draw getters. Override to the rendered page's
    // direction and recompute a per-page positionList so a landscape page
    // gets a landscape-margined header (and a portrait page gets a
    // portrait-margined one) regardless of which direction the cached
    // layout was originally computed at.
    const prevDirectionOverride = this.draw.getPaintDirectionOverride()
    const pageDirection = this.draw.getPageDirection(pageNo)
    this.draw.setPaintDirectionOverride(pageDirection)

    ctx.save()
    ctx.globalAlpha = this.zone.isHeaderActive()
      ? 1
      : this.options.header.inactiveAlpha
    const innerWidth = this.draw.getInnerWidth()
    const maxHeight = this.getMaxHeight()
    // Clip rows that overflow the configured maxHeight band.
    const rowList: IRow[] = []
    let curRowHeight = 0
    for (let r = 0; r < sourceRowList.length; r++) {
      const row = sourceRowList[r]
      if (curRowHeight + row.height > maxHeight) {
        break
      }
      rowList.push(row)
      curRowHeight += row.height
    }
    // Recompute the positionList for the rendered page's direction.
    const positionList: IElementPosition[] = []
    this._computePositionListFor(sourceRowList, positionList)
    // Substitute live page-number tokens just for this draw pass; restore
    // afterwards so the canonical value (kept in storage / serialized output)
    // stays the user-typed placeholder.
    const restore = applyPageNumberTokens(elementList, this.draw, pageNo)
    try {
      this.draw.drawRow(ctx, {
        elementList,
        positionList,
        rowList,
        pageNo,
        startIndex: 0,
        innerWidth,
        zone: EditorZone.HEADER
      })
    } finally {
      restore()
      ctx.restore()
      this.draw.setPaintDirectionOverride(prevDirectionOverride)
    }
  }
}

/**
 * Substitutes element.value for any element flagged with `pageNumberKind`
 * with the live value computed for the given pageNo. Returns a function that
 * restores the original values.
 */
export function applyPageNumberTokens(
  elementList: IElement[],
  draw: Draw,
  pageNo: number
): () => void {
  const opts = draw.getOptions()
  const pageNumberOpt = opts.pageNumber
  const fallbackType = pageNumberOpt?.numberType ?? 'arabic'
  const startPageNo = pageNumberOpt?.startPageNo ?? 1
  const explicitFrom = pageNumberOpt?.fromPageNo ?? 0
  // `Different first page` treats page 0 as a cover/title page and restarts
  // numbering on page 1. Honor it whenever either header or footer has the
  // flag on, so authors enabling it for one zone get the expected numbering
  // in the other.
  const skipFirstCover =
    !!opts.header?.firstPageEnabled || !!opts.footer?.firstPageEnabled
  const effectiveFrom = Math.max(explicitFrom, skipFirstCover ? 1 : 0)
  const totalPages = draw.getPageCount()
  const restoreList: [IElement, string][] = []
  for (let i = 0; i < elementList.length; i++) {
    const el = elementList[i]
    if (!el || !el.pageNumberKind) continue
    const fmt = el.pageNumberFormat ?? fallbackType
    let value: string
    if (el.pageNumberKind === 'pageCount') {
      value = formatPageNumber(Math.max(0, totalPages - effectiveFrom), fmt)
    } else if (pageNo < effectiveFrom) {
      // Cover/skipped page — render the placeholder as empty so nothing
      // visible appears for the page-number element on page 1.
      value = ''
    } else {
      value = formatPageNumber(pageNo + startPageNo - effectiveFrom, fmt)
    }
    restoreList.push([el, el.value])
    el.value = value
  }
  return () => {
    for (const [el, original] of restoreList) {
      el.value = original
    }
  }
}

function formatPageNumber(n: number, kind: string): string {
  switch (kind) {
    case 'chinese':
      return convertNumberToChinese(n)
    case 'roman-upper':
      return convertNumberToRoman(n, true)
    case 'roman-lower':
      return convertNumberToRoman(n, false)
    default:
      return `${n}`
  }
}
