import { ImageDisplay } from '../dataset/enum/Common'
import { EditorMode, EditorZone } from '../dataset/enum/Editor'
import { IElement, IElementPosition } from './Element'
import { IPageColumns } from './PageColumns'
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
  // PERF-PLAN §2.2 — Phase 2B: 增量布局
  // checkpointSink：当提供时，computeRowList 会在每个行边界写入一个 checkpoint，
  // 与 rowList 平行索引（checkpointSink[R] 描述「重新进入行 R 之前」的循环局部状态）。
  // resumeFrom：从已捕获的 checkpoint 恢复，跳过 prefix 的元素遍历。两者通常配对使用：
  // 仅在确认 dirty range 起点之前的所有行都未受影响时才安全。
  checkpointSink?: ILayoutCheckpoint[]
  resumeFrom?: IComputeRowListResumePayload
}

/**
 * PERF-PLAN §2.2 / Phase 2B: 行边界处的循环局部状态快照。
 *
 * computeRowList 顶层 for-loop 在元素之间维护若干 carry 状态：
 *   x / y / pageNo / listId / listIndex / controlRealWidth / currentPageColumns /
 *   surroundElementList。
 *
 * 一个 ILayoutCheckpoint 描述「即将进入第 i 次迭代」时的这些值——也就是说，
 * 给定 rowList 的前缀和 checkpoint，computeRowList 可以从对应元素继续布局，
 * 并产出与「从 0 开始重新布局」字节相等的 IRow[]（前提：前缀元素未被改动）。
 *
 * surroundElementList 必须是浅拷贝快照，因为原始数组在循环中会被
 * deleteSurroundElementList 就地裁剪——直接引用会被后续迭代污染。
 */
export interface ILayoutCheckpoint {
  x: number
  y: number
  pageNo: number
  listId: string | undefined
  listIndex: number
  controlRealWidth: number
  currentPageColumns: Required<IPageColumns>
  // 浮动元素表的浅快照——在恢复时由 computeRowList 复制回工作数组。
  surroundElementList: IElement[]
}

/**
 * PERF-PLAN §2.2 / Phase 2B: 增量布局恢复点。
 *
 * - prefixRowList：保留的、未受 dirty range 影响的行（rowList[0..rowIndex-1]）。
 *   computeRowList 会以此为起点继续追加。前缀行内的元素引用应当保持不变，
 *   以便复用 element.metrics / element.style / element.left 等已计算字段。
 * - startElementIndex：恢复时 for-loop 的起始元素索引——一般等同于
 *   originalRowList[rowIndex].startIndex（即「我们丢弃的第一行」的起始元素）。
 * - checkpoint：与 rowIndex 对应的 ILayoutCheckpoint。
 * - convergenceTarget：可选的收敛目标。提供时 computeRowList 会在每个新行
 *   完成（rowList.push）后比较该行与 oldRowsAfterCut 中的某行——一旦命中
 *   完整匹配（元素引用、长度、宽高均相等）且越过 dirtyEndAbs，则提前终止
 *   循环，由调用方拼接旧尾部。这是把「在第 1 页改一个字」的工作量从 O(N) 压
 *   缩到 O(affected paragraph) 的关键。
 */
export interface IComputeRowListResumePayload {
  startElementIndex: number
  prefixRowList: IRow[]
  checkpoint: ILayoutCheckpoint
  convergenceTarget?: IConvergenceTarget
}

/**
 * PERF-PLAN §2.2 / Phase 2B: 收敛检测目标。
 *
 * 增量布局把 prefix 之后的所有行重排，但实际上当 dirty 影响被吸收后（典型场
 * 景：用户在段中插入一字符，影响只到该段末尾），后续行的布局必然与旧行
 * 完全相同——没必要继续重排。computeRowList 在每个新行 push 后做一次便宜的
 * 比对：若与 oldRowsAfterCut 里某行的元素 / 尺寸全等，且当前位置已越过
 * dirtyEndAbs，就把刚 push 的（继任）行丢弃、写下匹配点、跳出循环。
 *
 * 调用方据 `matched.atOldIdx` 把 oldRowsAfterCut[match+1..] 调整 startIndex /
 * rowIndex 后续接到 rowList，得到与全量布局字节相等的最终结果。
 */
export interface IConvergenceTarget {
  oldRowsAfterCut: IRow[]
  oldCheckpointsAfterCut: ILayoutCheckpoint[]
  dirtyEndAbs: number
  // 输出：computeRowList 命中收敛时写入；初始为 null。
  matched: { atOldIdx: number } | null
}
