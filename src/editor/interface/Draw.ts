import { ImageDisplay } from '../dataset/enum/Common'
import { EditorMode, EditorZone } from '../dataset/enum/Editor'
import { IElement, IElementPosition } from './Element'
import { IRow } from './Row'

/**
 * 本帧渲染所需的「输入」信号——告诉 render 哪里发生了什么变化。
 * 这是 PERF-PLAN §3.2 中将 IDrawOption 拆分出的「what」部分；
 * 与「how」(IRenderConfig) 分离便于 CRDT remote op、合并策略与
 * 调度器维护清晰的语义边界。
 */
export interface IRenderInput {
  curIndex?: number
  isTextInput?: boolean
  // 协作读写预留：远端 CRDT op 应用后，调度器据此并入本帧的脏区间。
  // 暂未消费，作为调度器入参占位（详见 PERF-PLAN §6.2c）。
  remoteDirtyRange?: { start: number; end: number }
  // 锚点位置：CRDT 友好的光标定位方式，按元素 id 而不是绝对索引描述。
  // Phase 3 仅占位——尚无消费方；与 curIndex 共存，二者择一即可（详见 PERF-PLAN §6.2b）。
  anchor?: IAnchorPosition
}

/**
 * 本帧渲染的「配置」——告诉 render 该怎么渲染。
 * 与 IRenderInput 拼接后等价于历史 IDrawOption。
 */
export interface IRenderConfig {
  isSetCursor?: boolean
  isSubmitHistory?: boolean
  isCompute?: boolean
  isLazy?: boolean
  isInit?: boolean
  isSourceHistory?: boolean
  isFirstRender?: boolean
}

/**
 * 历史 API 的 grab-bag 类型。新代码应使用 IRenderInput / IRenderConfig 拼接。
 * 保持别名以避免冲击数百处现有调用点。
 */
export type IDrawOption = IRenderInput & IRenderConfig

/**
 * CRDT 友好的光标 / 选区锚点（PERF-PLAN §6.2b）。
 *
 * 现有 RangeManager 使用绝对索引 `(startIndex, endIndex)`，远端 op 到达时
 * 会立刻失效。`afterId` / `beforeId` 是相对某个稳定元素 id 的位置，配合
 * `offset` 可以精确表达字符级锚点。Phase 3 仅引入类型与转换占位，尚无消费方。
 */
export interface IAnchorPosition {
  afterId?: string
  beforeId?: string
  offset?: number
}

export interface IForceUpdateOption {
  isSubmitHistory?: boolean
}

export interface IDrawImagePayload {
  id?: string
  conceptId?: string
  width: number
  height: number
  value: string
  imgDisplay?: ImageDisplay
  extension?: unknown
}

export interface IDrawRowPayload {
  elementList: IElement[]
  positionList: IElementPosition[]
  rowList: IRow[]
  pageNo: number
  startIndex: number
  innerWidth: number
  zone?: EditorZone
  isDrawLineBreak?: boolean
  isDrawWhiteSpace?: boolean
}

export interface IDrawFloatPayload {
  pageNo: number
  imgDisplays: ImageDisplay[]
}

export interface IDrawPagePayload {
  elementList: IElement[]
  positionList: IElementPosition[]
  rowList: IRow[]
  pageNo: number
}

export interface IPainterOption {
  isDblclick: boolean
}

export interface IGetValueOption {
  pageNo?: number
  extraPickAttrs?: Array<keyof IElement>
}

export type IGetOriginValueOption = Omit<IGetValueOption, 'extraPickAttrs'>

export interface IAppendElementListOption {
  isPrepend?: boolean
  isSubmitHistory?: boolean
}

export interface IGetImageOption {
  pixelRatio?: number
  mode?: EditorMode
  snapDomFunction?: (iframe: HTMLIFrameElement) => Promise<string>
}

export interface IComputeRowListPayload {
  innerWidth: number
  elementList: IElement[]
  startX?: number
  startY?: number
  isFromTable?: boolean
  isPagingMode?: boolean
  pageHeight?: number
  mainOuterHeight?: number
  surroundElementList?: IElement[]
}
