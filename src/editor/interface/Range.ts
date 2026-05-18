import { EditorZone } from '../dataset/enum/Editor'
import {
  IElement,
  IElementBasic,
  IElementFillRect,
  IElementStyle
} from './Element'

export interface IRange {
  startIndex: number
  endIndex: number
  isCrossRowCol?: boolean
  tableId?: string
  startTdIndex?: number
  endTdIndex?: number
  startTrIndex?: number
  endTrIndex?: number
  zone?: EditorZone
}

/**
 * Google-Docs-style list-block selection state, parallel to the text-range
 * selection. When set on RangeManager, the renderer paints full-row-width
 * background fills instead of per-character text-selection fills.
 *   • startIndex / endIndex: span in main element list (typically first
 *     paragraph ZERO to last paragraph end)
 *   • level: when set, only rows whose listLevel matches are highlighted —
 *     used by "Select items at this level" so child paragraphs interleaved
 *     with same-level peers don't appear selected
 *   • listId: optional defensive filter; when set, only rows whose paragraph
 *     shares this listId paint
 */
export interface IMarkerSelection {
  startIndex: number
  endIndex: number
  level?: number
  listId?: string
}

export type RangeRowArray = Map<number, number[]>

export type RangeRowMap = Map<number, Set<number>>

export type RangeRect = IElementFillRect

export type RangeContext = {
  isCollapsed: boolean
  startElement: IElement
  endElement: IElement
  startPageNo: number
  endPageNo: number
  startRowNo: number
  endRowNo: number
  startColNo: number
  endColNo: number
  rangeRects: RangeRect[]
  zone: EditorZone
  isTable: boolean
  trIndex: number | null
  tdIndex: number | null
  tableElement: IElement | null
  selectionText: string | null
  selectionElementList: IElement[]
  titleId: string | null
  titleStartPageNo: number | null
  startParagraphNo: number
  endParagraphNo: number
}

export interface IRangeParagraphInfo {
  elementList: IElement[]
  startIndex: number
}

export type IRangeElementStyle = Pick<
  IElementStyle,
  | 'bold'
  | 'color'
  | 'highlight'
  | 'font'
  | 'size'
  | 'italic'
  | 'underline'
  | 'strikeout'
> &
  Pick<IElementBasic, 'extension'>
