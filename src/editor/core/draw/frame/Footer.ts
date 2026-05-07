import { maxHeightRadioMapping } from '../../../dataset/constant/Common'
import { EditorZone } from '../../../dataset/enum/Editor'
import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { IElement, IElementPosition } from '../../../interface/Element'
import { IRow } from '../../../interface/Row'
import { formatElementList } from '../../../utils/element'
import { Position } from '../../position/Position'
import { Zone } from '../../zone/Zone'
import { Draw } from '../Draw'
import { applyPageNumberTokens, ChromeVariant } from './Header'

interface IVariantLayout {
  rowList: IRow[]
  positionList: IElementPosition[]
}

interface IFooterVariantInit {
  first?: IElement[]
  even?: IElement[]
}

export class Footer {
  private draw: Draw
  private position: Position
  private zone: Zone
  private options: DeepRequired<IEditorOption>

  private elementList: IElement[]
  private rowList: IRow[]
  private positionList: IElementPosition[]

  private variantStorage: Record<ChromeVariant, IElement[]>
  private activeVariant: ChromeVariant
  private cachedVariantLayouts: Map<ChromeVariant, IVariantLayout>

  constructor(draw: Draw, data?: IElement[], extras?: IFooterVariantInit) {
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
  }

  public setActiveVariant(variant: ChromeVariant) {
    if (variant === this.activeVariant) return
    this.variantStorage[this.activeVariant] = this.elementList
    this.activeVariant = variant
    const next = this.variantStorage[variant]
    formatElementList(next, {
      editorOptions: this.options
    })
    this.variantStorage[variant] = next
    this.elementList = next
    this.rowList = []
    this.positionList = []
    this.cachedVariantLayouts.clear()
  }

  public resolveVariantForPage(pageNo: number): ChromeVariant {
    const { firstPageEnabled, oddEvenEnabled } = this.options.footer
    if (firstPageEnabled && pageNo === 0) return 'first'
    if (oddEvenEnabled && pageNo % 2 === 1) return 'even'
    return 'default'
  }

  public compute() {
    this.recovery()
    this._computeRowList()
    this._computePositionList()
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
    return this.draw.computeRowList({
      innerWidth,
      elementList
    })
  }

  private _computePositionList() {
    this._computePositionListFor(this.rowList, this.positionList)
  }

  private _computePositionListFor(
    rowList: IRow[],
    positionList: IElementPosition[]
  ) {
    const footerBottom = this.getFooterBottom()
    const innerWidth = this.draw.getInnerWidth()
    const margins = this.draw.getMargins()
    const startX = margins[3]
    const pageHeight = this.draw.getHeight()
    // Anchor the footer band against the bottom using THIS list's row sum
    // so each variant has its own correct startY (otherwise a tall variant
    // would render with the active variant's offset and leak off-page).
    const ownHeight = rowList.reduce((acc, r) => acc + r.height, 0)
    const maxHeight = this.getMaxHeight()
    const footerHeight = ownHeight > maxHeight ? maxHeight : ownHeight
    const startY = pageHeight - footerBottom - footerHeight
    this.position.computePageRowPosition({
      positionList,
      rowList,
      pageNo: 0,
      startRowIndex: 0,
      startIndex: 0,
      startX,
      startY,
      innerWidth,
      zone: EditorZone.FOOTER
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

  public getFooterBottom(): number {
    const {
      footer: { bottom, disabled },
      scale
    } = this.options
    if (disabled) return 0
    return Math.floor(bottom * scale)
  }

  public getMaxHeight(): number {
    const {
      footer: { maxHeightRadio }
    } = this.options
    const height = this.draw.getHeight()
    return Math.floor(height * maxHeightRadioMapping[maxHeightRadio])
  }

  public getHeight(pageNo?: number): number {
    if (this.options.footer.disabled) return 0
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
    const footerHeight = this.getHeight(pageNo)
    const footerBottom = this.getFooterBottom()
    const extraHeight = footerBottom + footerHeight - margins[2]
    return extraHeight <= 0 ? 0 : extraHeight
  }

  public render(ctx: CanvasRenderingContext2D, pageNo: number) {
    const variant = this.resolveVariantForPage(pageNo)
    const isActive = variant === this.activeVariant
    const elementList = isActive
      ? this.elementList
      : this.variantStorage[variant] ?? []
    if (!elementList.length) return
    const sourceRowList = isActive
      ? this.rowList
      : this._ensureVariantLayout(variant).rowList
    const positionList = isActive
      ? this.positionList
      : this._ensureVariantLayout(variant).positionList
    if (!sourceRowList.length) return

    ctx.save()
    ctx.globalAlpha = this.zone.isFooterActive()
      ? 1
      : this.options.footer.inactiveAlpha
    const innerWidth = this.draw.getInnerWidth()
    const maxHeight = this.getMaxHeight()
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
    const restore = applyPageNumberTokens(elementList, this.draw, pageNo)
    try {
      this.draw.drawRow(ctx, {
        elementList,
        positionList,
        rowList,
        pageNo,
        startIndex: 0,
        innerWidth,
        zone: EditorZone.FOOTER
      })
    } finally {
      restore()
      ctx.restore()
    }
  }
}
