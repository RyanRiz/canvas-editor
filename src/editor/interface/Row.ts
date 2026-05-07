import { RowFlex } from '../dataset/enum/Row'
import { SectionBreakType } from '../dataset/enum/SectionBreak'
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
  rowFlex?: RowFlex
  startIndex: number
  isPageBreak?: boolean
  isColumnBreak?: boolean
  isSectionBreak?: boolean
  sectionBreakType?: SectionBreakType
  columnIndex?: number
  isList?: boolean
  listIndex?: number
  offsetX?: number
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
