import { RowFlex } from '../dataset/enum/Row'
import { IElement, IElementMetrics } from './Element'
import { IPageColumns } from './PageColumns'

export type IRowElement = IElement & {
  metrics: IElementMetrics
  style: string
  left?: number
}

export interface IRow {
  width: number
  height: number
  ascent: number
  // PERF-PLAN §2.2 — pre-spacing row geometry. Captured at row construction so
  // the paragraph-spacing post-process can re-apply spaceBefore/spaceAfter
  // idempotently across incremental renders (prefix rows are iterated again on
  // each frame, so a naive `height += spaceBefore` would compound). Also used
  // by `_tryConvergeIncrementalRowList` to compare a freshly computed (pre-
  // spacing) row against an old row that has already had spacing applied.
  baseHeight?: number
  baseAscent?: number
  rowFlex?: RowFlex
  startIndex: number
  isPageBreak?: boolean
  isColumnBreak?: boolean
  // MS Word style section break (NEXT_PAGE / CONTINUOUS / EVEN_PAGE / ODD_PAGE).
  // Carried on the row so pagination can apply page-parity rules; the precise
  // flavour lives on the source element's `sectionBreakType` field.
  isSectionBreak?: boolean
  columnIndex?: number
  isList?: boolean
  listIndex?: number
  listLevel?: number
  listGlyph?: string
  offsetX?: number
  // Right-edge offset for paragraph right indent. Mirrors `offsetX` (left) and
  // is consumed by both the wrap calculation (Draw) and the row alignment math
  // (Position.computePageRowPosition) so right indent both trims line length
  // and pulls right-aligned / centered content inward from the right margin.
  rightOffsetX?: number
  offsetY?: number
  elementList: IRowElement[]
  isWidthNotEnough?: boolean
  rowIndex: number
  isSurround?: boolean
  pageColumns?: Required<IPageColumns>
  innerWidth?: number
  pageStartX?: number
  pageStartY?: number
}
