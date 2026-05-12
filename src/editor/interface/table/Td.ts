import { VerticalAlign } from '../../dataset/enum/VerticalAlign'
import {
  TableBorderStyle,
  TdBorder,
  TdSlash
} from '../../dataset/enum/table/Table'
import { IElement, IElementPosition } from '../Element'
import { IRow } from '../Row'

export interface ITd {
  conceptId?: string
  id?: string
  extension?: unknown
  externalId?: string
  x?: number
  y?: number
  width?: number
  height?: number
  colspan: number
  rowspan: number
  value: IElement[]
  trIndex?: number
  tdIndex?: number
  isLastRowTd?: boolean
  isLastColTd?: boolean
  isLastTd?: boolean
  rowIndex?: number
  colIndex?: number
  rowList?: IRow[]
  positionList?: IElementPosition[]
  verticalAlign?: VerticalAlign
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  borderStyle?: TableBorderStyle
  borderTypes?: TdBorder[]
  slashTypes?: TdSlash[]
  mainHeight?: number // 内容 + 内边距高度
  realHeight?: number // 真实高度（包含跨列）
  realMinHeight?: number // 真实最小高度（包含跨列）
  disabled?: boolean // 内容不可编辑
  deletable?: boolean // 内容不可删除
  // PERF-PLAN §2.5 / Phase 2B：单元格 dirty 标志。当 spliceElementList 改动 td.value
  // 时由 Mutator 边界自动置 true；下次主体 computeRowList 抵达该 td 时若该标志为
  // false 且缓存键未变，可直接复用 td.rowList，跳过递归计算。仅供 Draw 内部使用，
  // 不应暴露给上层调用方。
  _dirty?: boolean
  // 上一帧渲染该 td 时的缓存键。任一字段（innerWidth / scale / isPagingMode）变化
  // 都意味着上次的 rowList 已经失效，必须重新跑 computeRowList。
  _cacheInnerWidth?: number
  _cacheScale?: number
  _cacheIsPagingMode?: boolean
}
