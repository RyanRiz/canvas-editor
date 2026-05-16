import { ImageDisplay } from '../dataset/enum/Common'
import { ControlComponent } from '../dataset/enum/Control'
import { PaperDirection } from '../dataset/enum/Editor'
import { ElementType } from '../dataset/enum/Element'
import { SectionBreakType } from '../dataset/enum/SectionBreak'
import { ListStyle, ListType } from '../dataset/enum/List'
import { RowFlex } from '../dataset/enum/Row'
import { TitleLevel } from '../dataset/enum/Title'
import { TableBorder, TableBorderStyle } from '../dataset/enum/table/Table'
import { IArea } from './Area'
import { IBlock } from './Block'
import { ICheckbox } from './Checkbox'
import { IPadding } from './Common'
import { IControl } from './Control'
import { IParagraphBorder } from './ParagraphBorder'
import { IPageColumns } from './PageColumns'
import { IRadio } from './Radio'
import { ITextDecoration } from './Text'
import { ITitle } from './Title'
import { IColgroup } from './table/Colgroup'
import { ITr } from './table/Tr'
import { ITabStop } from './Ruler'

export interface IElementBasic {
  id?: string
  type?: ElementType
  value: string
  extension?: unknown
  externalId?: string
  pageColumns?: IPageColumns
}

export interface IElementStyle {
  font?: string
  size?: number
  width?: number
  height?: number
  bold?: boolean
  color?: string
  highlight?: string
  // MS Word paragraph shading — a paragraph-level background painted behind
  // every row of the paragraph, indent-respecting and fragmenting across page
  // boundaries. Distinct from `highlight` (character-level, glyph-tight). The
  // value is stamped on the paragraph's ZERO delimiter element (see the
  // `_applyParagraphSpacing` pattern) and read off the ZERO during render so
  // any row in the paragraph sees the same color.
  paragraphShading?: string
  // MS Word paragraph border (`<w:pBdr>`) — block decoration that wraps the
  // paragraph fragment (the rows of this paragraph on a single page/column),
  // not individual text runs. Stamped on the paragraph's ZERO delimiter, same
  // resolution path as `paragraphShading`. See `IParagraphBorder` for the
  // fragment / cross-page behavior.
  paragraphBorder?: IParagraphBorder
  italic?: boolean
  underline?: boolean
  strikeout?: boolean
  rowFlex?: RowFlex
  rowMargin?: number
  letterSpacing?: number
  textDecoration?: ITextDecoration
  indent?: number
  rightIndent?: number
  /**
   * MS Word-style first-line indent — an extra offset applied **only to the
   * first row of the paragraph**, on top of `indent`. Stored as fractional
   * tab-width units (same unit as `indent` / `rightIndent`), so the ruler can
   * drive non-integer drags. Stamped on every element of the paragraph (mirrors
   * `indent`); reads converge on the cursor element.
   *
   * Word's three left markers map as:
   *   - First-line triangle position  = `indent + firstLineIndent`
   *   - Hanging triangle position     = `indent`
   *   - Left rectangle moves both     (preserves `firstLineIndent` delta)
   */
  firstLineIndent?: number
  /**
   * Word `<w:tabs>` — per-paragraph tab stops. Stamped on every element of the
   * paragraph (mirrors `indent` / `firstLineIndent`). Positions are CSS pixels
   * at scale=1, measured from the paragraph's left indent boundary.
   *
   * When a `\t` character is rendered, the layout walks `tabStops` for the
   * first stop > current X; if none, falls back to the implicit default-tab
   * grid (`options.ruler.defaultTabStopInterval` at scale=1).
   */
  tabStops?: ITabStop[]
  spaceBefore?: number
  spaceAfter?: number
}

export interface IElementRule {
  hide?: boolean
}

export interface IElementGroup {
  groupIds?: string[]
}

export interface ITitleElement {
  valueList?: IElement[]
  level?: TitleLevel
  titleId?: string
  title?: ITitle
}

export interface IListElement {
  valueList?: IElement[]
  listType?: ListType
  listStyle?: ListStyle
  listId?: string
  listWrap?: boolean
}

export interface ITableAttr {
  colgroup?: IColgroup[]
  trList?: ITr[]
  borderType?: TableBorder
  borderStyle?: TableBorderStyle
  borderColor?: string
  borderWidth?: number
  borderExternalWidth?: number
  translateX?: number
  tableFigureLabel?: string
  tableFigureCaption?: string
  tableFigureDescription?: string
}

export interface ITableRule {
  tableToolDisabled?: boolean
}

export interface ITableElement {
  tdId?: string
  trId?: string
  tableId?: string
  conceptId?: string
  pagingId?: string // 用于区分拆分的表格同属一个源表格
  pagingIndex?: number // 拆分的表格索引
}

export type ITable = ITableAttr & ITableRule & ITableElement

export interface IHyperlinkElement {
  valueList?: IElement[]
  url?: string
  hyperlinkId?: string
}

export interface ISuperscriptSubscript {
  actualSize?: number
}

export interface ISeparator {
  dashArray?: number[]
  lineWidth?: number
}

export interface ISectionBreakElement {
  // Section break flavour (MS Word semantics). Only meaningful when
  // `type === ElementType.SECTION_BREAK`; carried on the element rather than a
  // dedicated node so the existing block-break plumbing (row.isPageBreak,
  // ctrl-backspace atomic delete, clipboard serialization) can be reused.
  sectionBreakType?: SectionBreakType
  // Page orientation for the section that *precedes* this break. MS Word
  // stores section properties on the section-break paragraph mark that ends
  // the section; we follow the same convention. The trailing pseudo-section
  // (everything after the last break, or the whole document if no breaks)
  // falls back to `Draw.options.paperDirection`.
  paperDirection?: PaperDirection
}

export interface IControlElement {
  control?: IControl
  controlId?: string
  controlComponent?: ControlComponent
}

export interface ICheckboxElement {
  checkbox?: ICheckbox
}

export interface IRadioElement {
  radio?: IRadio
}

export interface ILaTexElement {
  laTexSVG?: string
}

export interface IDateElement {
  dateFormat?: string
  dateId?: string
}

export interface IImageRule {
  imgToolDisabled?: boolean
  imgPreviewDisabled?: boolean
}

export interface IImageCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface IImageCaption {
  value: string
  color?: string
  font?: string
  size?: number
  top?: number
}

export interface IImgCaptionOption {
  color?: string
  font?: string
  size?: number
  top?: number
}

export interface IListOption {
  inheritStyle?: boolean // 是否让列表序号继承文字样式
}

export interface IImageBorder {
  /** Border thickness in CSS pixels (the canvas-editor unit). UI surfaces
   *  convert to/from points (pt × 96/72 = px). */
  width: number
  color: string
  style: 'solid' | 'round-dot' | 'dash'
}

export interface IImageBasic {
  imgDisplay?: ImageDisplay
  imgFloatPosition?: {
    x: number
    y: number
    pageNo?: number
  }
  imgCrop?: IImageCrop
  imgCaption?: IImageCaption
  imgFigureLabel?: string
  imgFigureCaption?: string
  imgFigureDescription?: string
  imgBorder?: IImageBorder
  imgRotate?: number
  /** Mirror horizontally (about the vertical centre line). */
  imgFlipH?: boolean
  /** Mirror vertically (about the horizontal centre line). */
  imgFlipV?: boolean
}

export type IImageElement = IImageBasic & IImageRule

export interface IBlockElement {
  block?: IBlock
}

export interface IAreaElement {
  valueList?: IElement[]
  areaId?: string
  areaIndex?: number
  area?: IArea
}

export interface ILabelElement {
  labelId?: string
  label?: {
    color?: string
    backgroundColor?: string
    borderRadius?: number
    padding?: IPadding
  }
}

export interface IPageNumberElement {
  /** Marker indicating this text element substitutes its value with the live
   *  page number / page count at draw time. */
  pageNumberKind?: 'pageNo' | 'pageCount'
  /** Numeral style used when rendering the substituted value. Falls back to
   *  the global pageNumber.numberType option when omitted. */
  pageNumberFormat?: 'arabic' | 'chinese' | 'roman-upper' | 'roman-lower'
}

export type IElement = IElementBasic &
  IElementStyle &
  IElementRule &
  IElementGroup &
  ITable &
  IHyperlinkElement &
  ISuperscriptSubscript &
  ISeparator &
  ISectionBreakElement &
  IControlElement &
  ICheckboxElement &
  IRadioElement &
  ILaTexElement &
  IDateElement &
  IImageElement &
  IBlockElement &
  ITitleElement &
  IListElement &
  IAreaElement &
  ILabelElement &
  IPageNumberElement

export interface IElementMetrics {
  width: number
  height: number
  boundingBoxAscent: number
  boundingBoxDescent: number
}

export interface IElementPosition {
  pageNo: number
  index: number
  value: string
  rowIndex: number
  rowNo: number
  ascent: number
  lineHeight: number
  left: number
  metrics: IElementMetrics
  isFirstLetter: boolean
  isLastLetter: boolean
  coordinate: {
    leftTop: number[]
    leftBottom: number[]
    rightTop: number[]
    rightBottom: number[]
  }
}

export interface IElementFillRect {
  x: number
  y: number
  width: number
  height: number
}

export interface IUpdateElementByIdOption {
  id?: string
  conceptId?: string
  properties: Omit<Partial<IElement>, 'id'>
}

export interface IDeleteElementByIdOption {
  id?: string
  conceptId?: string
}

export interface IGetElementByIdOption {
  id?: string
  conceptId?: string
}

export interface IInsertElementListOption {
  isReplace?: boolean
  isSubmitHistory?: boolean
  ignoreContextKeys?: Array<keyof IElement>
}

export interface ISpliceElementListOption {
  isIgnoreDeletedRule?: boolean
}
