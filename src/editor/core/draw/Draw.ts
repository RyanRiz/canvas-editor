import { version } from '../../../../package.json'
import { ZERO } from '../../dataset/constant/Common'
import { RowFlex } from '../../dataset/enum/Row'
import {
  IAppendElementListOption,
  IComputeRowListPayload,
  IDrawFloatPayload,
  IDrawOption,
  IDrawPagePayload,
  IDrawRowPayload,
  IGetImageOption,
  IGetOriginValueOption,
  IGetValueOption,
  IConvergenceTarget,
  ILayoutCheckpoint,
  IPainterOption
} from '../../interface/Draw'
import { HistoryScope } from '../../interface/History'
import { IMutationEvent, MutationListener } from '../../interface/Mutation'
import {
  IEditorData,
  IEditorOption,
  IEditorResult,
  ISetValueOption
} from '../../interface/Editor'
import {
  IElement,
  IElementPosition,
  IElementMetrics,
  IElementFillRect,
  IElementStyle,
  ISpliceElementListOption,
  IInsertElementListOption
} from '../../interface/Element'
import { IRow, IRowElement } from '../../interface/Row'
import { deepClone, getUUID } from '../../utils'
import { Cursor } from '../cursor/Cursor'
import { CanvasEvent } from '../event/CanvasEvent'
import { GlobalEvent } from '../event/GlobalEvent'
import { HistoryManager } from '../history/HistoryManager'
import { Listener } from '../listener/Listener'
import { Position } from '../position/Position'
import { RangeManager } from '../range/RangeManager'
import { Background } from './frame/Background'
import { Highlight } from './richtext/Highlight'
import { Margin } from './frame/Margin'
import { Search } from './interactive/Search'
import { Strikeout } from './richtext/Strikeout'
import { Underline } from './richtext/Underline'
import { ElementType } from '../../dataset/enum/Element'
import { ImageParticle } from './particle/ImageParticle'
import { LaTexParticle } from './particle/latex/LaTexParticle'
import { TextParticle } from './particle/TextParticle'
import { PageNumber } from './frame/PageNumber'
import { ScrollObserver } from '../observer/ScrollObserver'
import { SelectionObserver } from '../observer/SelectionObserver'
import { TableParticle } from './particle/table/TableParticle'
import { TableTool } from './particle/table/TableTool'
import { HyperlinkParticle } from './particle/HyperlinkParticle'
import { LabelParticle } from './particle/LabelParticle'
import { Header } from './frame/Header'
import { SuperscriptParticle } from './particle/SuperscriptParticle'
import { SubscriptParticle } from './particle/SubscriptParticle'
import { SeparatorParticle } from './particle/SeparatorParticle'
import { PageBreakParticle } from './particle/PageBreakParticle'
import { Watermark } from './frame/Watermark'
import { WatermarkLayer } from '../../dataset/enum/Watermark'
import {
  EditorComponent,
  EditorMode,
  EditorZone,
  PageMode,
  PaperDirection,
  WordBreak
} from '../../dataset/enum/Editor'
import { Control } from './control/Control'
import {
  deleteSurroundElementList,
  getIsBlockElement,
  getSlimCloneElementList,
  pickSurroundElementList,
  zipElementList
} from '../../utils/element'
import { CheckboxParticle } from './particle/CheckboxParticle'
import { RadioParticle } from './particle/RadioParticle'
import { DeepRequired, IPadding } from '../../interface/Common'
import {
  ControlComponent,
  ControlIndentation
} from '../../dataset/enum/Control'
import { formatElementList } from '../../utils/element'
import { WorkerManager } from '../worker/WorkerManager'
import { Previewer } from './particle/previewer/Previewer'
import { DateParticle } from './particle/date/DateParticle'
import { IMargin } from '../../interface/Margin'
import { BlockParticle } from './particle/block/BlockParticle'
import { EDITOR_COMPONENT, EDITOR_PREFIX } from '../../dataset/constant/Editor'
import { I18n } from '../i18n/I18n'
import { ImageObserver } from '../observer/ImageObserver'
import { Zone } from '../zone/Zone'
import { Footer } from './frame/Footer'
import {
  IMAGE_ELEMENT_TYPE,
  TEXTLIKE_ELEMENT_TYPE
} from '../../dataset/constant/Element'
import { ListParticle } from './particle/ListParticle'
import { Placeholder } from './frame/Placeholder'
import { EventBus } from '../event/eventbus/EventBus'
import { EventBusMap } from '../../interface/EventBus'
import { Group } from './interactive/Group'
import { Override } from '../override/Override'
import { FlexDirection, ImageDisplay } from '../../dataset/enum/Common'
import {
  PUNCTUATION_REG,
  WHITE_SPACE_REG
} from '../../dataset/constant/Regular'
import { LineBreakParticle } from './particle/LineBreakParticle'
import { WhiteSpaceParticle } from './particle/WhiteSpaceParticle'
import { MouseObserver } from '../observer/MouseObserver'
import { LineNumber } from './frame/LineNumber'
import { PageBorder } from './frame/PageBorder'
import { ITd } from '../../interface/table/Td'
import { Actuator } from '../actuator/Actuator'
import { TableOperate } from './particle/table/TableOperate'
import { Area } from './interactive/Area'
import { Badge } from './frame/Badge'
import { Graffiti } from './graffiti/Graffiti'
import { Magnifier } from './interactive/Magnifier'
import { IPageColumns } from '../../interface/PageColumns'
import { IRange } from '../../interface/Range'
import { IPositionContext } from '../../interface/Position'

/**
 * PERF-PLAN §1.2 / Phase 1.2：delta-based history 的「BEFORE 状态」元数据。
 *
 * 一次 submitHistory 落盘 delta 时除了承载 mutation 数组，还需要把 range /
 * positionContext / pageNo / zone 这些非元素的小状态一并锁住，否则 undo /
 * redo 后光标位置 / 当前编辑分区就会与文档内容脱节。
 */
interface IDeltaHistoryMeta {
  range: IRange
  positionContext: IPositionContext
  pageNo: number
  zone: EditorZone
}

/**
 * PERF-PLAN §1.2 / Phase 1.2：delta-based history stack 条目。
 *
 * 与传统的「Function 即 snapshot 还原器」并列存在；HistoryManager 在 undo /
 * redo 时按 kind 分发：
 *   - kind: 'snapshot'  →  call restore()，restore 内部把整份元素列表从 deepClone
 *     拷贝回来（legacy 行为，覆盖 property-only commands 等无法 delta 描述的场景）。
 *   - kind: 'delta'  →  applyForward 应用 mutations 顺序、还原 metaAfter；
 *     applyBackward 应用 mutations 逆序的逆向、还原 metaBefore。两者皆在
 *     `_isReplayingHistory=true` 的临界区内执行，避免再次入栈循环。
 */
export type DraftHistoryStackItem =
  | { kind: 'snapshot'; restore: () => void }
  | {
      kind: 'delta'
      applyForward: () => void
      applyBackward: () => void
    }

interface IPageLayoutSignature {
  firstRowStartIndex: number
  lastRowStartIndex: number
  rowCount: number
  rowHeightSum: number
}

interface IPagePaintPlan {
  firstShiftedPage: number | null
  syncPages: Set<number>
  deferredPages: Set<number>
}

export class Draw {
  private container: HTMLDivElement
  private pageContainer: HTMLDivElement
  private pageList: HTMLCanvasElement[]
  private ctxList: CanvasRenderingContext2D[]
  // PERF-PLAN — Strategy B：分层 canvas。每页结构 = wrapper div > [base canvas + decoration canvas]。
  // pageList / ctxList 仍然是「base」canvas + ctx，对外接口零变化（mouse 事件、scroll
  // observer、PDF 导出等都基于 base）。decorationCanvasList / decorationCtxList 是
  // 与之平行的「decoration」层；当 options.pageLayered.enable=false 时这两个数组中的
  // 条目直接 alias 到 base，所有 paint 代码无差别地写到一个 ctx——零回归。
  private decorationCanvasList: HTMLCanvasElement[]
  private decorationCtxList: CanvasRenderingContext2D[]
  private chromeCacheCanvasList: HTMLCanvasElement[]
  private chromeCacheCtxList: CanvasRenderingContext2D[]
  private chromeCacheKeyList: (string | null)[]
  private pageWrapperList: HTMLDivElement[]
  // 装饰层 dirty page 集合：与 _drawnPages 平行——「这一页的 decoration 已是最新」。
  // 装饰层只跟踪：选区 / 搜索高亮 / 表格跨行/列。base 重绘时同时清空 decoration
  // 缓存（base 改 → row 几何变 → 选区位置可能变）。
  // PERF-PLAN — Strategy B-γ：从 Set<number> 改为 Map<pageNo, version>。
  // 同一 (range, search) 状态下重复 decoration-only 渲染（典型场景：mousemove
  // 抖动多次落到同一选区位置）→ 命中即跳过 _walkDecorationRow，O(N) 行遍历
  // 退化为 1 个 Map.get + 比较。
  private _decorationDrawnPages: Map<number, number>
  // PERF-PLAN — Strategy B-γ：装饰层逻辑「版本号」。
  //   - 初始为 0；range / search keyword 任一变更时 +1
  //   - _drawDecorationOnly 完成时把 _decorationVersion 写入对应 pageNo
  //   - 下次进入 decoration-only 路径前，发现 pageVersion === _decorationVersion
  //     → 跳过本页（DOM 已是最新）
  // 注意：base 重绘（_drawPage）会同时把 decoration 一起画，因此 base 重绘后
  // 也用同一 _decorationVersion 标记 → decoration-only 紧随其后命中缓存。
  private _decorationVersion: number
  // drawRow 内部 range / table-cross-row paint 时使用的目标 ctx——_drawPage 在
  // 调用 drawRow 前置位为 decoration ctx，drawRow 完成后清零。
  // 为 null 时（包括非分层模式 / 单元格递归外层）走原 ctx——零回归。
  private _currentDecorationCtx: CanvasRenderingContext2D | null
  private _suppressDecorationPaint: boolean
  // 复用的测量画布上下文（避免 computeRowList 每次创建 canvas）
  private _measureCanvas: HTMLCanvasElement | null
  private _measureCtx: CanvasRenderingContext2D | null
  // rAF 合并渲染队列：fast-typing 时多次 keystroke 仅产出一次 layout/paint
  private _pendingRenderPayload: IDrawOption | null
  private _pendingRenderFrameId: number | null
  // 输入合批（PERF-PLAN §1.2）：连续 keystroke 合并为单个 history snapshot，
  // 闲置 500ms 或遇到非输入动作时落盘
  private _typingBatchActive: boolean
  private _typingBatchTimer: ReturnType<typeof setTimeout> | null
  private _typingBatchLastCurIndex: number | undefined
  // 主元素列表 dirty 区间提示（PERF-PLAN §2.1）。当突变发生时由 spliceElementList
  // 自动维护或外部通过 markDirty() 显式标记；render() 据此挑选 dirty page，
  // 只重绘被影响的 canvas（§2.4）。提示性而非权威——为 null 时按现有 O(N) 路径处理。
  private _dirtyRange: { start: number; end: number } | null
  // 页眉 / 页脚 dirty 标志：仅当对应 elementList 通过 spliceElementList 改动时置 true。
  // render() 据此跳过未变更分区的布局 / 计算，尤其重要——典型场景是用户在 header 中
  // 输入：避免为了一次按键而把整篇 N-page 主文档重新布局（PERF-PLAN §2 follow-up）。
  private _headerDirty: boolean
  private _footerDirty: boolean
  private _headerChromeVersion: number
  private _footerChromeVersion: number
  // 上一次渲染各 page 的 row 数；仍用于某些增量 position 复用判定。
  private _prevPageRowCounts: number[] | null
  // 上一次渲染各 page 的轻量布局签名。用于判断从哪一页开始发生分页漂移。
  private _prevPageLayoutSignatures: IPageLayoutSignature[] | null
  // 当前 paintPlan 的 shifted 起点（仅用于本轮 paint 的局部优化提示）。
  private _paintPlanFirstShiftedPage: number | null
  // 已绘制（且未被标脏）的 page 索引集合：lazy 渲染时这些页不再重复绘制
  private _drawnPages: Set<number>
  // PERF-PLAN §2.2 / Phase 2B：主元素列表 computeRowList 的行边界 checkpoint。
  // 与 this.rowList 平行索引——_mainRowCheckpoints[R] 描述「即将进入行 R 的第一个
  // 元素的迭代」时的循环局部状态。仅当主体进行 full / 增量布局后才有值；
  // 任何能让前缀行内容失效的事件（setEditorData / 跨字号字距的设置变更）必须
  // 通过 _invalidatePaintCache() 一并清空。
  private _mainRowCheckpoints: ILayoutCheckpoint[]
  // 上一帧主布局的「输入签名」。option.scale / innerWidth / pagingMode 等会改变
  // 任意 row 的几何形状的字段都纳入；不一致时禁用增量布局，回退到全量。
  private _mainLayoutSig: {
    scale: number
    innerWidth: number
    isPagingMode: boolean
    defaultSize: number
    defaultRowMargin: number
    defaultTabWidth: number
  } | null
  // PERF-PLAN §3.1：Mutator 边界事件订阅者。spliceElementList 完成后通知。
  private _mutationListeners: Set<MutationListener>
  // PERF-PLAN follow-up：主元素列表中带 imgDisplay=SURROUND 的浮动元素计数缓存。
  // null 表示「未知 / 待重新统计」（会触发一次 O(N) 扫描）；> 0 表示需要构建
  // surroundElementList，等于 0 时 render 可直接跳过 pickSurroundElementList。
  // 由 spliceElementList 维护增量；setEditorData 等大批量替换会重置为 null。
  private _mainSurroundCount: number | null
  // PERF-PLAN follow-up：主元素列表中带 areaId 的元素计数缓存——同 SURROUND，
  // 当 0 时 area.compute 可直接跳过 O(N) 扫描。绝大多数文档（不使用 area）每
  // 帧因此省下 ~30k 次属性访问。
  private _mainAreaCount: number | null
  // PERF-PLAN §1.2 / Phase 1.2：自上次 submitHistory 以来积累的「主元素列表」突变事件。
  // submitHistory 据此决定是否走 delta 分支：所有事件 scope=main 且没有破坏 delta
  // 不变量的旁路改动时，可避免 9× full deepClone。事件由 spliceElementList 自动
  // push（除非正在 replay history），submitHistory 完成后清空。
  private _pendingHistoryMutations: IMutationEvent[]
  // 标志位：自上次 submitHistory 以来发生过任何「不能用 delta 描述」的改动？
  // 任一为真则 submitHistory 必须 snapshot：
  //   - spliceElementList 触发的 listId/listType/listStyle 旁清理（属性写入未在 splice
  //     event 里捕获）
  //   - spliceElementList 受 deletable 规则保护跳过了部分元素（actualRemoved 与
  //     deleteCount 不一致——slice 不再对称）
  //   - 调用方显式 setEditorData / Header.setElementList / Footer.setElementList /
  //     property-only 命令（按目前的简化策略，非 splice 路径直接 snapshot）
  private _deltaHistoryUnsafe: boolean
  // 第一次 mutation 落入挂起队列时捕获的「BEFORE 状态」元数据，供 delta 入栈时携带。
  // 若整轮 submitHistory 走 snapshot 分支，本字段被忽略并清空。
  private _preMutationMeta: IDeltaHistoryMeta | null
  // 正在 replay history（undo/redo 的 applyForward / applyBackward 内部）时，
  // spliceElementList 不应再次把事件推回 _pendingHistoryMutations，否则形成
  // 自相干循环：当前撤销动作会被自己再记录一次。
  private _isReplayingHistory: boolean
  // 「scale-only」快路径标志位。setPageScale 在确认仅缩放发生改动时已就地把
  // rowList / element.metrics / table cache 等 scale-相关字段乘以 ratio，因此
  // 下一帧 render() 不必再跑 O(N) 的 computeRowList——只需重做 _computePageList /
  // computePositionList / area.compute 等纯算术依赖。25 页文档的 Fit-to-Page →
  // Fit-to-Width 在此路径下省下数百毫秒主线程时间。仅 setPageScale 内部使用，
  // render() 完成后立即清零；不应跨多次 render 持续。
  private _skipMainRowCompute: boolean
  private pageNo: number
  private renderCount: number
  private pagePixelRatio: number | null
  private mode: EditorMode
  private options: DeepRequired<IEditorOption>
  private position: Position
  private zone: Zone
  private elementList: IElement[]
  private listener: Listener
  private eventBus: EventBus<EventBusMap>
  private override: Override

  private i18n: I18n
  private canvasEvent: CanvasEvent
  private globalEvent: GlobalEvent
  private cursor: Cursor
  private range: RangeManager
  private margin: Margin
  private background: Background
  private badge: Badge
  private magnifier: Magnifier
  private search: Search
  private group: Group
  private area: Area
  private underline: Underline
  private strikeout: Strikeout
  private highlight: Highlight
  private historyManager: HistoryManager
  private previewer: Previewer
  private imageParticle: ImageParticle
  private laTexParticle: LaTexParticle
  private textParticle: TextParticle
  private tableParticle: TableParticle
  private tableTool: TableTool
  private tableOperate: TableOperate
  private pageNumber: PageNumber
  private lineNumber: LineNumber
  private waterMark: Watermark
  private placeholder: Placeholder
  private header: Header
  private footer: Footer
  private hyperlinkParticle: HyperlinkParticle
  private labelParticle: LabelParticle
  private dateParticle: DateParticle
  private separatorParticle: SeparatorParticle
  private pageBreakParticle: PageBreakParticle
  private superscriptParticle: SuperscriptParticle
  private subscriptParticle: SubscriptParticle
  private checkboxParticle: CheckboxParticle
  private radioParticle: RadioParticle
  private blockParticle: BlockParticle
  private listParticle: ListParticle
  private lineBreakParticle: LineBreakParticle
  private whiteSpaceParticle: WhiteSpaceParticle
  private control: Control
  private pageBorder: PageBorder
  private workerManager: WorkerManager
  private scrollObserver: ScrollObserver
  private selectionObserver: SelectionObserver
  private imageObserver: ImageObserver
  private graffiti: Graffiti

  private LETTER_REG: RegExp
  private WORD_LIKE_REG: RegExp
  private rowList: IRow[]
  private pageRowList: IRow[][]
  private painterStyle: IElementStyle | null
  private painterOptions: IPainterOption | null
  private visiblePageNoList: number[]
  private intersectionPageNo: number
  private lazyRenderIntersectionObserver: IntersectionObserver | null
  private printModeData: Required<Omit<IEditorData, 'graffiti'>> | null

  constructor(
    rootContainer: HTMLElement,
    options: DeepRequired<IEditorOption>,
    data: IEditorData,
    listener: Listener,
    eventBus: EventBus<EventBusMap>,
    override: Override
  ) {
    this.container = this._wrapContainer(rootContainer)
    this.pageList = []
    this.ctxList = []
    this.decorationCanvasList = []
    this.decorationCtxList = []
    this.chromeCacheCanvasList = []
    this.chromeCacheCtxList = []
    this.chromeCacheKeyList = []
    this.pageWrapperList = []
    this._decorationDrawnPages = new Map()
    this._decorationVersion = 0
    this._currentDecorationCtx = null
    this._suppressDecorationPaint = false
    this._measureCanvas = null
    this._measureCtx = null
    this._pendingRenderPayload = null
    this._pendingRenderFrameId = null
    this._typingBatchActive = false
    this._typingBatchTimer = null
    this._typingBatchLastCurIndex = undefined
    this._dirtyRange = null
    this._headerDirty = false
    this._footerDirty = false
    this._headerChromeVersion = 0
    this._footerChromeVersion = 0
    this._prevPageRowCounts = null
    this._prevPageLayoutSignatures = null
    this._paintPlanFirstShiftedPage = null
    this._drawnPages = new Set()
    this._mainRowCheckpoints = []
    this._mainLayoutSig = null
    this._mutationListeners = new Set()
    this._pendingHistoryMutations = []
    this._deltaHistoryUnsafe = false
    this._preMutationMeta = null
    this._isReplayingHistory = false
    this._mainSurroundCount = null
    this._mainAreaCount = null
    this._skipMainRowCompute = false
    this.pageNo = 0
    this.renderCount = 0
    this.pagePixelRatio = null
    this.mode = options.mode
    this.options = options
    this.elementList = data.main
    this.listener = listener
    this.eventBus = eventBus
    this.override = override

    this._formatContainer()
    this.pageContainer = this._createPageContainer()
    this._createPage(0)

    this.i18n = new I18n(options.locale)
    this.historyManager = new HistoryManager(this)
    this.position = new Position(this)
    this.zone = new Zone(this)
    this.range = new RangeManager(this)
    this.margin = new Margin(this)
    this.background = new Background(this)
    this.badge = new Badge(this)
    this.magnifier = new Magnifier(this)
    this.search = new Search(this)
    this.group = new Group(this)
    this.area = new Area(this)
    this.underline = new Underline(this)
    this.strikeout = new Strikeout(this)
    this.highlight = new Highlight(this)
    this.previewer = new Previewer(this)
    this.imageParticle = new ImageParticle(this)
    this.laTexParticle = new LaTexParticle(this)
    this.textParticle = new TextParticle(this)
    this.tableParticle = new TableParticle(this)
    this.tableTool = new TableTool(this)
    this.tableOperate = new TableOperate(this)
    this.pageNumber = new PageNumber(this)
    this.lineNumber = new LineNumber(this)
    this.waterMark = new Watermark(this)
    this.placeholder = new Placeholder(this)
    this.header = new Header(this, data.header)
    this.footer = new Footer(this, data.footer)
    this.hyperlinkParticle = new HyperlinkParticle(this)
    this.labelParticle = new LabelParticle(this)
    this.dateParticle = new DateParticle(this)
    this.separatorParticle = new SeparatorParticle(this)
    this.pageBreakParticle = new PageBreakParticle(this)
    this.superscriptParticle = new SuperscriptParticle()
    this.subscriptParticle = new SubscriptParticle()
    this.checkboxParticle = new CheckboxParticle(this)
    this.radioParticle = new RadioParticle(this)
    this.blockParticle = new BlockParticle(this)
    this.listParticle = new ListParticle(this)
    this.lineBreakParticle = new LineBreakParticle(this)
    this.whiteSpaceParticle = new WhiteSpaceParticle(this)
    this.control = new Control(this)
    this.pageBorder = new PageBorder(this)
    this.graffiti = new Graffiti(this, data.graffiti)

    this.scrollObserver = new ScrollObserver(this)
    this.selectionObserver = new SelectionObserver(this)
    this.imageObserver = new ImageObserver()
    new MouseObserver(this)

    this.canvasEvent = new CanvasEvent(this)
    this.cursor = new Cursor(this, this.canvasEvent)
    this.canvasEvent.register()
    this.globalEvent = new GlobalEvent(this, this.canvasEvent)
    this.globalEvent.register()

    this.workerManager = new WorkerManager(this)
    new Actuator(this)

    const { letterClass } = options
    this.LETTER_REG = new RegExp(`[${letterClass.join('')}]`)
    this.WORD_LIKE_REG = new RegExp(
      `${letterClass.map(letter => `[^${letter}][${letter}]`).join('|')}`
    )
    this.rowList = []
    this.pageRowList = []
    this.painterStyle = null
    this.painterOptions = null
    this.visiblePageNoList = []
    this.intersectionPageNo = 0
    this.lazyRenderIntersectionObserver = null
    this.printModeData = null

    // 打印模式优先设置打印数据
    if (this.mode === EditorMode.PRINT) {
      this.setPrintData()
    }
    this.range.setRange(0, 0)
    this.render({
      isInit: true,
      isSetCursor: true,
      isFirstRender: true,
      curIndex: 0
    })
    this.cursor.focus()
  }

  // 设置打印数据
  public setPrintData() {
    this.printModeData = {
      header: this.header.getElementList(),
      main: this.elementList,
      footer: this.footer.getElementList()
    }
    // 过滤控件辅助元素
    const clonePrintModeData = deepClone(this.printModeData)
    const editorDataKeys: (keyof Omit<IEditorData, 'graffiti'>)[] = [
      'header',
      'main',
      'footer'
    ]
    editorDataKeys.forEach(key => {
      clonePrintModeData[key] = this.control.filterAssistElement(
        clonePrintModeData[key]
      )
    })
    this.setEditorData(clonePrintModeData)
  }

  // 还原打印数据
  public clearPrintData() {
    if (this.printModeData) {
      this.setEditorData(this.printModeData)
      this.printModeData = null
    }
  }

  public getLetterReg(): RegExp {
    return this.LETTER_REG
  }

  public getMode(): EditorMode {
    return this.mode
  }

  public setMode(payload: EditorMode) {
    if (this.mode === payload) return
    // 设置打印模式
    if (payload === EditorMode.PRINT) {
      this.setPrintData()
    }
    // 取消打印模式
    if (this.mode === EditorMode.PRINT) {
      this.clearPrintData()
    }
    this.clearSideEffect()
    this.range.clearRange()
    this.mode = payload
    this.options.mode = payload
    this.render({
      isSetCursor: false,
      isSubmitHistory: false
    })
  }

  public isReadonly() {
    if (this.area.getActiveAreaInfo()?.area?.mode) {
      return this.area.isReadonly()
    }
    switch (this.mode) {
      case EditorMode.DESIGN:
        return false
      case EditorMode.READONLY:
      case EditorMode.PRINT:
      case EditorMode.GRAFFITI:
        return true
      case EditorMode.FORM:
        return !this.control.getIsRangeWithinControl()
      default:
        return false
    }
  }

  public isDisabled() {
    if (this.mode === EditorMode.DESIGN) return false
    const { startIndex, endIndex } = this.range.getRange()
    const elementList = this.getElementList()
    // 优先判断表格单元格
    if (this.getTd()?.disabled) return true
    if (startIndex === endIndex) {
      const startElement = elementList[startIndex]
      const nextElement = elementList[startIndex + 1]
      return !!(
        (startElement?.title?.disabled &&
          nextElement?.title?.disabled &&
          startElement.titleId === nextElement.titleId) ||
        (startElement?.control?.disabled &&
          nextElement?.control?.disabled &&
          startElement.controlId === nextElement.controlId)
      )
    }
    const selectionElementList = elementList.slice(startIndex + 1, endIndex + 1)
    return selectionElementList.some(
      element => element.title?.disabled || element.control?.disabled
    )
  }

  public isDesignMode() {
    return this.mode === EditorMode.DESIGN
  }

  public isPrintMode() {
    return this.mode === EditorMode.PRINT
  }

  public isGraffitiMode() {
    return this.mode === EditorMode.GRAFFITI
  }

  public getOriginalWidth(): number {
    const { paperDirection, width, height } = this.options
    return paperDirection === PaperDirection.VERTICAL ? width : height
  }

  public getOriginalHeight(): number {
    const { paperDirection, width, height } = this.options
    return paperDirection === PaperDirection.VERTICAL ? height : width
  }

  public getWidth(): number {
    return Math.floor(this.getOriginalWidth() * this.options.scale)
  }

  public getHeight(): number {
    return Math.floor(this.getOriginalHeight() * this.options.scale)
  }

  public getMainHeight(): number {
    const pageHeight = this.getHeight()
    return pageHeight - this.getMainOuterHeight()
  }

  public getMainOuterHeight(): number {
    const margins = this.getMargins()
    const headerExtraHeight = this.header.getExtraHeight()
    const footerExtraHeight = this.footer.getExtraHeight()
    return margins[0] + margins[2] + headerExtraHeight + footerExtraHeight
  }

  public getCanvasWidth(pageNo = -1): number {
    const page = this.getPage(pageNo)
    return page.width
  }

  public getCanvasHeight(pageNo = -1): number {
    const page = this.getPage(pageNo)
    return page.height
  }

  public getInnerWidth(): number {
    const width = this.getWidth()
    const margins = this.getMargins()
    return width - margins[1] - margins[3]
  }

  /**
   * 主元素列表中携带 areaId 的元素数量。返回 0 时调用方（如 area.compute）
   * 可直接跳过 O(N) 扫描。null 缓存表示「未统计」——首次调用 / 失效后会
   * 在这里 lazy-rebuild 一次，后续命中 spliceElementList 维护的增量计数。
   */
  public getMainAreaCount(): number {
    if (this._mainAreaCount === null) {
      let count = 0
      for (let i = 0; i < this.elementList.length; i++) {
        if (this.elementList[i].areaId) count++
      }
      this._mainAreaCount = count
    }
    return this._mainAreaCount
  }

  public getOriginalInnerWidth(): number {
    const width = this.getOriginalWidth()
    const margins = this.getOriginalMargins()
    return width - margins[1] - margins[3]
  }

  public normalizePageColumns(
    payload?: IPageColumns | null
  ): Required<IPageColumns> {
    return {
      columnCount: Math.max(
        1,
        Math.floor(
          payload?.columnCount ?? this.options.pageColumns?.columnCount ?? 1
        )
      ),
      columnGap: Math.max(
        0,
        payload?.columnGap ?? this.options.pageColumns?.columnGap ?? 0
      )
    }
  }

  public getPageColumns(): Required<IPageColumns> {
    return this.normalizePageColumns(this.options.pageColumns)
  }

  public isSamePageColumns(
    left?: IPageColumns | null,
    right?: IPageColumns | null
  ): boolean {
    const leftPageColumns = this.normalizePageColumns(left)
    const rightPageColumns = this.normalizePageColumns(right)
    return (
      leftPageColumns.columnCount === rightPageColumns.columnCount &&
      leftPageColumns.columnGap === rightPageColumns.columnGap
    )
  }

  public getPageColumnsAtIndex(index: number): Required<IPageColumns> {
    let pageColumns = this.getPageColumns()
    const maxIndex = Math.min(index, this.elementList.length - 1)
    if (maxIndex < 0) return pageColumns
    for (let i = 0; i <= maxIndex; i++) {
      const nextPageColumns = this.elementList[i].pageColumns
      if (nextPageColumns) {
        pageColumns = this.normalizePageColumns(nextPageColumns)
      }
    }
    return pageColumns
  }

  public getColumnCount(pageColumns?: IPageColumns | null): number {
    const count = this.normalizePageColumns(pageColumns).columnCount
    return count > 1 ? Math.floor(count) : 1
  }

  public getColumnGap(pageColumns?: IPageColumns | null): number {
    const gap = this.normalizePageColumns(pageColumns).columnGap
    return Math.max(0, gap) * this.options.scale
  }

  public getOriginalColumnGap(pageColumns?: IPageColumns | null): number {
    const gap = this.normalizePageColumns(pageColumns).columnGap
    return Math.max(0, gap)
  }

  public getColumnInnerWidth(pageColumns?: IPageColumns | null): number {
    const innerWidth = this.getInnerWidth()
    const count = this.getColumnCount(pageColumns)
    if (count <= 1) return innerWidth
    const totalGap = this.getColumnGap(pageColumns) * (count - 1)
    return Math.floor((innerWidth - totalGap) / count)
  }

  public getColumnStartX(
    columnIndex: number,
    pageColumns?: IPageColumns | null
  ): number {
    const margins = this.getMargins()
    if (this.getColumnCount(pageColumns) <= 1 || !columnIndex) return margins[3]
    return (
      margins[3] +
      columnIndex *
        (this.getColumnInnerWidth(pageColumns) + this.getColumnGap(pageColumns))
    )
  }

  private _fitTableToMaxWidth(element: IElement, maxWidth: number) {
    if (element.type !== ElementType.TABLE || !element.colgroup?.length) return
    const { defaultColMinWidth } = this.options.table
    const colgroup = element.colgroup
    let tableWidth = colgroup.reduce((sum, col) => sum + col.width, 0)
    if (tableWidth <= maxWidth) return
    let overflowWidth = tableWidth - maxWidth
    while (overflowWidth > 0) {
      const shrinkableCols = colgroup.filter(
        col => col.width > defaultColMinWidth
      )
      if (!shrinkableCols.length) break
      const adjustWidth = overflowWidth / shrinkableCols.length
      let reducedWidth = 0
      for (let i = 0; i < colgroup.length; i++) {
        const col = colgroup[i]
        if (col.width <= defaultColMinWidth) continue
        const nextWidth = Math.max(defaultColMinWidth, col.width - adjustWidth)
        reducedWidth += col.width - nextWidth
        col.width = nextWidth
      }
      if (!reducedWidth) break
      tableWidth -= reducedWidth
      overflowWidth = tableWidth - maxWidth
    }
    if (tableWidth <= maxWidth) {
      element.translateX = 0
    }
  }

  public getContextInnerWidth(): number {
    const positionContext = this.position.getPositionContext()
    if (positionContext.isTable) {
      const { index, trIndex, tdIndex } = positionContext
      const elementList = this.getOriginalElementList()
      const td = elementList[index!].trList![trIndex!].tdList[tdIndex!]
      const tdPadding = this.getTdPadding()
      return td!.width! - tdPadding[1] - tdPadding[3]
    }
    return this.getOriginalInnerWidth()
  }

  public getMargins(): IMargin {
    return <IMargin>this.getOriginalMargins().map(m => m * this.options.scale)
  }

  public getOriginalMargins(): number[] {
    const { margins, paperDirection } = this.options
    return paperDirection === PaperDirection.VERTICAL
      ? margins
      : [margins[1], margins[2], margins[3], margins[0]]
  }

  public getPageGap(): number {
    return this.options.pageGap * this.options.scale
  }

  public getOriginalPageGap(): number {
    return this.options.pageGap
  }

  public getPageNumberBottom(): number {
    const {
      pageNumber: { bottom },
      scale
    } = this.options
    return bottom * scale
  }

  public getMarginIndicatorSize(): number {
    return this.options.marginIndicatorSize * this.options.scale
  }

  public getDefaultBasicRowMarginHeight(): number {
    return this.options.defaultBasicRowMarginHeight * this.options.scale
  }

  public getHighlightMarginHeight(): number {
    return this.options.highlightMarginHeight * this.options.scale
  }

  public getTdPadding(): IPadding {
    const {
      table: { tdPadding },
      scale
    } = this.options
    return <IPadding>tdPadding.map(m => m * scale)
  }

  public getContainer(): HTMLDivElement {
    return this.container
  }

  public getPageContainer(): HTMLDivElement {
    return this.pageContainer
  }

  public getVisiblePageNoList(): number[] {
    return this.visiblePageNoList
  }

  public setVisiblePageNoList(payload: number[]) {
    this.visiblePageNoList = payload
    if (this.listener.visiblePageNoListChange) {
      this.listener.visiblePageNoListChange(this.visiblePageNoList)
    }
    if (this.eventBus.isSubscribe('visiblePageNoListChange')) {
      this.eventBus.emit('visiblePageNoListChange', this.visiblePageNoList)
    }
  }

  public getIntersectionPageNo(): number {
    return this.intersectionPageNo
  }

  public setIntersectionPageNo(payload: number) {
    this.intersectionPageNo = payload
    if (this.listener.intersectionPageNoChange) {
      this.listener.intersectionPageNoChange(this.intersectionPageNo)
    }
    if (this.eventBus.isSubscribe('intersectionPageNoChange')) {
      this.eventBus.emit('intersectionPageNoChange', this.intersectionPageNo)
    }
  }

  public getPageNo(): number {
    return this.pageNo
  }

  public setPageNo(payload: number) {
    this.pageNo = payload
  }

  public getRenderCount(): number {
    return this.renderCount
  }

  public getPage(pageNo = -1): HTMLCanvasElement {
    return this.pageList[~pageNo ? pageNo : this.pageNo]
  }

  public getPageList(): HTMLCanvasElement[] {
    return this.pageList
  }

  public getPageCount(): number {
    return this.pageList.length
  }

  public getTableRowList(sourceElementList: IElement[]): IRow[] {
    const positionContext = this.position.getPositionContext()
    const { index, trIndex, tdIndex } = positionContext
    return sourceElementList[index!].trList![trIndex!].tdList[tdIndex!].rowList!
  }

  public getOriginalRowList() {
    const zoneManager = this.getZone()
    if (zoneManager.isHeaderActive()) {
      return this.header.getRowList()
    }
    if (zoneManager.isFooterActive()) {
      return this.footer.getRowList()
    }
    return this.rowList
  }

  public getRowList(): IRow[] {
    const positionContext = this.position.getPositionContext()
    return positionContext.isTable
      ? this.getTableRowList(this.getOriginalElementList())
      : this.getOriginalRowList()
  }

  public getPageRowList(): IRow[][] {
    return this.pageRowList
  }

  public getCtx(): CanvasRenderingContext2D {
    return this.ctxList[this.pageNo]
  }

  public paintPageOnDom(payload: IDrawPagePayload) {
    this._drawPage(payload)
  }

  public paintDecorationOnDom(payload: IDrawPagePayload) {
    this._drawDecorationOnly(payload)
  }

  public getOptions(): DeepRequired<IEditorOption> {
    return this.options
  }

  public getSearch(): Search {
    return this.search
  }

  public getGroup(): Group {
    return this.group
  }

  public getArea(): Area {
    return this.area
  }

  public getBadge(): Badge {
    return this.badge
  }

  public getMagnifier(): Magnifier {
    return this.magnifier
  }

  public getHistoryManager(): HistoryManager {
    return this.historyManager
  }

  public getPosition(): Position {
    return this.position
  }

  public getZone(): Zone {
    return this.zone
  }

  public getRange(): RangeManager {
    return this.range
  }

  public getLineBreakParticle(): LineBreakParticle {
    return this.lineBreakParticle
  }

  public getTextParticle(): TextParticle {
    return this.textParticle
  }

  public getHeaderElementList(): IElement[] {
    return this.header.getElementList()
  }

  public getTableElementList(sourceElementList: IElement[]): IElement[] {
    const positionContext = this.position.getPositionContext()
    const { index, trIndex, tdIndex } = positionContext
    return (
      sourceElementList[index!].trList?.[trIndex!].tdList[tdIndex!].value || []
    )
  }

  public getElementList(): IElement[] {
    const positionContext = this.position.getPositionContext()
    const elementList = this.getOriginalElementList()
    return positionContext.isTable
      ? this.getTableElementList(elementList)
      : elementList
  }

  public getMainElementList(): IElement[] {
    const positionContext = this.position.getPositionContext()
    return positionContext.isTable
      ? this.getTableElementList(this.elementList)
      : this.elementList
  }

  public getOriginalElementList() {
    const zoneManager = this.getZone()
    if (zoneManager.isHeaderActive()) {
      return this.getHeaderElementList()
    }
    if (zoneManager.isFooterActive()) {
      return this.getFooterElementList()
    }
    return this.elementList
  }

  public getOriginalMainElementList(): IElement[] {
    return this.elementList
  }

  public getFooterElementList(): IElement[] {
    return this.footer.getElementList()
  }

  public getTd(): ITd | null {
    const positionContext = this.position.getPositionContext()
    const { index, trIndex, tdIndex, isTable } = positionContext
    if (isTable) {
      const elementList = this.getOriginalElementList()
      return elementList[index!].trList![trIndex!].tdList[tdIndex!]
    }
    return null
  }

  public insertElementList(
    payload: IElement[],
    options: IInsertElementListOption = {}
  ) {
    if (!payload.length || !this.range.getIsCanInput()) return
    const { startIndex, endIndex } = this.range.getRange()
    if (!~startIndex && !~endIndex) return
    const { isSubmitHistory = true } = options
    formatElementList(payload, {
      isHandleFirstElement: false,
      editorOptions: this.options
    })
    let curIndex = -1
    // 判断是否在控件内
    let activeControl = this.control.getActiveControl()
    // 光标在控件内如果当前没有被激活，需要手动激活
    if (!activeControl && this.control.getIsRangeWithinControl()) {
      this.control.initControl()
      activeControl = this.control.getActiveControl()
    }
    if (activeControl && this.control.getIsRangeWithinControl()) {
      curIndex = activeControl.setValue(payload, undefined, {
        isIgnoreDisabledRule: true
      })
      this.control.emitControlContentChange()
    } else {
      const elementList = this.getElementList()
      const isCollapsed = startIndex === endIndex
      const start = startIndex + 1
      if (!isCollapsed) {
        this.spliceElementList(elementList, start, endIndex - startIndex)
      }
      this.spliceElementList(elementList, start, 0, payload)
      curIndex = startIndex + payload.length
      // 列表前如有换行符则删除-因为列表内已存在
      const preElement = elementList[start - 1]
      if (
        payload[0].listId &&
        preElement &&
        !preElement.listId &&
        preElement?.value === ZERO &&
        (!preElement.type || preElement.type === ElementType.TEXT)
      ) {
        // PERF-PLAN §1.2：直接 splice 会绕开 mutation event 与 _dirtyRange，导致
        // 1) Phase 1.2 delta history 缺失这条改动→undo 时这个 ZERO 不会回来；
        // 2) Phase 2A dirty-page paint 不知道改动落在哪里→可能漏画。
        // 走 spliceElementList 让两条信号同时生效。
        this.spliceElementList(elementList, startIndex, 1)
        curIndex -= 1
      }
    }
    if (~curIndex) {
      this.range.setRange(curIndex, curIndex)
      this.render({
        curIndex,
        isSubmitHistory
      })
    }
  }

  public appendElementList(
    elementList: IElement[],
    options: IAppendElementListOption = {}
  ) {
    if (!elementList.length) return
    formatElementList(elementList, {
      isHandleFirstElement: false,
      editorOptions: this.options
    })
    let curIndex: number
    const { isPrepend, isSubmitHistory = true } = options
    // PERF-PLAN §1.2：走 spliceElementList 让 mutation event / _dirtyRange / delta
    // history 都能感知到这次插入，并复用 Phase 1.2 follow-up 的批量 splice 优化
    // （否则 push(...elementList) 在长列表上会 O(M × N) 累积。）
    if (isPrepend) {
      this.spliceElementList(this.elementList, 1, 0, elementList)
      curIndex = elementList.length
    } else {
      this.spliceElementList(
        this.elementList,
        this.elementList.length,
        0,
        elementList
      )
      curIndex = this.elementList.length - 1
    }
    this.range.setRange(curIndex, curIndex)
    this.render({
      curIndex,
      isSubmitHistory
    })
  }

  /**
   * 标记主元素列表的 dirty 区间（PERF-PLAN §2.1）。
   * - 多次标记会取并集（最小 start、最大 end）
   * - 仅作为渲染期 dirty-page 计算的提示；为 null 时按全量路径处理
   * - render() 完成后会被自动清空
   */
  public markDirty(start: number, end: number) {
    const lo = Math.max(0, Math.min(start, end))
    const hi = Math.max(start, end)
    if (this._dirtyRange === null) {
      this._dirtyRange = { start: lo, end: hi }
    } else {
      if (lo < this._dirtyRange.start) this._dirtyRange.start = lo
      if (hi > this._dirtyRange.end) this._dirtyRange.end = hi
    }
  }

  public getDirtyRange(): { start: number; end: number } | null {
    return this._dirtyRange
  }

  public clearDirtyRange() {
    this._dirtyRange = null
  }

  /**
   * 订阅 elementList 突变事件（PERF-PLAN §3.1）。
   *
   * 所有结构性变更最终都走 `spliceElementList`。订阅 `onMutation` 即可在
   * 不修改核心代码的前提下接入 CRDT runtime / 审计 / 远端同步等横切关注点。
   * 返回反订阅函数。
   */
  public onMutation(listener: MutationListener): () => void {
    this._mutationListeners.add(listener)
    return () => {
      this._mutationListeners.delete(listener)
    }
  }

  private _emitMutation(event: IMutationEvent) {
    if (this._mutationListeners.size === 0) return
    // 拷贝集合再迭代，避免回调中改 listener 集合引发问题
    for (const listener of Array.from(this._mutationListeners)) {
      try {
        listener(event)
      } catch {
        /* 订阅者异常不影响突变流程 */
      }
    }
  }

  public spliceElementList(
    elementList: IElement[],
    start: number,
    deleteCount: number,
    items?: IElement[],
    options?: ISpliceElementListOption
  ) {
    // 主列表 / 页眉 / 页脚分别维护 dirty 标志：render() 据此精确决定布局范围
    let scope: HistoryScope
    if (elementList === this.elementList) {
      scope = 'main'
      const insertedLen = items?.length ?? 0
      this.markDirty(start, start + Math.max(deleteCount, insertedLen))
    } else if (elementList === this.header.getElementList()) {
      scope = 'header'
      this._headerDirty = true
      this._headerChromeVersion++
    } else if (elementList === this.footer.getElementList()) {
      scope = 'footer'
      this._footerDirty = true
      this._footerChromeVersion++
    } else {
      scope = 'table'
      // PERF-PLAN §2.5 / Phase 2B：如果该 elementList 是某个 td.value（由上一次
      // computeRowList 在表格分支里挂上 _owningTd 反向引用），把那个 td 标 dirty。
      // 主体下次 computeRowList 抵达该单元格时会按 cacheKey + _dirty 决定是否
      // 复用 td.rowList。任何主体外的 elementList（自由文本、控件值等）都没有
      // _owningTd，本分支静默跳过。
      const owningTd = (
        elementList as unknown as { _owningTd?: { _dirty?: boolean } }
      )._owningTd
      if (owningTd) {
        owningTd._dirty = true
        // PERF-PLAN §2.5 follow-up：编辑表格单元格时 spliceElementList 的
        // 作用域是 'table'，因此不会自动标脏主元素列表。若该 td 所属的 TABLE
        // 元素在主列表中，就把主列表的 dirty 区间设为 TABLE 元素的索引位置，
        // 使下一帧 _tryBuildResumeFrom 能恢复增量布局——避免在 34 页文档的
        // 表格中每按一个键触发一次 ~1700 ms 的 full computeRowList。
        const tdMeta = owningTd as unknown as {
          _ownerElementIndex?: number
          _dirty?: boolean
        }
        const ownerIdx = tdMeta._ownerElementIndex
        if (
          ownerIdx !== undefined &&
          ownerIdx < this.elementList.length &&
          this.elementList[ownerIdx].type === ElementType.TABLE
        ) {
          this.markDirty(ownerIdx, ownerIdx + 1)
        }
      }
    }
    // PERF-PLAN §1.2 / Phase 1.2：除主列表以外的作用域无法走 delta 分支
    // （我们只为 main 维护逆向序列，HEADER/FOOTER/TABLE 的 elementList 引用
    // 在 setElementList 时会被替换；retroactive splice 不可靠）。
    if (scope !== 'main') {
      this._deltaHistoryUnsafe = true
    }
    // PERF-PLAN follow-up：维护 main 列表中 SURROUND 元素的计数缓存——
    // pickSurroundElementList 在 render() 每帧扫一次 O(N)，对于绝大多数没有
    // 浮动图片的文档完全是空载。spliceElementList 是主列表唯一的结构化变更
    // 入口，这里同步增减 counter，render 据此跳过整次扫描。null 表示「未计算」
    // —下一次 render 触发的 fast-path 检查会重建。
    if (scope === 'main' && this._mainSurroundCount !== null) {
      let delta = 0
      if (deleteCount > 0) {
        // removedSnapshot 还没建好，但元素仍在 elementList[start..start+deleteCount)。
        for (let i = 0; i < deleteCount; i++) {
          const el = elementList[start + i]
          if (el?.imgDisplay === ImageDisplay.SURROUND) delta--
        }
      }
      if (items?.length) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].imgDisplay === ImageDisplay.SURROUND) delta++
        }
      }
      this._mainSurroundCount = Math.max(0, this._mainSurroundCount + delta)
    }
    // 同样维护 area 计数缓存——area.compute 据此跳过整次扫描。
    if (scope === 'main' && this._mainAreaCount !== null) {
      let delta = 0
      if (deleteCount > 0) {
        for (let i = 0; i < deleteCount; i++) {
          const el = elementList[start + i]
          if (el?.areaId) delta--
        }
      }
      if (items?.length) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].areaId) delta++
        }
      }
      this._mainAreaCount = Math.max(0, this._mainAreaCount + delta)
    }
    // 事件订阅前先快照「将被删除」切片（splice 后无法访问）。
    // 内部的 delta-history 记录器同样需要这份快照，因此从此版本起即便没有
    // 外部 mutation 订阅者，只要存在 delete 也照常 slice。
    const removedSnapshot =
      deleteCount > 0 ? elementList.slice(start, start + deleteCount) : []
    const { isIgnoreDeletedRule = false } = options || {}
    const { group, modeRule } = this.options
    if (deleteCount > 0) {
      // 当最后元素与开始元素列表信息不一致时：清除当前列表信息
      const endIndex = start + deleteCount
      const endElement = elementList[endIndex]
      const endElementListId = endElement?.listId
      if (
        endElementListId &&
        elementList[start - 1]?.listId !== endElementListId
      ) {
        let startIndex = endIndex
        while (startIndex < elementList.length) {
          const curElement = elementList[startIndex]
          if (
            curElement.listId !== endElementListId ||
            curElement.value === ZERO
          ) {
            break
          }
          delete curElement.listId
          delete curElement.listType
          delete curElement.listStyle
          startIndex++
          // PERF-PLAN §1.2：本路径属于「splice 之外的旁路属性写入」——mutation
          // 事件无法描述。记入旁路改动后，submitHistory 会回退到 snapshot 分支。
          this._deltaHistoryUnsafe = true
        }
      }
      // 非明确忽略删除规则 && 非设计模式 && 非光标在控件内(控件内控制) =》 校验删除规则
      if (
        !isIgnoreDeletedRule &&
        !this.isDesignMode() &&
        !this.control.getIsRangeWithinControl()
      ) {
        const tdDeletable = this.getTd()?.deletable
        let deleteIndex = endIndex - 1
        let actuallyDeleted = 0
        while (deleteIndex >= start) {
          const deleteElement = elementList[deleteIndex]
          if (
            deleteElement?.hide ||
            deleteElement?.control?.hide ||
            deleteElement?.area?.hide ||
            (tdDeletable !== false &&
              deleteElement?.control?.deletable !== false &&
              (!deleteElement.controlId ||
                this.mode !== EditorMode.FORM ||
                !modeRule[this.mode].controlDeletableDisabled) &&
              deleteElement?.title?.deletable !== false &&
              (group.deletable !== false || !deleteElement.groupIds?.length) &&
              (deleteElement?.area?.deletable !== false ||
                deleteElement?.areaIndex !== 0))
          ) {
            elementList.splice(deleteIndex, 1)
            actuallyDeleted++
          }
          deleteIndex--
        }
        // PERF-PLAN §1.2：deletable 规则跳过了部分元素时 removed 切片不再对称
        // （它仍是 `[start, start+deleteCount)`，但部分元素其实没删）。delta 入栈
        // 时若按这份切片做逆操作会重新插入「保留下来的」元素，导致重复。
        // 因此只要保护规则真的吃掉了某个候选删除项，立即让本轮 fallback 到 snapshot。
        if (actuallyDeleted !== deleteCount) {
          this._deltaHistoryUnsafe = true
        }
      } else {
        elementList.splice(start, deleteCount)
      }
    }
    // PERF-PLAN follow-up：批量插入。从历史「逐项 splice 避免解构开销」改为单次
    // splice 大批插入。前者每次 splice 都是 O(N)，对于一条粘贴 M 个元素的命令
    // 总成本是 O(M × N)——pasting 长段落 10 次时观测到的滚雪球延迟正是出自这里。
    // 现在改为一次 splice 完成插入：单次 O(N + M)，同时仍保留 §6.2a 的 CRDT id
    // 填充。`splice(...items)` 的展开会受到 V8 函数参数上限（~65535）影响，因此
    // 巨型 paste 自动按 chunk 分次完成，避免 RangeError。
    if (items?.length) {
      // 1) §6.2a：先一遍循环把缺失的稳定 id 填好——每个元素一次属性写。
      for (let i = 0; i < items.length; i++) {
        if (!items[i].id) items[i].id = getUUID()
      }
      // 2) 一次（或几次）spread splice 完成结构性插入。
      const SPREAD_CHUNK = 32768
      if (items.length <= SPREAD_CHUNK) {
        elementList.splice(start, 0, ...items)
      } else {
        for (let off = 0; off < items.length; off += SPREAD_CHUNK) {
          const slice = items.slice(off, off + SPREAD_CHUNK)
          elementList.splice(start + off, 0, ...slice)
        }
      }
    }
    // PERF-PLAN §1.2 / §3.1：构造 splice 事件，既给 mutation 订阅者也给 history
    // delta 记录器使用。仅在 replay history（撤销/重做）期间不做记录，避免
    // 自相干循环（applyBackward 调用 splice 还原时会再次进来）。
    if (!this._isReplayingHistory) {
      const clonedRemoved = getSlimCloneElementList(removedSnapshot)
      const clonedInserted = items ? getSlimCloneElementList(items) : []
      const event: IMutationEvent = {
        kind: 'splice',
        scope,
        start,
        removed: clonedRemoved,
        inserted: clonedInserted
      }
      // 第一笔 mutation 入队前先锁住 BEFORE 状态——delta 入栈时携带，作为
      // applyBackward 的「目的地」元数据。
      if (
        scope === 'main' &&
        !this._deltaHistoryUnsafe &&
        this._pendingHistoryMutations.length === 0 &&
        this._preMutationMeta === null
      ) {
        this._preMutationMeta = {
          range: deepClone(this.range.getRange()),
          positionContext: deepClone(this.position.getPositionContext()),
          pageNo: this.pageNo,
          zone: this.zone.getZone()
        }
      }
      this._pendingHistoryMutations.push(event)
      // 通知 mutation 订阅者
      if (this._mutationListeners.size > 0) {
        this._emitMutation(event)
      }
    } else if (this._mutationListeners.size > 0) {
      const clonedRemoved = getSlimCloneElementList(removedSnapshot)
      const clonedInserted = items ? getSlimCloneElementList(items) : []
      this._emitMutation({
        kind: 'splice',
        scope,
        start,
        removed: clonedRemoved,
        inserted: clonedInserted
      })
    }
  }

  public getCanvasEvent(): CanvasEvent {
    return this.canvasEvent
  }

  public getGlobalEvent(): GlobalEvent {
    return this.globalEvent
  }

  public getListener(): Listener {
    return this.listener
  }

  public getEventBus(): EventBus<EventBusMap> {
    return this.eventBus
  }

  public getOverride(): Override {
    return this.override
  }

  public getCursor(): Cursor {
    return this.cursor
  }

  public getPreviewer(): Previewer {
    return this.previewer
  }

  public getImageParticle(): ImageParticle {
    return this.imageParticle
  }

  public getTableTool(): TableTool {
    return this.tableTool
  }

  public getTableOperate(): TableOperate {
    return this.tableOperate
  }

  public getTableParticle(): TableParticle {
    return this.tableParticle
  }

  public getBlockParticle(): BlockParticle {
    return this.blockParticle
  }

  public getHeader(): Header {
    return this.header
  }

  public getFooter(): Footer {
    return this.footer
  }

  public getHyperlinkParticle(): HyperlinkParticle {
    return this.hyperlinkParticle
  }

  public getDateParticle(): DateParticle {
    return this.dateParticle
  }

  public getListParticle(): ListParticle {
    return this.listParticle
  }

  public getCheckboxParticle(): CheckboxParticle {
    return this.checkboxParticle
  }

  public getRadioParticle(): RadioParticle {
    return this.radioParticle
  }

  public getControl(): Control {
    return this.control
  }

  public getWorkerManager(): WorkerManager {
    return this.workerManager
  }

  public getImageObserver(): ImageObserver {
    return this.imageObserver
  }

  public getI18n(): I18n {
    return this.i18n
  }

  public getGraffiti(): Graffiti {
    return this.graffiti
  }

  public getRowCount(): number {
    return this.getRowList().length
  }

  public async getDataURL(payload: IGetImageOption = {}): Promise<string[]> {
    const { pixelRatio, mode, snapDomFunction } = payload
    // 放大像素比
    if (pixelRatio) {
      this.setPagePixelRatio(pixelRatio)
    }
    // 不同模式
    const currentMode = this.mode
    const isSwitchMode = !!mode && currentMode !== mode
    if (isSwitchMode) {
      this.setMode(mode)
    }
    this.render({
      isLazy: false,
      isCompute: false,
      isSetCursor: false,
      isSubmitHistory: false
    })
    await this.imageObserver.allSettled()
    // 叠加iframe图片
    if (snapDomFunction) {
      await this.blockParticle.drawIframeToPage(this.pageList, snapDomFunction)
    }
    const dataUrlList = this.pageList.map(c => c.toDataURL())
    // 还原
    if (pixelRatio) {
      this.setPagePixelRatio(null)
    }
    if (isSwitchMode) {
      this.setMode(currentMode)
    }
    return dataUrlList
  }

  public getPainterStyle(): IElementStyle | null {
    return this.painterStyle && Object.keys(this.painterStyle).length
      ? this.painterStyle
      : null
  }

  public getPainterOptions(): IPainterOption | null {
    return this.painterOptions
  }

  public setPainterStyle(
    payload: IElementStyle | null,
    options?: IPainterOption
  ) {
    this.painterStyle = payload
    this.painterOptions = options || null
    if (this.getPainterStyle()) {
      this.pageList.forEach(c => (c.style.cursor = 'copy'))
    }
  }

  public setDefaultRange() {
    if (!this.elementList.length) return
    setTimeout(() => {
      const curIndex = this.elementList.length - 1
      this.range.setRange(curIndex, curIndex)
      this.range.setRangeStyle()
    })
  }

  public getIsPagingMode(): boolean {
    return this.options.pageMode === PageMode.PAGING
  }

  public setPageMode(payload: PageMode) {
    if (!payload || this.options.pageMode === payload) return
    this.options.pageMode = payload
    // 分页模式切换会重建整套 pageRowList / page signature；旧的 paint plan 不可复用。
    this._invalidatePaintCache()
    // 纸张大小重置
    if (payload === PageMode.PAGING) {
      const { height } = this.options
      const dpr = this.getPagePixelRatio()
      const canvas = this.pageList[0]
      canvas.style.height = `${height}px`
      canvas.height = height * dpr
      // canvas尺寸发生变化，上下文被重置
      this._initPageContext(this.ctxList[0])
    } else {
      // 连页模式：移除懒加载监听&清空页眉页脚计算数据
      this._disconnectLazyRender()
      this.header.recovery()
      this.footer.recovery()
      this.zone.setZone(EditorZone.MAIN)
    }
    const { startIndex } = this.range.getRange()
    const isCollapsed = this.range.getIsCollapsed()
    this.render({
      isSetCursor: true,
      curIndex: startIndex,
      isSubmitHistory: false
    })
    // 重新定位避免事件监听丢失
    if (!isCollapsed) {
      this.cursor.drawCursor({
        isShow: false
      })
    }
    // 回调
    setTimeout(() => {
      if (this.listener.pageModeChange) {
        this.listener.pageModeChange(payload)
      }
      if (this.eventBus.isSubscribe('pageModeChange')) {
        this.eventBus.emit('pageModeChange', payload)
      }
    })
  }

  public setPageScale(payload: number) {
    const oldScale = this.options.scale
    // Decide whether the scale-only fast path applies. computeRowList over
    // the entire document is the dominant cost on large docs (25-page +)
    // when only `scale` changed — wrapping decisions are essentially
    // scale-invariant in this renderer because measureText is cached
    // against unscaled fonts (TextParticle.measureText sets `ctx.font` via
    // `getElementFont(element)` with the default scale=1) and widths are
    // multiplied by `scale` only at the use site. We therefore can scale
    // the existing rowList / element.metrics / table caches in-place and
    // let the cheap O(N) arithmetic dependents (pageRowList, positionList,
    // area, search highlights) re-derive from the scaled rowList.
    const ratio = oldScale > 0 ? payload / oldScale : 0
    const canFastPath =
      payload !== oldScale &&
      Number.isFinite(ratio) &&
      ratio > 0 &&
      this.rowList.length > 0 &&
      this._dirtyRange === null &&
      this._prevPageRowCounts !== null &&
      !this.isPrintMode()
    const dpr = this.getPagePixelRatio()
    this.options.scale = payload
    const width = this.getWidth()
    const height = this.getHeight()
    this.container.style.width = `${width}px`
    for (let i = 0; i < this.pageList.length; i++) {
      this._resizePageBacking(i, width, height, dpr)
    }
    if (canFastPath) {
      this._scaleLayoutInPlace(this.rowList, ratio, payload)
      // Row checkpoints carry scale-dependent carry state (x / y /
      // controlRealWidth — see ILayoutCheckpoint). Scaling them in place
      // matches what the in-place rowList scaling did, so the next typing
      // event can still resume incremental layout from the appropriate
      // prefix and stays fast (PERF-PLAN §2.2). Without this, the first
      // keystroke after a fit-to-X click would pay a full computeRowList
      // on the entire document while incremental rebuilt its checkpoints.
      this._scaleCheckpointsInPlace(this._mainRowCheckpoints, ratio)
      // Canvas backing stores were just resized → all bitmaps cleared.
      this._drawnPages.clear()
      this._skipMainRowCompute = true
    }
    const cursorPosition = this.position.getCursorPosition()
    try {
      this.render({
        isSubmitHistory: false,
        isSetCursor: !!cursorPosition,
        curIndex: cursorPosition?.index
      })
    } finally {
      this._skipMainRowCompute = false
    }
    if (this.listener.pageScaleChange) {
      this.listener.pageScaleChange(payload)
    }
    if (this.eventBus.isSubscribe('pageScaleChange')) {
      this.eventBus.emit('pageScaleChange', payload)
    }
  }

  /**
   * Apply a uniform scale ratio to a rowList (and any nested table
   * rowLists) in place, without re-running computeRowList. Used by
   * {@link setPageScale} as the scale-only fast path.
   *
   * Why this is correct: every scale-dependent geometry value in this
   * renderer is computed as `unscaled * options.scale`, and measureText
   * is cached against the unscaled font (see Draw.ts:2564 / 2582 — the
   * default `getElementFont(el)` argument is scale=1; line widths are
   * multiplied by `scale` only at the use site, e.g. lines 2541, 2553,
   * 2567, 2584). Therefore a uniform multiply of every cached pixel
   * value reproduces what computeRowList would have produced at the new
   * scale, modulo sub-pixel rounding noise that's already below the
   * detection threshold of the existing layout invariants.
   *
   * Touches:
   *  - row.{width,height,ascent,offsetX,offsetY,innerWidth,pageStartX,pageStartY}
   *  - row.elementList[*].metrics — the per-element pixel dimensions
   *    drawn by drawRow / TextParticle / ImageParticle / etc.
   *  - row.elementList[*].style — the canvas font string (`getElementFont`
   *    with the new scale baked in) used at draw time
   *  - row.elementList[*].left — manual left offset, scale-dependent
   *  - For TABLE elements: recurse into td.rowList (per-cell layouts)
   *    and refresh td._cacheScale / td._cacheInnerWidth so the next
   *    full computeRowList pass can reuse the cell.
   *
   * Does NOT touch: tr.height / td.{width,height} — those are stored
   * in *unscaled* units in this codebase (line 2282 multiplies td.width
   * by scale at use; lines 2267, 2409 likewise for tr.height).
   */
  /**
   * Scale a parallel-indexed checkpoint sink by `ratio` in place. Pairs
   * with {@link _scaleLayoutInPlace} for the scale-only fast path: row
   * checkpoints capture the loop carry state (x / y / controlRealWidth)
   * at row boundaries, all of which are scale-dependent. Scaling them
   * keeps incremental layout viable on the next render — without this,
   * the first keystroke after a fit-to-X would resume against stale
   * pre-scale x / y values, fail the layout-sig compatibility check,
   * and fall back to full computeRowList over the whole document.
   *
   * Other fields (pageNo / listId / listIndex / currentPageColumns /
   * surroundElementList element refs) are scale-invariant; the element
   * references inside surroundElementList still point at the same IElement
   * objects whose metrics were already scaled by _scaleLayoutInPlace.
   */
  private _scaleCheckpointsInPlace(
    checkpoints: ILayoutCheckpoint[],
    ratio: number
  ) {
    for (let i = 0; i < checkpoints.length; i++) {
      const ckpt = checkpoints[i]
      ckpt.x *= ratio
      ckpt.y *= ratio
      ckpt.controlRealWidth *= ratio
    }
  }

  private _scaleLayoutInPlace(
    rowList: IRow[],
    ratio: number,
    newScale: number
  ) {
    for (let r = 0; r < rowList.length; r++) {
      const row = rowList[r]
      row.width *= ratio
      row.height *= ratio
      row.ascent *= ratio
      if (row.offsetX !== undefined) row.offsetX *= ratio
      if (row.offsetY !== undefined) row.offsetY *= ratio
      if (row.innerWidth !== undefined) row.innerWidth *= ratio
      if (row.pageStartX !== undefined) row.pageStartX *= ratio
      if (row.pageStartY !== undefined) row.pageStartY *= ratio
      const elementList = row.elementList
      for (let e = 0; e < elementList.length; e++) {
        const el = elementList[e]
        const m = el.metrics
        if (m) {
          m.width *= ratio
          m.height *= ratio
          m.boundingBoxAscent *= ratio
          m.boundingBoxDescent *= ratio
        }
        if (el.left !== undefined) el.left *= ratio
        // The drawn font string has the (old) scale baked in via
        // getElementFont(el, oldScale). Refresh it for the new scale.
        el.style = this.getElementFont(el, newScale)
        if (el.type === ElementType.TABLE && el.trList) {
          for (let t = 0; t < el.trList.length; t++) {
            const tr = el.trList[t]
            for (let d = 0; d < tr.tdList.length; d++) {
              const td = tr.tdList[d]
              if (td.rowList) {
                this._scaleLayoutInPlace(td.rowList, ratio, newScale)
              }
              // Keep the per-cell cache key consistent with the new scale
              // so the next full computeRowList pass can reuse this td
              // (canReuseCell at Draw.ts:2284 requires _cacheScale ===
              // current scale).
              if (td._cacheScale !== undefined) {
                td._cacheScale = newScale
                if (td._cacheInnerWidth !== undefined) {
                  td._cacheInnerWidth *= ratio
                }
              }
            }
          }
        }
      }
    }
  }

  public getPagePixelRatio(): number {
    return this.pagePixelRatio || window.devicePixelRatio
  }

  public setPagePixelRatio(payload: number | null) {
    if (
      (!this.pagePixelRatio && payload === window.devicePixelRatio) ||
      payload === this.pagePixelRatio
    ) {
      return
    }
    this.pagePixelRatio = payload
    this.setPageDevicePixel()
  }

  public setPageDevicePixel() {
    const dpr = this.getPagePixelRatio()
    const width = this.getWidth()
    const height = this.getHeight()
    for (let i = 0; i < this.pageList.length; i++) {
      this._resizePageBacking(i, width, height, dpr)
    }
    this.render({
      isSubmitHistory: false,
      isSetCursor: false
    })
  }

  public setPaperSize(width: number, height: number) {
    this.options.width = width
    this.options.height = height
    const dpr = this.getPagePixelRatio()
    const realWidth = this.getWidth()
    const realHeight = this.getHeight()
    this.container.style.width = `${realWidth}px`
    for (let i = 0; i < this.pageList.length; i++) {
      this._resizePageBacking(i, realWidth, realHeight, dpr)
    }
    this.render({
      isSubmitHistory: false,
      isSetCursor: false
    })
  }

  public setPaperDirection(payload: PaperDirection) {
    const dpr = this.getPagePixelRatio()
    this.options.paperDirection = payload
    const width = this.getWidth()
    const height = this.getHeight()
    this.container.style.width = `${width}px`
    for (let i = 0; i < this.pageList.length; i++) {
      this._resizePageBacking(i, width, height, dpr)
    }
    this.render({
      isSubmitHistory: false,
      isSetCursor: false
    })
  }

  public setPaperMargin(payload: IMargin) {
    this.options.margins = payload
    this.render({
      isSubmitHistory: false,
      isSetCursor: false
    })
  }

  public getOriginValue(
    options: IGetOriginValueOption = {}
  ): Required<IEditorData> {
    const { pageNo } = options
    let mainElementList = this.elementList
    if (
      Number.isInteger(pageNo) &&
      pageNo! >= 0 &&
      pageNo! < this.pageRowList.length
    ) {
      mainElementList = this.pageRowList[pageNo!].flatMap(
        row => row.elementList
      )
    }
    // 同步block的最新数据
    this.blockParticle.update()
    const data: Required<IEditorData> = {
      header: this.getHeaderElementList(),
      main: mainElementList,
      footer: this.getFooterElementList(),
      graffiti: this.graffiti.getValue()
    }
    return data
  }

  public getValue(options: IGetValueOption = {}): IEditorResult {
    const originData = this.getOriginValue(options)
    const { extraPickAttrs } = options
    const data: IEditorData = {
      header: zipElementList(originData.header, {
        extraPickAttrs
      }),
      main: zipElementList(originData.main, {
        extraPickAttrs,
        isClassifyArea: true
      }),
      footer: zipElementList(originData.footer, {
        extraPickAttrs
      }),
      graffiti: originData.graffiti
    }
    return {
      version,
      data,
      options: deepClone(this.options)
    }
  }

  public setValue(payload: Partial<IEditorData>, options?: ISetValueOption) {
    const { header, main, footer } = deepClone(payload)
    if (!header && !main && !footer) return
    const { isSetCursor = false } = options || {}
    const pageComponentData = [header, main, footer]
    pageComponentData.forEach(data => {
      if (!data) return
      formatElementList(data, {
        editorOptions: this.options,
        isForceCompensation: true
      })
    })
    this.setEditorData({
      header,
      main,
      footer
    })
    // 渲染&计算&清空历史记录
    this.historyManager.recovery()
    const curIndex = isSetCursor
      ? main?.length
        ? main.length - 1
        : 0
      : undefined
    if (curIndex !== undefined) {
      this.range.setRange(curIndex, curIndex)
    }
    this.render({
      curIndex,
      isSetCursor,
      isFirstRender: true
    })
  }

  public setEditorData(payload: Partial<Omit<IEditorData, 'graffiti'>>) {
    const { header, main, footer } = payload
    if (header) {
      this.header.setElementList(header)
    }
    if (main) {
      this.elementList = main
    }
    if (footer) {
      this.footer.setElementList(footer)
    }
    // 整体替换文档：dirty page 缓存与已绘制集合一并失效，下一次 render 强制全量重绘
    this._invalidatePaintCache()
  }

  /**
   * 失效化 dirty-page paint 缓存（PERF-PLAN §2.4）。在 setEditorData / 大批量
   * 替换文档等无法用 dirty-range 描述的场景由调用方触发。
   */
  public invalidatePaintCache() {
    this._invalidatePaintCache()
  }

  private _invalidatePaintCache() {
    this._prevPageRowCounts = null
    this._prevPageLayoutSignatures = null
    this._drawnPages.clear()
    this._decorationDrawnPages.clear()
    this.chromeCacheKeyList = this.chromeCacheKeyList.map(() => null)
    this._dirtyRange = null
    this._headerDirty = false
    this._footerDirty = false
    // Phase 2B：增量布局所依赖的 row checkpoint 也一并失效，避免 setEditorData
    // 等大批量替换文档后还沿用上一份文档的恢复点（PERF-PLAN §2.2）。
    this._mainRowCheckpoints = []
    this._mainLayoutSig = null
    // PERF-PLAN §1.2 / Phase 1.2：累积的 delta mutation 也作废——setEditorData 之后
    // 旧的 mutations 引用着已失效的 elementList 索引，replay 会产生灾难性的越界。
    this._pendingHistoryMutations = []
    this._deltaHistoryUnsafe = true
    this._preMutationMeta = null
    // surround / area 计数缓存需要重建：新文档可能含/不含这些特殊元素。
    this._mainSurroundCount = null
    this._mainAreaCount = null
  }

  /**
   * PERF-PLAN §2.2 / Phase 2B：构建本帧的「布局输入签名」。
   *
   * 任何会让任意一行的几何形状（width / height / x / y / page break 时机）改变的
   * 选项必须列入。签名变了 → 上一帧的 _mainRowCheckpoints 不再可信，必须全量。
   */
  private _buildLayoutSig(extra: {
    isPagingMode: boolean
    innerWidth: number
  }) {
    const { scale, defaultSize, defaultRowMargin, defaultTabWidth } =
      this.options
    return {
      scale,
      innerWidth: extra.innerWidth,
      isPagingMode: extra.isPagingMode,
      defaultSize,
      defaultRowMargin,
      defaultTabWidth
    }
  }

  private _isLayoutSigCompatible(extra: {
    isPagingMode: boolean
    innerWidth: number
  }): boolean {
    if (!this._mainLayoutSig) return false
    const cur = this._buildLayoutSig(extra)
    const old = this._mainLayoutSig
    return (
      cur.scale === old.scale &&
      cur.innerWidth === old.innerWidth &&
      cur.isPagingMode === old.isPagingMode &&
      cur.defaultSize === old.defaultSize &&
      cur.defaultRowMargin === old.defaultRowMargin &&
      cur.defaultTabWidth === old.defaultTabWidth
    )
  }

  /**
   * PERF-PLAN §2.2 / Phase 2B：根据 _dirtyRange 找出 dirty 起点所在的行，
   * 并构建一个 IComputeRowListResumePayload 指示 computeRowList 从哪里继续。
   *
   * 返回 null 表示「不要走增量分支」——调用方应回落到全量布局。安全条件：
   *  1) 上一帧已经至少跑过一次主体布局（_mainRowCheckpoints / rowList 非空）。
   *  2) _dirtyRange 已被显式标记。
   *  3) 布局签名（scale / innerWidth / pagingMode / defaultSize / ...）与上一帧一致。
   *  4) dirty 起点之前至少存在一个完整的、未受影响的行可以保留——dirty 落在
   *     第一行时（R = 0）回退到全量；前缀长度 0 没有省下任何工作。
   *  5) 所有 prefix 行的元素引用必须仍可信（即没有 setEditorData / 跨文档替换）。
   *     由 _invalidatePaintCache() 在那些路径上同步失效 _mainRowCheckpoints 来保证。
   */
  private _tryBuildResumeFrom(extra: {
    isPagingMode: boolean
    innerWidth: number
  }): {
    startElementIndex: number
    prefixRowList: IRow[]
    checkpoint: ILayoutCheckpoint
    convergenceTarget: IConvergenceTarget
  } | null {
    if (!this._dirtyRange) return null
    if (!this._mainRowCheckpoints.length) return null
    if (this.rowList.length <= 1) return null
    if (this._mainRowCheckpoints.length !== this.rowList.length) return null
    if (!this._isLayoutSigCompatible(extra)) return null
    const dirtyStart = this._dirtyRange.start
    // 二分查找第一个 startIndex > dirtyStart 的行，O(log R) 替代 O(R)。
    // rowList 的 startIndex 单调非递减——同一 startIndex 出现多次时取最后一个，
    // 即「最大的 i 使得 rowList[i].startIndex <= dirtyStart」。
    let lo = 0
    let hi = this.rowList.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.rowList[mid].startIndex > dirtyStart) {
        hi = mid
      } else {
        lo = mid + 1
      }
    }
    // lo 现在指向第一个 startIndex > dirtyStart 的行；前一行包含 dirtyStart。
    const dirtyRowIndex = lo - 1
    if (dirtyRowIndex <= 0) return null
    const prefixRowList = this.rowList.slice(0, dirtyRowIndex)
    const checkpoint = this._mainRowCheckpoints[dirtyRowIndex]
    if (!checkpoint) return null
    // dirty 行的第一个元素索引：从该行开始重排
    const startElementIndex = this.rowList[dirtyRowIndex].startIndex
    // 收敛目标：从 dirty 行起的旧行序列 + 对应 checkpoint。computeRowList 跑到
    // 与某个旧行完全一致时立即停止；调用方把剩余旧行（适当位移后）接到尾部。
    // 仅当 _dirtyRange 存在时构造（_tryBuildResumeFrom 上方已断言非空）。
    const convergenceTarget: IConvergenceTarget = {
      oldRowsAfterCut: this.rowList.slice(dirtyRowIndex),
      oldCheckpointsAfterCut: this._mainRowCheckpoints.slice(dirtyRowIndex),
      dirtyEndAbs: this._dirtyRange!.end,
      matched: null
    }
    return {
      startElementIndex,
      prefixRowList,
      checkpoint,
      convergenceTarget
    }
  }

  /**
   * PERF-PLAN §2.2 / Phase 2B：是否启用增量布局校验桩。
   *
   * 通过 editorOption 上的 `__perfValidateLayout` 隐藏字段开启——非生产路径，
   * 仅用于本地 / CI 回归确认增量分支与全量分支输出字节相等。开启时每帧多跑
   * 一次完整布局，性能直接腰斩，请勿用于真实场景。
   */
  private _isPerfValidateLayoutEnabled(): boolean {
    const sentinel = (this.options as unknown as Record<string, unknown>)
      .__perfValidateLayout
    return sentinel === true
  }

  /**
   * 是否启用渲染阶段计时日志（PERF-PLAN follow-up）。
   *
   * 通过 editorOption 上的 `__perfTraceRender` 隐藏字段开启——给用户一个
   * 显式工具看到「这一帧 layout / paint / area / submitHistory 各花了多少
   * ms」，便于诊断剩余卡顿来源。仅供 dev 使用，开启时会向 console 打印
   * 一条 group。生产路径请保持关闭。
   */
  private _isPerfTraceRenderEnabled(): boolean {
    const sentinel = (this.options as unknown as Record<string, unknown>)
      .__perfTraceRender
    return sentinel === true
  }

  /**
   * 构造一个一次性的渲染阶段计时器（PERF-PLAN follow-up）。
   *
   * 用法：在 render() 入口构造一次（仅 __perfTraceRender 启用时），在每个
   * 关键阶段调用 mark('label')，最后 flush() 把所有 phase 时间打印到
   * console。便于用户在自己的内容上看到「这一帧 layout / paint / area /
   * submitHistory 各占多少 ms」，定位剩余卡顿来源。
   */
  private _createRenderTrace() {
    const t0 =
      typeof performance !== 'undefined' ? performance.now() : Date.now()
    let last = t0
    const phases: { label: string; ms: number }[] = []
    const now = () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now()
    return {
      mark: (label: string) => {
        const cur = now()
        phases.push({ label, ms: +(cur - last).toFixed(2) })
        last = cur
      },
      flush: () => {
        const total = +(now() - t0).toFixed(2)
        console.log(
          `[PerfTrace] render #${this.renderCount} total=${total}ms`,
          phases.map(p => `${p.label}=${p.ms}ms`).join('  '),
          phases
        )
      }
    }
  }

  /**
   * PERF-PLAN §2.2 / Phase 2B：把当前 this.rowList（增量结果）与一遍全量
   * computeRowList 的输出按行 diff，不一致时 `console.error`。仅在
   * _isPerfValidateLayoutEnabled() 为真时调用。
   */
  private _validateIncrementalLayout(payload: IComputeRowListPayload) {
    // 全量重新跑一遍——独立 surroundElementList / 不写 sink，避免污染主路径
    const fullRowList = this.computeRowList({
      ...payload,
      surroundElementList: payload.surroundElementList?.slice() ?? [],
      checkpointSink: undefined,
      resumeFrom: undefined
    })
    const inc = this.rowList
    if (fullRowList.length !== inc.length) {
      console.error(
        `[Phase2B/validate] row count mismatch: full=${fullRowList.length} incremental=${inc.length}`
      )
      return
    }
    for (let r = 0; r < fullRowList.length; r++) {
      const a = fullRowList[r]
      const b = inc[r]
      if (
        a.startIndex !== b.startIndex ||
        a.elementList.length !== b.elementList.length ||
        Math.abs(a.width - b.width) > 0.01 ||
        Math.abs(a.height - b.height) > 0.01 ||
        a.rowIndex !== b.rowIndex ||
        !!a.isPageBreak !== !!b.isPageBreak ||
        !!a.isColumnBreak !== !!b.isColumnBreak
      ) {
        console.error(`[Phase2B/validate] row ${r} mismatch`, {
          full: a,
          incremental: b
        })
        return
      }
    }
  }

  private _wrapContainer(rootContainer: HTMLElement): HTMLDivElement {
    const container = document.createElement('div')
    rootContainer.append(container)
    return container
  }

  private _formatContainer() {
    // 容器宽度需跟随纸张宽度
    this.container.style.position = 'relative'
    this.container.style.width = `${this.getWidth()}px`
    this.container.setAttribute(EDITOR_COMPONENT, EditorComponent.MAIN)
  }

  private _createPageContainer(): HTMLDivElement {
    const pageContainer = document.createElement('div')
    pageContainer.classList.add(`${EDITOR_PREFIX}-page-container`)
    this.container.append(pageContainer)
    return pageContainer
  }

  // 复用一个测量画布上下文（避免 computeRowList 每次创建 canvas）。
  // 仅用于 measureText/list-style 等纯测量操作；font/baseline 等状态会被
  // 各调用方在使用前显式覆盖，无需重置。
  private _getMeasureCtx(): CanvasRenderingContext2D {
    if (!this._measureCtx) {
      this._measureCanvas = document.createElement('canvas')
      this._measureCtx = this._measureCanvas.getContext(
        '2d'
      ) as CanvasRenderingContext2D
    }
    return this._measureCtx
  }

  private _createPage(pageNo: number) {
    const width = this.getWidth()
    const height = this.getHeight()
    const dpr = this.getPagePixelRatio()
    const isLayered = this._isPageLayered()

    // base canvas——getPageList() 仍然返回这个 canvas，对外行为不变。
    const base = document.createElement('canvas')
    base.style.width = `${width}px`
    base.style.height = `${height}px`
    base.style.display = 'block'
    base.style.backgroundColor = '#ffffff'
    base.style.cursor = 'text'
    base.setAttribute('data-index', String(pageNo))
    base.width = width * dpr
    base.height = height * dpr
    const ctx = base.getContext('2d')!
    this._initPageContext(ctx)
    const chromeCache = document.createElement('canvas')
    chromeCache.width = width * dpr
    chromeCache.height = height * dpr
    const chromeCacheCtx = chromeCache.getContext('2d')!
    this._initPageContext(chromeCacheCtx)

    if (isLayered) {
      // wrapper 是 pageContainer 的直接子节点——继承原 base canvas 在 flex/block
      // 流中的位置（间距由 wrapper 的 marginBottom 提供）；base + decoration 都
      // 用 absolute 位于 wrapper 内部叠放。
      const wrapper = document.createElement('div')
      wrapper.classList.add(`${EDITOR_PREFIX}-page-wrapper`)
      // wrapper 同样不带 data-index——避免外部 `[data-index]` 查询双计数。
      // 唯一带 data-index 的是 base canvas（line 2206）——保留事件命中和
      // 索引语义不变。
      wrapper.style.position = 'relative'
      wrapper.style.width = `${width}px`
      wrapper.style.height = `${height}px`
      wrapper.style.display = 'block'
      wrapper.style.marginBottom = `${this.getPageGap()}px`
      base.classList.add(`${EDITOR_PREFIX}-page-base`)
      base.style.position = 'absolute'
      base.style.left = '0'
      base.style.top = '0'
      base.style.marginBottom = '0'
      wrapper.appendChild(base)

      const decoration = document.createElement('canvas')
      decoration.classList.add(`${EDITOR_PREFIX}-page-decoration`)
      // 注意：装饰层不带 data-index——很多外部代码（如 JATS canvas-inspect-overlay）
      // 用 `canvas[data-index]` 计数页数；如果装饰层也带 data-index，会双计数→
      // 「1 页文档被识别为 2 页」。仅 base canvas 需要 data-index（事件命中、
      // IntersectionObserver target、demo 中的 page 索引）。
      decoration.style.position = 'absolute'
      decoration.style.left = '0'
      decoration.style.top = '0'
      decoration.style.width = `${width}px`
      decoration.style.height = `${height}px`
      decoration.style.pointerEvents = 'none'
      decoration.width = width * dpr
      decoration.height = height * dpr
      const decoCtx = decoration.getContext('2d')!
      this._initPageContext(decoCtx)
      wrapper.appendChild(decoration)

      this.pageContainer.append(wrapper)
      this.pageWrapperList.push(wrapper)
      this.decorationCanvasList.push(decoration)
      this.decorationCtxList.push(decoCtx)
    } else {
      // 单层 fallback——保留旧 DOM 结构。decoration 数组条目 alias base，paint
      // 代码无差别地写到一个 ctx。
      base.style.marginBottom = `${this.getPageGap()}px`
      this.pageContainer.append(base)
      this.pageWrapperList.push(base as unknown as HTMLDivElement)
      this.decorationCanvasList.push(base)
      this.decorationCtxList.push(ctx)
    }
    this.pageList.push(base)
    this.ctxList.push(ctx)
    this.chromeCacheCanvasList.push(chromeCache)
    this.chromeCacheCtxList.push(chromeCacheCtx)
    this.chromeCacheKeyList.push(null)
  }

  /**
   * 是否启用分层 canvas。
   *   - options.pageLayered.enable=true（默认）→ 每页 wrapper + base + decoration
   *   - 否则单层 base canvas（旧行为，零回归）
   */
  private _isPageLayered(): boolean {
    return this.options.pageLayered.enable === true
  }

  /** 拿到第 pageNo 页的 decoration ctx；分层关时与 base ctx 同一个。 */
  public getDecorationCtx(pageNo: number): CanvasRenderingContext2D {
    return this.decorationCtxList[pageNo] ?? this.ctxList[pageNo]
  }

  /**
   * 同步重设第 pageNo 页的 base + decoration + wrapper 的物理尺寸 / DPR。
   * setPageScale / setPaperSize / setPaperDirection / setPageDevicePixel 共用——
   * 替换原来散落在各 setter 里的 `pageList.forEach((p, i) => { p.width = ... })`
   * 块，确保两层 canvas 永远不会出现尺寸漂移（否则 decoration 上的选区矩形会
   * 偏离 base 上的文字）。
   */
  private _resizePageBacking(
    pageNo: number,
    w: number,
    h: number,
    dpr: number
  ) {
    const base = this.pageList[pageNo]
    base.width = w * dpr
    base.height = h * dpr
    base.style.width = `${w}px`
    base.style.height = `${h}px`
    this._initPageContext(this.ctxList[pageNo])
    const wrapper = this.pageWrapperList[pageNo]
    if (wrapper && wrapper !== (base as unknown as HTMLDivElement)) {
      wrapper.style.width = `${w}px`
      wrapper.style.height = `${h}px`
      wrapper.style.marginBottom = `${this.getPageGap()}px`
      // 分层模式下 base 的 marginBottom 由 wrapper 提供——保留 base 自身为 0
      base.style.marginBottom = '0'
    } else {
      // 单层模式，间距挂在 base 自己身上（与旧行为一致）
      base.style.marginBottom = `${this.getPageGap()}px`
    }
    const deco = this.decorationCanvasList[pageNo]
    if (deco && deco !== base) {
      deco.width = w * dpr
      deco.height = h * dpr
      deco.style.width = `${w}px`
      deco.style.height = `${h}px`
      this._initPageContext(this.decorationCtxList[pageNo])
    }
    const chromeCache = this.chromeCacheCanvasList[pageNo]
    if (chromeCache) {
      chromeCache.width = w * dpr
      chromeCache.height = h * dpr
      this._initPageContext(this.chromeCacheCtxList[pageNo])
      this.chromeCacheKeyList[pageNo] = null
    }
  }

  private _initPageContext(ctx: CanvasRenderingContext2D) {
    const dpr = this.getPagePixelRatio()
    ctx.scale(dpr, dpr)
    // 重置以下属性是因部分浏览器(chrome)会应用css样式
    ctx.letterSpacing = '0px'
    ctx.wordSpacing = '0px'
    ctx.direction = 'ltr'
  }

  public getElementFont(el: IElement, scale = 1): string {
    const { defaultSize, defaultFont } = this.options
    const font = el.font || defaultFont
    const size = el.actualSize || el.size || defaultSize
    return `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${
      size * scale
    }px ${font}`
  }

  public getElementSize(el: IElement) {
    return el.actualSize || el.size || this.options.defaultSize
  }

  public getElementRowMargin(el: IElement) {
    const { defaultSize, defaultRowMargin, scale } = this.options
    const fontSize = this.getElementSize(el) || defaultSize
    const lineHeight = el.rowMargin ?? defaultRowMargin
    const extraLineHeight = Math.max(0, lineHeight - 1) * fontSize
    return (extraLineHeight / 2) * scale
  }

  public computeRowList(payload: IComputeRowListPayload) {
    const {
      innerWidth,
      elementList,
      isPagingMode = false,
      isFromTable = false,
      startX = 0,
      startY = 0,
      pageHeight = 0,
      mainOuterHeight = 0,
      checkpointSink,
      resumeFrom
    } = payload
    // surroundElementList 在循环里会就地裁剪（deleteSurroundElementList），
    // 因此在 resumeFrom 路径下不能继续沿用调用方传入的引用——
    // 必须从 checkpoint 快照恢复一份独立拷贝。
    let surroundElementList = payload.surroundElementList ?? []
    const {
      defaultSize,
      scale,
      imgCaption,
      table: { tdPadding },
      defaultTabWidth
    } = this.options
    const defaultBasicRowMarginHeight = this.getDefaultBasicRowMarginHeight()
    const ctx = this._getMeasureCtx()
    // 计算列表偏移宽度
    const listStyleMap = this.listParticle.computeListStyle(ctx, elementList)
    let rowList: IRow[]
    let currentPageColumns: Required<IPageColumns>
    let x: number
    let y: number
    let pageNo: number
    let listId: string | undefined
    let listIndex: number
    let controlRealWidth: number
    let i: number

    if (resumeFrom) {
      // PERF-PLAN §2.2 / Phase 2B：从已捕获的 checkpoint 恢复布局。
      // 跳过 prefix 元素的 measureText / 包装判定 / surround 计算等 O(N) 工作，
      // 直接在 dirty range 起点之前的「最近一行边界」继续。
      rowList = resumeFrom.prefixRowList.slice()
      const ckpt = resumeFrom.checkpoint
      x = ckpt.x
      y = ckpt.y
      pageNo = ckpt.pageNo
      listId = ckpt.listId
      listIndex = ckpt.listIndex
      controlRealWidth = ckpt.controlRealWidth
      currentPageColumns = ckpt.currentPageColumns
      // surround 列表使用 checkpoint 快照的副本——后续循环里 deleteSurroundElementList
      // 会就地裁剪，不能直接绑回原数组。
      surroundElementList = ckpt.surroundElementList.slice()
      i = resumeFrom.startElementIndex
      if (checkpointSink) {
        // checkpointSink 与 rowList 平行索引——保留 prefix 部分，截断尾部，
        // 后续循环按 push 时机继续追加。
        if (checkpointSink.length > rowList.length) {
          checkpointSink.length = rowList.length
        }
      }
    } else {
      rowList = []
      currentPageColumns = this.normalizePageColumns(
        isFromTable
          ? { columnCount: 1, columnGap: 0 }
          : elementList[0]?.pageColumns
      )
      if (elementList.length) {
        rowList.push({
          width: 0,
          height: 0,
          ascent: 0,
          elementList: [],
          startIndex: 0,
          rowIndex: 0,
          rowFlex: elementList?.[0]?.rowFlex || elementList?.[1]?.rowFlex,
          pageColumns: currentPageColumns,
          innerWidth: this.getColumnInnerWidth(currentPageColumns)
        })
      }
      // 起始位置及页码计算
      x = startX
      y = startY
      pageNo = 0
      // 列表位置
      listId = undefined
      listIndex = 0
      // 控件最小宽度
      controlRealWidth = 0
      i = 0
      // 种子行 checkpoint：等价于「未进入 i=0 之前」的循环局部状态。
      // 注意：必须在 `i = 0` / `pageNo = 0` 等本地变量初始化之后捕获，确保数值一致。
      if (checkpointSink) {
        checkpointSink.length = 0
        if (rowList.length) {
          checkpointSink.push({
            x,
            y,
            pageNo,
            listId,
            listIndex,
            controlRealWidth,
            currentPageColumns,
            surroundElementList: surroundElementList.length
              ? surroundElementList.slice()
              : []
          })
        }
      }
    }
    for (; i < elementList.length; i++) {
      // PERF-PLAN §2.2 / Phase 2B：在循环顶部（即「iter (i-1) END / iter i TOP」）
      // 捕获一份 checkpoint 候选；若本次迭代实际创建了新行（page-column 分支或
      // wrap 分支），就把它写入 sink；否则丢弃。仅当调用方传入 checkpointSink
      // 时才付出该成本。
      const iterStartCkpt: ILayoutCheckpoint | null = checkpointSink
        ? {
            x,
            y,
            pageNo,
            listId,
            listIndex,
            controlRealWidth,
            currentPageColumns,
            surroundElementList: surroundElementList.length
              ? surroundElementList.slice()
              : []
          }
        : null
      let curRow: IRow = rowList[rowList.length - 1]
      const element = elementList[i]
      if (!isFromTable && element.pageColumns) {
        const nextPageColumns = this.normalizePageColumns(element.pageColumns)
        if (!this.isSamePageColumns(currentPageColumns, nextPageColumns)) {
          currentPageColumns = nextPageColumns
          if (curRow.elementList.length) {
            rowList.push({
              width: 0,
              height: 0,
              ascent: 0,
              elementList: [],
              startIndex: i,
              rowIndex: curRow.rowIndex + 1,
              rowFlex:
                elementList?.[i]?.rowFlex || elementList?.[i + 1]?.rowFlex,
              pageColumns: currentPageColumns,
              innerWidth: this.getColumnInnerWidth(currentPageColumns)
            })
            // 新行 checkpoint 落盘：与 rowList 长度保持平行
            if (checkpointSink && iterStartCkpt) {
              checkpointSink.push(iterStartCkpt)
            }
            curRow = rowList[rowList.length - 1]
            x = startX
            y += rowList[rowList.length - 2].height
          } else {
            curRow.pageColumns = currentPageColumns
            curRow.innerWidth = this.getColumnInnerWidth(currentPageColumns)
          }
        }
      }
      const rowMargin = this.getElementRowMargin(element)
      const metrics: IElementMetrics = {
        width: 0,
        height: 0,
        boundingBoxAscent: 0,
        boundingBoxDescent: 0
      }
      // 实际可用宽度
      const offsetX =
        curRow.offsetX ||
        (element.listId && listStyleMap.get(element.listId)) ||
        0
      const rowInnerWidth = curRow.innerWidth || innerWidth
      const availableWidth = rowInnerWidth - offsetX
      // 增加起始位置坐标偏移量
      const isStartElement = curRow.elementList.length === 1
      x += isStartElement ? offsetX : 0
      y += isStartElement ? curRow.offsetY || 0 : 0
      if (
        (element.hide || element.control?.hide || element.area?.hide) &&
        !this.isDesignMode()
      ) {
        const preElement = curRow.elementList[curRow.elementList.length - 1]
        metrics.height =
          preElement?.metrics.height || this.options.defaultSize * scale
        metrics.boundingBoxAscent = preElement?.metrics.boundingBoxAscent || 0
        metrics.boundingBoxDescent = preElement?.metrics.boundingBoxDescent || 0
      } else if (
        element.type === ElementType.IMAGE ||
        element.type === ElementType.LATEX
      ) {
        // 浮动图片无需计算数据
        if (
          element.imgDisplay === ImageDisplay.SURROUND ||
          element.imgDisplay === ImageDisplay.FLOAT_TOP ||
          element.imgDisplay === ImageDisplay.FLOAT_BOTTOM
        ) {
          metrics.width = 0
          metrics.height = 0
          metrics.boundingBoxDescent = 0
        } else {
          const elementWidth = element.width! * scale
          const elementHeight = element.height! * scale
          // 图片超出尺寸后自适应（图片大小大于可用宽度时）
          if (elementWidth > availableWidth) {
            const adaptiveHeight =
              (elementHeight * availableWidth) / elementWidth
            element.width = availableWidth / scale
            element.height = adaptiveHeight / scale
            metrics.width = availableWidth
            metrics.height = adaptiveHeight
            metrics.boundingBoxDescent = adaptiveHeight
          } else {
            metrics.width = elementWidth
            metrics.height = elementHeight
            metrics.boundingBoxDescent = elementHeight
          }
          // 增加题注高度
          if (element.imgCaption?.value) {
            const fontSize = element.imgCaption.size || imgCaption.size
            const captionTop = element.imgCaption.top ?? imgCaption.top
            const captionHeight = (fontSize + captionTop) * scale
            metrics.boundingBoxAscent += captionHeight
          }
          // figure label height (above image)
          if (
            element.type === ElementType.IMAGE &&
            this.imageParticle.isFigure(element)
          ) {
            metrics.boundingBoxAscent +=
              this.imageParticle.getFigureLabelHeight(element)
          }
          // figure description height (below image)
          if (
            element.type === ElementType.IMAGE &&
            element.imgFigureDescription
          ) {
            metrics.boundingBoxAscent +=
              this.imageParticle.getFigureDescriptionHeight(element)
          }
        }
      } else if (element.type === ElementType.TABLE) {
        const tdPaddingWidth = tdPadding[1] + tdPadding[3]
        const tdPaddingHeight = tdPadding[0] + tdPadding[2]
        // 表格分页处理进度：https://github.com/Hufe921/canvas-editor/issues/41
        // 查看后续表格是否属于同一个源表格-存在即合并
        if (element.pagingId) {
          let tableIndex = i + 1
          let combineCount = 0
          while (tableIndex < elementList.length) {
            const nextElement = elementList[tableIndex]
            if (nextElement.pagingId === element.pagingId) {
              const nexTrList = nextElement.trList!.filter(
                tr => !tr.pagingRepeat
              )
              element.trList!.push(...nexTrList)
              element.height! += nextElement.height!
              tableIndex++
              combineCount++
            } else {
              break
            }
          }
          if (combineCount) {
            elementList.splice(i + 1, combineCount)
          }
        }
        element.pagingIndex = element.pagingIndex ?? 0
        if (!isFromTable && currentPageColumns.columnCount > 1) {
          this._fitTableToMaxWidth(element, availableWidth / scale)
        }
        const trList = element.trList!
        // 重置tr高度：行高不可低于一个单元格最小高度
        const tdMinHeight =
          tdPaddingHeight + defaultSize + (rowMargin * 2) / scale
        for (let t = 0; t < trList.length; t++) {
          const tr = trList[t]
          // 行高默认当前最小高度，后续根据内容自适应
          tr.height = Math.max(tdMinHeight, tr.minHeight || 0)
          tr.minHeight = tr.height
        }
        // 计算表格行列
        this.tableParticle.computeRowColInfo(element)
        // 计算表格内元素信息
        // 在外层捕获主元素列表索引，供下方 td 循环内的 _ownerElementIndex 使用。
        // td 循环内有一个 `let i = 0`（td.rowspan 循环），会遮蔽外层 i，导致 TDZ，
        // 因此在此先行捕获。
        const tableElementIndex = i
        for (let t = 0; t < trList.length; t++) {
          const tr = trList[t]
          for (let d = 0; d < tr.tdList.length; d++) {
            const td = tr.tdList[d]
            // PERF-PLAN §2.5 / Phase 2B：在 Mutator 边界（spliceElementList）能找到
            // 「这条 elementList 属于哪个 td」的能力靠 td.value 上的隐藏 _owningTd
            // 反向引用——这里保证每次 render 都重新设置一次（td 引用可能在表格
            // 重排时变化，因此 writable + 重写）。
            ;(td.value as unknown as { _owningTd: typeof td })._owningTd = td
            // PERF-PLAN §2.5 follow-up：让 Mutator 边界也能把 dirty 传播到主元素
            // 列表的 _dirtyRange。编辑表格单元格时 spliceElementList 的作用域是
            //  'table'——不会自动标记主列表脏区。存储父 TABLE 元素在主列表中的
            // 索引，spliceElementList 据此可精准设置主列表的 dirty 起点，使增量
            // 布局 (_tryBuildResumeFrom) 能恢复运行——避免在 34 页文档的 table 中
            // 按每个字符触发一次 full computeRowList。
            // 注意：不存 _ownerElement 引用——那会形成 td→TABLE→trList→tdList→td
            // 的循环引用，致使序列化 / 深拷贝递归爆栈。
            ;(td as unknown as { _ownerElementIndex: number })._ownerElementIndex = tableElementIndex
            const tdInnerWidth = (td.width! - tdPaddingWidth) * scale
            // 缓存命中条件：td 未被 dirty 标记，且缓存键完全一致。
            const canReuseCell =
              !!td.rowList &&
              !td._dirty &&
              td._cacheInnerWidth === tdInnerWidth &&
              td._cacheScale === scale &&
              td._cacheIsPagingMode === isPagingMode
            const rowList = canReuseCell
              ? td.rowList!
              : this.computeRowList({
                  innerWidth: tdInnerWidth,
                  elementList: td.value,
                  isFromTable: true,
                  isPagingMode
                })
            const rowHeight = rowList.reduce((pre, cur) => pre + cur.height, 0)
            td.rowList = rowList
            td._dirty = false
            td._cacheInnerWidth = tdInnerWidth
            td._cacheScale = scale
            td._cacheIsPagingMode = isPagingMode
            // 移除缩放导致的行高变化-渲染时会进行缩放调整
            const curTdHeight = rowHeight / scale + tdPaddingHeight
            // 内容高度大于当前单元格高度需增加
            if (td.height! < curTdHeight) {
              const extraHeight = curTdHeight - td.height!
              const changeTr = trList[t + td.rowspan - 1]
              changeTr.height += extraHeight
              changeTr.tdList.forEach(changeTd => {
                changeTd.height! += extraHeight
                if (!changeTd.realHeight) {
                  changeTd.realHeight = changeTd.height!
                } else {
                  changeTd.realHeight! += extraHeight
                }
              })
            }
            // 当前单元格最小高度及真实高度（包含跨列）
            let curTdMinHeight = 0
            let curTdRealHeight = 0
            let i = 0
            while (i < td.rowspan) {
              const curTr = trList[i + t] || trList[t]
              curTdMinHeight += curTr.minHeight!
              curTdRealHeight += curTr.height!
              i++
            }
            td.realMinHeight = curTdMinHeight
            td.realHeight = curTdRealHeight
            td.mainHeight = curTdHeight
          }
        }
        // 单元格高度大于实际内容高度需减少
        const reduceTrList = this.tableParticle.getTrListGroupByCol(trList)
        for (let t = 0; t < reduceTrList.length; t++) {
          const tr = reduceTrList[t]
          let reduceHeight = -1
          for (let d = 0; d < tr.tdList.length; d++) {
            const td = tr.tdList[d]
            const curTdRealHeight = td.realHeight!
            const curTdHeight = td.mainHeight!
            const curTdMinHeight = td.realMinHeight!
            // 获取最大可减少高度
            const curReduceHeight =
              curTdHeight < curTdMinHeight
                ? curTdRealHeight - curTdMinHeight
                : curTdRealHeight - curTdHeight
            if (!~reduceHeight || curReduceHeight < reduceHeight) {
              reduceHeight = curReduceHeight
            }
          }
          if (reduceHeight > 0) {
            const changeTr = trList[t]
            changeTr.height -= reduceHeight
            changeTr.tdList.forEach(changeTd => {
              changeTd.height! -= reduceHeight
              changeTd.realHeight! -= reduceHeight
            })
          }
        }
        // 需要重新计算表格内值
        this.tableParticle.computeRowColInfo(element)
        // 计算出表格高度
        const tableHeight = this.tableParticle.getTableHeight(element)
        const tableWidth = this.tableParticle.getTableWidth(element)
        element.width = tableWidth
        element.height = tableHeight
        const elementWidth = tableWidth * scale
        const elementHeight = tableHeight * scale
        metrics.width = elementWidth
        metrics.height = elementHeight
        metrics.boundingBoxDescent = elementHeight
        metrics.boundingBoxAscent = -rowMargin
        // 后一个元素也是表格则移除行间距
        if (elementList[i + 1]?.type === ElementType.TABLE) {
          metrics.boundingBoxAscent -= rowMargin
        }
        // table figure label + description heights
        if (this.tableParticle.isTableFigure(element)) {
          metrics.boundingBoxAscent +=
            this.tableParticle.getTableFigureLabelHeight(element)
        }
        if (element.tableFigureDescription) {
          metrics.boundingBoxDescent +=
            this.tableParticle.getTableFigureDescriptionHeight(element)
        }
        // 表格分页处理(拆分表格)
        if (isPagingMode) {
          const height = this.getHeight()
          const marginHeight = this.getMainOuterHeight()
          let curPagePreHeight = marginHeight
          for (let r = 0; r < rowList.length; r++) {
            const row = rowList[r]
            const rowOffsetY = row.offsetY || 0
            if (
              row.height + curPagePreHeight + rowOffsetY > height ||
              rowList[r - 1]?.isPageBreak
            ) {
              curPagePreHeight = marginHeight + row.height + rowOffsetY
            } else {
              curPagePreHeight += row.height + rowOffsetY
            }
          }
          // 当前剩余高度是否能容下当前表格第一行（可拆分）的高度，排除掉表头类型
          // 前面元素为换页符时重新计算高度
          const rowMarginHeight = rowMargin * 2 * scale
          const firstTrHeight = element.trList![0].height! * scale
          if (
            curPagePreHeight + firstTrHeight + rowMarginHeight > height ||
            (element.pagingIndex !== 0 && element.trList![0].pagingRepeat) ||
            elementList[i - 1]?.type === ElementType.PAGE_BREAK
          ) {
            // 无可拆分行则切换至新页
            curPagePreHeight = marginHeight
          }
          // 表格高度超过页面高度开始截断行
          if (curPagePreHeight + rowMarginHeight + elementHeight > height) {
            const trList = element.trList!
            // 计算需要移除的行数
            let deleteStart = 0
            let deleteCount = 0
            let preTrHeight = 0
            // 大于一行时再拆分避免循环
            if (trList.length > 1) {
              for (let r = 0; r < trList.length; r++) {
                const tr = trList[r]
                const trHeight = tr.height * scale
                if (
                  curPagePreHeight + rowMarginHeight + preTrHeight + trHeight >
                  height
                ) {
                  // 当前行存在跨行中断-暂时忽略分页
                  const rowColCount = tr.tdList.reduce(
                    (pre, cur) => pre + cur.colspan,
                    0
                  )
                  if (element.colgroup?.length !== rowColCount) {
                    deleteCount = 0
                  }
                  break
                } else {
                  deleteStart = r + 1
                  deleteCount = trList.length - deleteStart
                  preTrHeight += trHeight
                }
              }
            }
            if (deleteCount) {
              const cloneTrList = trList.splice(deleteStart, deleteCount)
              const cloneTrHeight = cloneTrList.reduce(
                (pre, cur) => pre + cur.height,
                0
              )
              const cloneTrRealHeight = cloneTrHeight * scale
              const pagingId = element.pagingId || getUUID()
              element.pagingId = pagingId
              element.height -= cloneTrHeight
              metrics.height -= cloneTrRealHeight
              metrics.boundingBoxDescent -= cloneTrRealHeight
              // 追加拆分表格
              const cloneElement = deepClone(element)
              cloneElement.pagingId = pagingId
              cloneElement.pagingIndex = element.pagingIndex! + 1
              // 处理分页重复表头
              const repeatTrList = trList.filter(tr => tr.pagingRepeat)
              if (repeatTrList.length) {
                const cloneRepeatTrList = deepClone(repeatTrList)
                cloneRepeatTrList.forEach(tr => (tr.id = getUUID()))
                cloneTrList.unshift(...cloneRepeatTrList)
              }
              cloneElement.trList = cloneTrList
              cloneElement.id = getUUID()
              this.spliceElementList(elementList, i + 1, 0, [cloneElement])
            }
          }
          // 表格经过分页处理-需要处理上下文
          if (element.pagingId) {
            const positionContext = this.position.getPositionContext()
            if (positionContext.isTable) {
              // 查找光标所在表格索引（根据trId搜索）
              let newPositionContextIndex = -1
              let newPositionContextTrIndex = -1
              let tableIndex = i
              while (tableIndex < elementList.length) {
                const curElement = elementList[tableIndex]
                if (curElement.pagingId !== element.pagingId) break
                const trIndex = curElement.trList!.findIndex(
                  r => r.id === positionContext.trId
                )
                if (~trIndex) {
                  newPositionContextIndex = tableIndex
                  newPositionContextTrIndex = trIndex
                  break
                }
                tableIndex++
              }
              if (~newPositionContextIndex) {
                positionContext.index = newPositionContextIndex
                positionContext.trIndex = newPositionContextTrIndex
                this.position.setPositionContext(positionContext)
              }
            }
          }
        }
      } else if (element.type === ElementType.SEPARATOR) {
        const {
          separator: { lineWidth: defaultLineWidth }
        } = this.options
        const lineWidth = element.lineWidth || defaultLineWidth
        element.width = availableWidth / scale
        metrics.width = availableWidth
        metrics.height = lineWidth * scale
        metrics.boundingBoxAscent = -rowMargin
        metrics.boundingBoxDescent = -rowMargin + metrics.height
      } else if (element.type === ElementType.PAGE_BREAK) {
        element.width = availableWidth / scale
        metrics.width = availableWidth
        metrics.height = defaultSize
      } else if (element.type === ElementType.COLUMN_BREAK) {
        element.width = availableWidth / scale
        metrics.width = availableWidth
        metrics.height = defaultSize
      } else if (
        element.type === ElementType.RADIO ||
        element.controlComponent === ControlComponent.RADIO
      ) {
        const { width, height, gap } = this.options.radio
        const elementWidth = width + gap * 2
        element.width = elementWidth
        metrics.width = elementWidth * scale
        metrics.height = height * scale
      } else if (
        element.type === ElementType.CHECKBOX ||
        element.controlComponent === ControlComponent.CHECKBOX
      ) {
        const { width, height, gap } = this.options.checkbox
        const elementWidth = width + gap * 2
        element.width = elementWidth
        metrics.width = elementWidth * scale
        metrics.height = height * scale
      } else if (element.type === ElementType.TAB) {
        metrics.width = defaultTabWidth * scale
        metrics.height = defaultSize * scale
        metrics.boundingBoxDescent = 0
        metrics.boundingBoxAscent =
          this.textParticle.getBasisWordBoundingBoxAscent(ctx, ctx.font)
      } else if (element.type === ElementType.BLOCK) {
        if (!element.width) {
          metrics.width = availableWidth
        } else {
          const elementWidth = element.width * scale
          metrics.width = Math.min(elementWidth, availableWidth)
        }
        metrics.height = element.height! * scale
        metrics.boundingBoxDescent = metrics.height
        metrics.boundingBoxAscent = 0
      } else if (element.type === ElementType.LABEL) {
        const {
          defaultSize,
          label: { defaultPadding }
        } = this.options
        ctx.font = this.getElementFont(element)
        const fontMetrics = this.textParticle.measureText(ctx, element)
        metrics.width =
          (fontMetrics.width + defaultPadding[1] + defaultPadding[3]) * scale
        metrics.height = (element.size || defaultSize) * scale
        metrics.boundingBoxDescent = 0
        metrics.boundingBoxAscent =
          (defaultPadding[0] + fontMetrics.actualBoundingBoxAscent) * scale
      } else {
        // 设置上下标真实字体尺寸
        const size = element.size || defaultSize
        if (
          element.type === ElementType.SUPERSCRIPT ||
          element.type === ElementType.SUBSCRIPT
        ) {
          element.actualSize = Math.ceil(size * 0.6)
        }
        metrics.height = (element.actualSize || size) * scale
        ctx.font = this.getElementFont(element)
        const fontMetrics = this.textParticle.measureText(ctx, element)
        metrics.width = fontMetrics.width * scale
        if (element.letterSpacing) {
          metrics.width += element.letterSpacing * scale
        }
        // 使用基于字体的基准度量以确保一致的行高，避免字符特定度量导致的布局跳动
        const basisMetrics = this.textParticle.measureBasisWord(
          ctx,
          element.font!
        )
        metrics.boundingBoxAscent = basisMetrics.actualBoundingBoxAscent * scale
        metrics.boundingBoxDescent =
          basisMetrics.actualBoundingBoxDescent * scale
        if (element.type === ElementType.SUPERSCRIPT) {
          metrics.boundingBoxAscent += metrics.height / 2
        } else if (element.type === ElementType.SUBSCRIPT) {
          metrics.boundingBoxDescent += metrics.height / 2
        }
      }
      const figureLabelAscent =
        element.type === ElementType.IMAGE &&
        this.imageParticle.isFigure(element)
          ? this.imageParticle.getFigureLabelHeight(element)
          : 0
      const tableDescAscent =
        element.type === ElementType.TABLE && element.tableFigureDescription
          ? this.tableParticle.getTableFigureDescriptionHeight(element)
          : 0
      const ascent =
        !element.hide &&
        ((element.imgDisplay !== ImageDisplay.INLINE &&
          element.type === ElementType.IMAGE) ||
          element.type === ElementType.LATEX)
          ? metrics.height + figureLabelAscent + rowMargin
          : metrics.boundingBoxAscent - tableDescAscent + rowMargin
      const height =
        rowMargin +
        metrics.boundingBoxAscent +
        metrics.boundingBoxDescent +
        rowMargin
      const rowElement: IRowElement = Object.assign(element, {
        metrics,
        left: 0,
        style: this.getElementFont(element, scale)
      })
      // 暂时只考虑非换行场景：控件开始时统计宽度，结束时消费宽度及还原
      if (rowElement.control?.minWidth) {
        if (rowElement.controlComponent) {
          controlRealWidth += metrics.width
        }
        if (rowElement.controlComponent === ControlComponent.POSTFIX) {
          // 设置最小宽度控件属性（字符偏移量）
          this.control.setMinWidthControlInfo({
            row: curRow,
            rowElement,
            availableWidth,
            controlRealWidth
          })
          controlRealWidth = 0
        }
      }
      // 超过限定宽度
      const preElement = elementList[i - 1]
      let nextElement = elementList[i + 1]
      // 累计行宽 + 当前元素宽度 + 排版宽度(英文单词整体宽度 + 后面标点符号宽度)
      let curRowWidth = curRow.width + metrics.width
      if (this.options.wordBreak === WordBreak.BREAK_WORD) {
        if (
          (!preElement?.type || preElement?.type === ElementType.TEXT) &&
          (!element.type || element.type === ElementType.TEXT)
        ) {
          // 英文单词
          const word = `${preElement?.value || ''}${element.value}`
          if (this.WORD_LIKE_REG.test(word)) {
            const { width, endElement } = this.textParticle.measureWord(
              ctx,
              elementList,
              i
            )
            // 后面存在元素 && 单词宽度大于行可用宽度，无需折行
            const wordWidth = width * scale
            if (endElement && wordWidth <= availableWidth) {
              curRowWidth += wordWidth
              nextElement = endElement
            }
          }
          // 标点符号
          const punctuationWidth = this.textParticle.measurePunctuationWidth(
            ctx,
            nextElement
          )
          curRowWidth += punctuationWidth * scale
        }
      }
      // 列表信息
      if (element.listId) {
        if (element.listId !== listId) {
          listIndex = 0
        } else if (element.value === ZERO && !element.listWrap) {
          listIndex++
        }
      }
      listId = element.listId
      // 计算四周环绕导致的元素偏移量
      const surroundPosition = this.position.setSurroundPosition({
        pageNo,
        rowElement,
        row: curRow,
        rowElementRect: {
          x,
          y,
          height,
          width: metrics.width
        },
        availableWidth,
        surroundElementList
      })
      x = surroundPosition.x
      curRowWidth += surroundPosition.rowIncreaseWidth
      x += metrics.width
      // 是否强制换行
      const isForceBreak =
        element.type === ElementType.SEPARATOR ||
        element.type === ElementType.TABLE ||
        preElement?.type === ElementType.TABLE ||
        preElement?.type === ElementType.BLOCK ||
        element.type === ElementType.BLOCK ||
        preElement?.imgDisplay === ImageDisplay.INLINE ||
        element.imgDisplay === ImageDisplay.INLINE ||
        preElement?.listId !== element.listId ||
        (preElement?.areaId !== element.areaId && !element.area?.hide) ||
        (element.control?.flexDirection === FlexDirection.COLUMN &&
          (element.controlComponent === ControlComponent.CHECKBOX ||
            element.controlComponent === ControlComponent.RADIO) &&
          preElement?.controlComponent === ControlComponent.VALUE) ||
        (i !== 0 && element.value === ZERO && !element.area?.hide)
      // 是否宽度不足导致换行
      const isWidthNotEnough = curRowWidth > availableWidth
      const isWrap = isForceBreak || isWidthNotEnough
      // 新行数据处理
      if (isWrap) {
        const row: IRow = {
          width: metrics.width,
          height,
          startIndex: i,
          elementList: [rowElement],
          ascent,
          rowIndex: curRow.rowIndex + 1,
          rowFlex: elementList[i]?.rowFlex || elementList[i + 1]?.rowFlex,
          pageColumns: currentPageColumns,
          innerWidth: this.getColumnInnerWidth(currentPageColumns),
          isPageBreak: element.type === ElementType.PAGE_BREAK,
          isColumnBreak: element.type === ElementType.COLUMN_BREAK
        }
        // 控件缩进
        if (
          rowElement.controlComponent !== ControlComponent.PREFIX &&
          rowElement.control?.indentation === ControlIndentation.VALUE_START
        ) {
          // 查找到非前缀的第一个元素位置
          const preStartIndex = curRow.elementList.findIndex(
            el =>
              el.controlId === rowElement.controlId &&
              el.controlComponent !== ControlComponent.PREFIX
          )
          if (~preStartIndex) {
            const preRowPositionList = this.position.computeRowPosition({
              row: curRow,
              innerWidth: rowInnerWidth
            })
            const valueStartPosition = preRowPositionList[preStartIndex]
            if (valueStartPosition) {
              row.offsetX = valueStartPosition.coordinate.leftTop[0]
            }
          }
        }
        // 列表缩进
        if (element.listId) {
          row.isList = true
          row.offsetX = listStyleMap.get(element.listId!)
          row.listIndex = listIndex
        }
        // Y轴偏移量
        row.offsetY =
          !isFromTable &&
          element.area?.top &&
          element.areaId !== elementList[i - 1]?.areaId
            ? element.area.top * scale
            : 0
        rowList.push(row)
        // PERF-PLAN §2.2 / Phase 2B：wrap 分支创建新行——同步落盘 checkpoint。
        // iterStartCkpt 描述「即将进入元素 i 的迭代」之前的循环局部状态，
        // 也就是「重新执行 iter i 来重建该 wrap 行」所需的全部 carry 信息。
        if (checkpointSink && iterStartCkpt) {
          checkpointSink.push(iterStartCkpt)
        }
      } else {
        curRow.width += metrics.width
        // 减小块元素前第一行空行行高
        if (
          i === 0 &&
          (getIsBlockElement(elementList[1]) || !!elementList[1]?.areaId)
        ) {
          curRow.height = defaultBasicRowMarginHeight
          curRow.ascent = defaultBasicRowMarginHeight
        } else if (curRow.height < height) {
          curRow.height = height
          curRow.ascent = ascent
        }
        curRow.elementList.push(rowElement)
      }
      // 行结束时逻辑
      if (isWrap || i === elementList.length - 1) {
        // 换行原因：宽度不足
        curRow.isWidthNotEnough = isWidthNotEnough && !isForceBreak
        // 两端对齐、分散对齐
        if (
          !curRow.isSurround &&
          (preElement?.rowFlex === RowFlex.JUSTIFY ||
            (preElement?.rowFlex === RowFlex.ALIGNMENT &&
              curRow.isWidthNotEnough))
        ) {
          // 忽略换行符及尾部元素间隔设置
          const rowElementList =
            curRow.elementList[0]?.value === ZERO
              ? curRow.elementList.slice(1)
              : curRow.elementList
          // 优先在词间空白处拉伸（拉丁文等带空格脚本，等同于 CSS word-spacing）
          // 当行内不存在空白时退化为按字符分散（兼容 CJK 等无词间空白的脚本）
          const whitespaceIndexes: number[] = []
          for (let e = 0; e < rowElementList.length - 1; e++) {
            const v = rowElementList[e].value
            if (v === ' ' || v === ' ') {
              whitespaceIndexes.push(e)
            }
          }
          // 整行是否含拉丁字母：用于决定无内部空白时是否按字符分散（CJK 行为）
          let hasLatinLetter = false
          for (let e = 0; e < rowElementList.length; e++) {
            const v = rowElementList[e].value
            if (v && this.LETTER_REG.test(v)) {
              hasLatinLetter = true
              break
            }
          }
          if (whitespaceIndexes.length > 0) {
            const gap =
              (availableWidth - curRow.width) / whitespaceIndexes.length
            for (let g = 0; g < whitespaceIndexes.length; g++) {
              rowElementList[whitespaceIndexes[g]].metrics.width += gap
            }
            curRow.width = availableWidth
          } else if (!hasLatinLetter && rowElementList.length > 1) {
            // CJK 等无词间空白脚本：保留原按字符分散行为
            const gap =
              (availableWidth - curRow.width) / (rowElementList.length - 1)
            for (let e = 0; e < rowElementList.length - 1; e++) {
              rowElementList[e].metrics.width += gap
            }
            curRow.width = availableWidth
          }
          // 拉丁文单词独占行：保持自然宽度，匹配 Word/Docs 不拉伸字符的行为
        }
      }
      // 重新计算坐标、页码、下一行首行元素环绕交叉
      if (isWrap) {
        x = startX
        y += curRow.height
        if (
          isPagingMode &&
          !isFromTable &&
          pageHeight &&
          (y - startY + mainOuterHeight + height > pageHeight ||
            element.type === ElementType.PAGE_BREAK)
        ) {
          y = startY
          // 删除多余四周环绕型元素
          deleteSurroundElementList(surroundElementList, pageNo)
          pageNo += 1
        }
        // 计算下一行第一个元素是否存在环绕交叉
        rowElement.left = 0
        const nextRow = rowList[rowList.length - 1]
        const surroundPosition = this.position.setSurroundPosition({
          pageNo,
          rowElement,
          row: nextRow,
          rowElementRect: {
            x,
            y,
            height,
            width: metrics.width
          },
          availableWidth,
          surroundElementList
        })
        x = surroundPosition.x
        x += metrics.width
      }
      // PERF-PLAN §2.2 / Phase 2B：收敛检测——仅当本帧走增量恢复路径、且本次
      // 迭代实际完成了一行（isWrap）时检查。命中收敛则丢弃刚 push 的下一行
      // 种子，break 出循环，由调用方拼接旧尾部。
      // 这是把「在 25 页文档第 1 页改字」的工作量从 O(后续 N 元素) 收敛回
      // 「受影响段落」量级的关键步骤。
      if (
        isWrap &&
        resumeFrom?.convergenceTarget &&
        resumeFrom.convergenceTarget.matched === null
      ) {
        if (
          this._tryConvergeIncrementalRowList(
            rowList,
            checkpointSink,
            resumeFrom.convergenceTarget
          )
        ) {
          break
        }
      }
    }
    return rowList
  }

  /**
   * 尝试把刚完成的行（rowList[length-2]）匹配到 oldRowsAfterCut 中的某个旧
   * 行——元素引用 / 长度 / 宽高 / ascent 全部一致，且当前位置已越过 dirtyEnd
   * 时认定收敛。命中后：
   *   - 写入 convergenceTarget.matched
   *   - 丢弃 rowList 末尾刚 push 的下一行种子（避免与即将接驳的旧尾部首行重复）
   *   - 同步丢弃 checkpointSink 的最末尾条目
   *   - 返回 true：调用方应 break 出 for-loop
   *
   * 不命中时返回 false——调用方继续下一次迭代。
   */
  private _tryConvergeIncrementalRowList(
    rowList: IRow[],
    checkpointSink: ILayoutCheckpoint[] | undefined,
    target: IConvergenceTarget
  ): boolean {
    if (rowList.length < 2) return false
    const completed = rowList[rowList.length - 2]
    const completedAbsEnd = completed.startIndex + completed.elementList.length
    // 必须越过 dirty 末端——否则可能匹配到 dirty 区间内的旧行（误收敛会丢
    // 掉本应重排的行）。
    if (completedAbsEnd <= target.dirtyEndAbs) return false
    const oldRows = target.oldRowsAfterCut
    const len = completed.elementList.length
    const last = len - 1
    const firstEl = completed.elementList[0]
    const lastEl = last >= 0 ? completed.elementList[last] : firstEl
    for (let oj = 0; oj < oldRows.length; oj++) {
      const old = oldRows[oj]
      if (old.elementList.length !== len) continue
      // 廉价的早期剔除：首尾元素引用必须相等（refs 经过 splice 也保留）。
      if (old.elementList[0] !== firstEl) continue
      if (old.elementList[last] !== lastEl) continue
      // 行布局必须全等——任何漂移都意味着后续行也会不同。
      if (old.height !== completed.height) continue
      if (old.width !== completed.width) continue
      if (old.ascent !== completed.ascent) continue
      // 完整 ref 比对——保险起见，避免首尾相同但中间被改的极端情形。
      let allMatch = true
      for (let k = 1; k < last; k++) {
        if (old.elementList[k] !== completed.elementList[k]) {
          allMatch = false
          break
        }
      }
      if (!allMatch) continue
      target.matched = { atOldIdx: oj }
      // 丢弃刚 push 的下一行种子——调用方会从 oldRowsAfterCut[oj+1] 接驳，
      // 那里已经包含 element[i]，避免双重计入。
      rowList.pop()
      if (checkpointSink && checkpointSink.length > rowList.length) {
        checkpointSink.pop()
      }
      return true
    }
    return false
  }

  private _computePageList(): IRow[][] {
    const pageRowList: IRow[][] = [[]]
    const {
      pageMode,
      pageNumber: { maxPageNo }
    } = this.options
    const height = this.getHeight()
    const margins = this.getMargins()
    const headerExtraHeight = this.header.getExtraHeight()
    const marginHeight = this.getMainOuterHeight()
    const contentStartY = margins[0] + headerExtraHeight
    const trailingOuterHeight = marginHeight - contentStartY
    const contentBottomY = height - trailingOuterHeight
    let pageNo = 0
    let pageHeight = marginHeight
    const pushRow = (row: IRow) => {
      if (!pageRowList[pageNo]) {
        pageRowList[pageNo] = []
      }
      pageRowList[pageNo].push(row)
    }
    const nextPage = (cutIndex: number): boolean => {
      if (Number.isInteger(maxPageNo) && pageNo >= maxPageNo!) {
        this.elementList = this.elementList.slice(0, cutIndex)
        return false
      }
      pageNo++
      pageHeight = marginHeight
      if (!pageRowList[pageNo]) {
        pageRowList[pageNo] = []
      }
      return true
    }
    if (pageMode === PageMode.CONTINUITY) {
      // 连续模式下保持单列行为：所有行注入第一列，列索引归零
      pageRowList[0] = this.rowList
      let continuityContentY = contentStartY
      for (let i = 0; i < this.rowList.length; i++) {
        const row = this.rowList[i]
        row.columnIndex = 0
        row.innerWidth = this.getInnerWidth()
        row.pageStartX = margins[3]
        row.pageStartY = continuityContentY
        continuityContentY += row.height + (row.offsetY || 0)
      }
      pageHeight = continuityContentY + trailingOuterHeight
      const dpr = this.getPagePixelRatio()
      const pageDom = this.pageList[0]
      const pageDomHeight = Number(pageDom.style.height.replace('px', ''))
      const targetHeight =
        pageHeight > pageDomHeight
          ? pageHeight
          : pageHeight < height
            ? height
            : pageHeight
      // PERF-PLAN — Strategy B：连续模式动态高度调整也必须同步 wrapper /
      // decoration——否则 decoration canvas 会保持创建时的初始高度，下方
      // 内容画到 base 上 decoration 会被裁掉。
      this._resizePageBacking(0, this.getWidth(), targetHeight, dpr)
    } else {
      let rowIndex = 0
      while (rowIndex < this.rowList.length) {
        const sectionRows: IRow[] = []
        const pageColumns =
          this.rowList[rowIndex].pageColumns || this.getPageColumns()
        while (
          rowIndex < this.rowList.length &&
          this.isSamePageColumns(
            this.rowList[rowIndex].pageColumns,
            pageColumns
          )
        ) {
          sectionRows.push(this.rowList[rowIndex])
          rowIndex++
        }
        const columnCount = this.getColumnCount(pageColumns)
        const columnInnerWidth = this.getColumnInnerWidth(pageColumns)
        if (columnCount <= 1) {
          for (let i = 0; i < sectionRows.length; i++) {
            const row = sectionRows[i]
            const rowOffsetY = row.offsetY || 0
            const prev = this.rowList[row.rowIndex - 1]
            const forcePageBreak = !!prev?.isPageBreak
            const overflow = row.height + rowOffsetY + pageHeight > height
            if (forcePageBreak || (overflow && pageHeight > marginHeight)) {
              if (!nextPage(row.startIndex)) {
                return pageRowList
              }
            }
            row.columnIndex = 0
            row.innerWidth = columnInnerWidth
            row.pageStartX = this.getColumnStartX(0, pageColumns)
            row.pageStartY = pageHeight - trailingOuterHeight
            pushRow(row)
            pageHeight += row.height + rowOffsetY
          }
          continue
        }
        let sectionTop = pageHeight - trailingOuterHeight
        let columnIndex = 0
        let columnHeightList = new Array(columnCount).fill(sectionTop)
        let columnHasContentList = new Array(columnCount).fill(false)
        // 列平衡（Google Docs 风格）：当本节内容能在当前页放下时，
        // 将每列填充到 ceil(剩余高度 / 列数)，让两列高度接近、并排显示，
        // 而不是先把第 0 列填满整页才溢出到第 1 列。
        let remainingSectionHeight = 0
        for (let i = 0; i < sectionRows.length; i++) {
          remainingSectionHeight +=
            sectionRows[i].height + (sectionRows[i].offsetY || 0)
        }
        const computeBalanceThreshold = (top: number, remaining: number) => {
          if (remaining <= 0) return contentBottomY
          const available = contentBottomY - top
          if (available <= 0) return contentBottomY
          // 内容超过当前页所有列容量时，回退为贪婪填充
          if (remaining > available * columnCount) return contentBottomY
          return Math.min(
            contentBottomY,
            top + Math.ceil(remaining / columnCount)
          )
        }
        let balanceThreshold = computeBalanceThreshold(
          sectionTop,
          remainingSectionHeight
        )
        for (let i = 0; i < sectionRows.length; i++) {
          const row = sectionRows[i]
          const rowOffsetY = row.offsetY || 0
          const prev = this.rowList[row.rowIndex - 1]
          const forcePageBreak = !!prev?.isPageBreak
          const forceColumnBreak = !!prev?.isColumnBreak
          if (forcePageBreak) {
            if (!nextPage(row.startIndex)) {
              return pageRowList
            }
            sectionTop = pageHeight - trailingOuterHeight
            columnIndex = 0
            columnHeightList = new Array(columnCount).fill(sectionTop)
            columnHasContentList = new Array(columnCount).fill(false)
            balanceThreshold = computeBalanceThreshold(
              sectionTop,
              remainingSectionHeight
            )
          } else if (forceColumnBreak && columnHasContentList[columnIndex]) {
            if (columnIndex === columnCount - 1) {
              if (!nextPage(row.startIndex)) {
                return pageRowList
              }
              sectionTop = pageHeight - trailingOuterHeight
              columnIndex = 0
              columnHeightList = new Array(columnCount).fill(sectionTop)
              columnHasContentList = new Array(columnCount).fill(false)
              balanceThreshold = computeBalanceThreshold(
                sectionTop,
                remainingSectionHeight
              )
            } else {
              columnIndex++
              // 用户主动分列：之后不再做平衡
              balanceThreshold = contentBottomY
            }
          }
          const projectedHeight =
            columnHeightList[columnIndex] + rowOffsetY + row.height
          const overflowHard = projectedHeight > contentBottomY
          // 软溢出：以行的中点作判断（"四舍五入"式平衡），
          // 让 col 0 略高于 col 1，与 Google Docs 行为一致；
          // 否则因 Math.ceil + 行高离散，col 0 总是少一行。
          const overflowBalance =
            balanceThreshold < contentBottomY &&
            columnHeightList[columnIndex] + rowOffsetY + row.height / 2 >
              balanceThreshold
          if (overflowHard && columnHasContentList[columnIndex]) {
            if (columnIndex === columnCount - 1) {
              if (!nextPage(row.startIndex)) {
                return pageRowList
              }
              sectionTop = pageHeight - trailingOuterHeight
              columnIndex = 0
              columnHeightList = new Array(columnCount).fill(sectionTop)
              columnHasContentList = new Array(columnCount).fill(false)
              balanceThreshold = computeBalanceThreshold(
                sectionTop,
                remainingSectionHeight
              )
            } else {
              columnIndex++
            }
          } else if (
            overflowBalance &&
            columnHasContentList[columnIndex] &&
            columnIndex < columnCount - 1
          ) {
            // 软溢出：仅切换到下一列以平衡列高，不强制换页
            columnIndex++
          }
          row.columnIndex = columnIndex
          row.innerWidth = columnInnerWidth
          row.pageStartX = this.getColumnStartX(columnIndex, pageColumns)
          row.pageStartY = columnHeightList[columnIndex]
          pushRow(row)
          columnHeightList[columnIndex] += row.height + rowOffsetY
          columnHasContentList[columnIndex] = true
          remainingSectionHeight -= row.height + rowOffsetY
        }
        pageHeight = Math.max(...columnHeightList) + trailingOuterHeight
      }
    }
    return pageRowList
  }

  private _drawHighlight(
    ctx: CanvasRenderingContext2D,
    payload: IDrawRowPayload
  ) {
    const { rowList, positionList, elementList } = payload
    const marginHeight = this.getDefaultBasicRowMarginHeight()
    const highlightMarginHeight = this.getHighlightMarginHeight()
    for (let i = 0; i < rowList.length; i++) {
      const curRow = rowList[i]
      for (let j = 0; j < curRow.elementList.length; j++) {
        const element = curRow.elementList[j]
        const preElement = curRow.elementList[j - 1]
        // 高亮配置：元素 > 控件配置
        const highlight =
          element.highlight ||
          this.control.getControlHighlight(elementList, curRow.startIndex + j)
        if (highlight) {
          // 高亮元素相连需立即绘制，并记录下一元素坐标
          if (
            preElement &&
            preElement.highlight &&
            preElement.highlight !== element.highlight
          ) {
            this.highlight.render(ctx)
          }
          // 当前元素位置信息记录
          const {
            coordinate: {
              leftTop: [x, y]
            }
          } = positionList[curRow.startIndex + j]
          // 元素向左偏移量
          const offsetX = element.left || 0
          this.highlight.recordFillInfo(
            ctx,
            x - offsetX,
            y + marginHeight - highlightMarginHeight, // 先减去行margin，再加上高亮margin
            element.metrics.width + offsetX,
            curRow.height - 2 * marginHeight + 2 * highlightMarginHeight,
            highlight
          )
        } else if (preElement?.highlight) {
          // 之前是高亮元素，当前不是需立即绘制
          this.highlight.render(ctx)
        }
      }
      this.highlight.render(ctx)
    }
  }

  public drawRow(ctx: CanvasRenderingContext2D, payload: IDrawRowPayload) {
    // 优先绘制高亮元素
    this._drawHighlight(ctx, payload)
    // 绘制元素、下划线、删除线、选区
    const {
      scale,
      table: { tdPadding },
      group,
      lineBreak,
      whiteSpace
    } = this.options
    const {
      rowList,
      pageNo,
      elementList,
      positionList,
      startIndex,
      zone,
      isDrawLineBreak = !lineBreak.disabled,
      isDrawWhiteSpace = !whiteSpace.disabled
    } = payload
    const isPrintMode = this.isPrintMode()
    const isGraffitiMode = this.isGraffitiMode()
    const { isCrossRowCol, tableId } = this.range.getRange()
    let index = startIndex
    for (let i = 0; i < rowList.length; i++) {
      const curRow = rowList[i]
      // 选区绘制记录
      const rangeRecord: IElementFillRect = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      }
      let tableRangeElement: IElement | null = null
      for (let j = 0; j < curRow.elementList.length; j++) {
        const element = curRow.elementList[j]
        const metrics = element.metrics
        // 当前元素位置信息
        const {
          ascent: offsetY,
          coordinate: {
            leftTop: [x, y]
          }
        } = positionList[curRow.startIndex + j]
        const preElement = curRow.elementList[j - 1]
        // 元素绘制
        if (
          (element.hide || element.control?.hide || element.area?.hide) &&
          !this.isDesignMode()
        ) {
          // 控件隐藏时不绘制
          this.textParticle.complete()
        } else if (element.type === ElementType.IMAGE) {
          this.textParticle.complete()
          // 浮动图片单独绘制
          if (
            element.imgDisplay !== ImageDisplay.SURROUND &&
            element.imgDisplay !== ImageDisplay.FLOAT_TOP &&
            element.imgDisplay !== ImageDisplay.FLOAT_BOTTOM
          ) {
            this.imageParticle.render(ctx, element, x, y + offsetY)
          }
        } else if (element.type === ElementType.LATEX) {
          this.textParticle.complete()
          this.laTexParticle.render(ctx, element, x, y + offsetY)
        } else if (element.type === ElementType.TABLE) {
          if (isCrossRowCol) {
            rangeRecord.x = x
            rangeRecord.y = y
            tableRangeElement = element
          }
          this.tableParticle.render(ctx, element, x, y)
        } else if (element.type === ElementType.HYPERLINK) {
          this.textParticle.complete()
          this.hyperlinkParticle.render(ctx, element, x, y + offsetY)
        } else if (element.type === ElementType.LABEL) {
          this.textParticle.complete()
          this.labelParticle.render(ctx, element, x, y + offsetY)
        } else if (element.type === ElementType.DATE) {
          const nextElement = curRow.elementList[j + 1]
          // 释放之前的
          if (!preElement || preElement.dateId !== element.dateId) {
            this.textParticle.complete()
          }
          this.textParticle.record(ctx, element, x, y + offsetY)
          if (!nextElement || nextElement.dateId !== element.dateId) {
            // 手动触发渲染
            this.textParticle.complete()
          }
        } else if (element.type === ElementType.SUPERSCRIPT) {
          this.textParticle.complete()
          this.superscriptParticle.render(ctx, element, x, y + offsetY)
        } else if (element.type === ElementType.SUBSCRIPT) {
          this.underline.render(ctx)
          this.textParticle.complete()
          this.subscriptParticle.render(ctx, element, x, y + offsetY)
        } else if (element.type === ElementType.SEPARATOR) {
          this.separatorParticle.render(ctx, element, x, y)
        } else if (element.type === ElementType.PAGE_BREAK) {
          if (this.mode !== EditorMode.CLEAN && !isPrintMode) {
            this.pageBreakParticle.render(ctx, element, x, y)
          }
        } else if (element.type === ElementType.COLUMN_BREAK) {
          if (this.mode !== EditorMode.CLEAN && !isPrintMode) {
            this.pageBreakParticle.render(ctx, element, x, y)
          }
        } else if (
          element.type === ElementType.CHECKBOX ||
          element.controlComponent === ControlComponent.CHECKBOX
        ) {
          this.textParticle.complete()
          this.checkboxParticle.render({
            ctx,
            x,
            y: y + offsetY,
            index: j,
            row: curRow
          })
        } else if (
          element.type === ElementType.RADIO ||
          element.controlComponent === ControlComponent.RADIO
        ) {
          this.textParticle.complete()
          this.radioParticle.render({
            ctx,
            x,
            y: y + offsetY,
            index: j,
            row: curRow
          })
        } else if (element.type === ElementType.TAB) {
          this.textParticle.complete()
        } else if (
          element.rowFlex === RowFlex.ALIGNMENT ||
          element.rowFlex === RowFlex.JUSTIFY
        ) {
          // 如果是两端对齐，因canvas目前不支持letterSpacing需单独绘制文本
          this.textParticle.record(ctx, element, x, y + offsetY)
          this.textParticle.complete()
        } else if (element.type === ElementType.BLOCK) {
          this.textParticle.complete()
          this.blockParticle.render(ctx, pageNo, element, x, y + offsetY)
        } else {
          // 如果当前元素设置左偏移，则上一元素立即绘制
          if (element.left) {
            this.textParticle.complete()
          }
          this.textParticle.record(ctx, element, x, y + offsetY)
          // 如果设置字宽、字间距、标点符号（避免浏览器排版缩小间距）需单独绘制
          if (
            element.width ||
            element.letterSpacing ||
            PUNCTUATION_REG.test(element.value)
          ) {
            this.textParticle.complete()
          }
        }
        // 换行符绘制
        if (
          isDrawLineBreak &&
          !isPrintMode &&
          this.mode !== EditorMode.CLEAN &&
          !curRow.isWidthNotEnough &&
          j === curRow.elementList.length - 1
        ) {
          this.lineBreakParticle.render(ctx, element, x, y + curRow.height / 2)
        }
        // 空白符绘制
        if (isDrawWhiteSpace && WHITE_SPACE_REG.test(element.value)) {
          this.whiteSpaceParticle.render(ctx, element, x, y + curRow.height / 2)
        }
        // 边框绘制（目前仅支持控件）
        if (element.control?.border) {
          // 不同控件边框立刻绘制
          if (
            preElement?.control?.border &&
            preElement.controlId !== element.controlId
          ) {
            this.control.drawBorder(ctx)
          }
          // 当前元素位置信息记录
          const rowMargin = this.getElementRowMargin(element)
          this.control.recordBorderInfo(
            x,
            y + rowMargin,
            element.metrics.width,
            curRow.height - 2 * rowMargin
          )
        } else if (preElement?.control?.border) {
          this.control.drawBorder(ctx)
        }
        // 下划线记录
        if (element.underline || element.control?.underline) {
          // 下标元素下划线单独绘制
          if (
            preElement?.type === ElementType.SUBSCRIPT &&
            element.type !== ElementType.SUBSCRIPT
          ) {
            this.underline.render(ctx)
          }
          // 行间距
          const rowMargin = this.getElementRowMargin(element)
          // 元素向左偏移量
          const offsetX = element.left || 0
          // 下标元素y轴偏移值
          let offsetY = 0
          if (element.type === ElementType.SUBSCRIPT) {
            offsetY = this.subscriptParticle.getOffsetY(element)
          }
          // 占位符不参与颜色计算
          const color = element.control?.underline
            ? this.options.underlineColor
            : element.color
          this.underline.recordFillInfo(
            ctx,
            x - offsetX,
            y + curRow.height - rowMargin + offsetY,
            metrics.width + offsetX,
            0,
            color,
            element.textDecoration?.style
          )
        } else if (preElement?.underline || preElement?.control?.underline) {
          this.underline.render(ctx)
        }
        // 删除线记录
        if (element.strikeout) {
          // 仅文本类元素支持删除线
          if (!element.type || TEXTLIKE_ELEMENT_TYPE.includes(element.type)) {
            // 字体大小不同时需立即绘制
            if (
              preElement &&
              ((preElement.type === ElementType.SUBSCRIPT &&
                element.type !== ElementType.SUBSCRIPT) ||
                (preElement.type === ElementType.SUPERSCRIPT &&
                  element.type !== ElementType.SUPERSCRIPT) ||
                this.getElementSize(preElement) !==
                  this.getElementSize(element))
            ) {
              this.strikeout.render(ctx)
            }
            // 基线文字测量信息
            const standardMetrics = this.textParticle.measureBasisWord(
              ctx,
              this.getElementFont(element)
            )
            // 文字渲染位置 + 基线文字下偏移量 - 一半文字高度
            let adjustY =
              y +
              offsetY +
              standardMetrics.actualBoundingBoxDescent * scale -
              metrics.height / 2
            // 上下标位置调整
            if (element.type === ElementType.SUBSCRIPT) {
              adjustY += this.subscriptParticle.getOffsetY(element)
            } else if (element.type === ElementType.SUPERSCRIPT) {
              adjustY += this.superscriptParticle.getOffsetY(element)
            }
            this.strikeout.recordFillInfo(ctx, x, adjustY, metrics.width)
          }
        } else if (preElement?.strikeout) {
          this.strikeout.render(ctx)
        }
        // 选区记录
        const {
          zone: currentZone,
          startIndex,
          endIndex
        } = this.range.getRange()
        if (
          currentZone === zone &&
          startIndex !== endIndex &&
          startIndex <= index &&
          index <= endIndex
        ) {
          const positionContext = this.position.getPositionContext()
          // 表格需限定上下文
          if (
            (!positionContext.isTable && !element.tdId) ||
            positionContext.tdId === element.tdId
          ) {
            // 从行尾开始-绘制最小宽度
            if (startIndex === index) {
              const nextElement = elementList[startIndex + 1]
              if (nextElement && nextElement.value === ZERO) {
                rangeRecord.x = x + metrics.width
                rangeRecord.y = y
                rangeRecord.height = curRow.height
                rangeRecord.width += this.options.rangeMinWidth
              }
            } else {
              let rangeWidth = metrics.width
              // 最小选区宽度
              if (rangeWidth === 0 && curRow.elementList.length === 1) {
                rangeWidth = this.options.rangeMinWidth
              }
              // 记录第一次位置、行高
              if (!rangeRecord.width) {
                rangeRecord.x = x
                rangeRecord.y = y
                rangeRecord.height = curRow.height
              }
              rangeRecord.width += rangeWidth
            }
          }
        }
        // 组信息记录
        if (!group.disabled && element.groupIds) {
          this.group.recordFillInfo(element, x, y, metrics.width, curRow.height)
        }
        index++
        // 绘制表格内元素
        if (element.type === ElementType.TABLE && !element.hide) {
          const tdPaddingWidth = tdPadding[1] + tdPadding[3]
          for (let t = 0; t < element.trList!.length; t++) {
            const tr = element.trList![t]
            for (let d = 0; d < tr.tdList!.length; d++) {
              const td = tr.tdList[d]
              this.drawRow(ctx, {
                elementList: td.value,
                positionList: td.positionList!,
                rowList: td.rowList!,
                pageNo,
                startIndex: 0,
                innerWidth: (td.width! - tdPaddingWidth) * scale,
                zone,
                isDrawLineBreak
              })
            }
          }
        }
      }
      // 绘制列表样式
      if (curRow.isList) {
        this.listParticle.drawListStyle(
          ctx,
          curRow,
          positionList[curRow.startIndex]
        )
      }
      // 绘制文字、边框、下划线、删除线
      this.textParticle.complete()
      this.control.drawBorder(ctx)
      this.underline.render(ctx)
      this.strikeout.render(ctx)
      // 绘制批注样式
      this.group.render(ctx)
      // 绘制选区——PERF-PLAN — Strategy B：当 _currentDecorationCtx 非空（_drawPage
      // 设置）时写到 decoration 层；否则保持旧行为（写到 base ctx，用于打印 / 单层）。
      const decorationCtx = this._currentDecorationCtx ?? ctx
      if (!this._suppressDecorationPaint && !isPrintMode && !isGraffitiMode) {
        if (rangeRecord.width && rangeRecord.height) {
          const { x, y, width, height } = rangeRecord
          this.range.render(decorationCtx, x, y, width, height)
        }
        if (
          isCrossRowCol &&
          tableRangeElement &&
          tableRangeElement.id === tableId
        ) {
          const {
            coordinate: {
              leftTop: [x, y]
            }
          } = positionList[curRow.startIndex]
          this.tableParticle.drawRange(decorationCtx, tableRangeElement, x, y)
        }
      }
    }
  }

  private _drawFloat(
    ctx: CanvasRenderingContext2D,
    payload: IDrawFloatPayload
  ) {
    const { scale } = this.options
    const floatPositionList = this.position.getFloatPositionList()
    const { imgDisplays, pageNo } = payload
    for (let e = 0; e < floatPositionList.length; e++) {
      const floatPosition = floatPositionList[e]
      const element = floatPosition.element
      if (
        (pageNo === floatPosition.pageNo ||
          floatPosition.zone === EditorZone.HEADER ||
          floatPosition.zone == EditorZone.FOOTER) &&
        element.imgDisplay &&
        imgDisplays.includes(element.imgDisplay) &&
        element.type === ElementType.IMAGE
      ) {
        const imgFloatPosition = element.imgFloatPosition!
        this.imageParticle.render(
          ctx,
          element,
          imgFloatPosition.x * scale,
          imgFloatPosition.y * scale
        )
      }
    }
  }

  private _clearPageContexts(
    pageNo: number,
    ctx: CanvasRenderingContext2D,
    decoCtx: CanvasRenderingContext2D,
    clipTop = 0
  ) {
    // pageNo 仅用于健壮性校验：允许在 page 尚未创建时仍按配置尺寸清空。
    if (!this.pageList[pageNo]) {
      // noop
    }
    const w = this.getWidth()
    const h = this.getHeight()
    const safeTop = Math.max(0, Math.min(clipTop, h))
    ctx.clearRect(0, safeTop, w, h - safeTop)
    if (decoCtx && decoCtx !== ctx) {
      decoCtx.clearRect(0, safeTop, w, h - safeTop)
    }
    this.blockParticle.clear()
  }

  private _getPageChromeCacheKey(pageNo: number): string {
    const {
      inactiveAlpha,
      pageMode,
      header,
      footer,
      pageNumber,
      pageBorder,
      watermark,
      margins,
      width,
      height,
      scale
    } = this.options
    return JSON.stringify({
      pageNo,
      pageCount: this.pageRowList.length,
      width,
      height,
      scale,
      pageMode,
      alpha: !this.zone.isMainActive() ? inactiveAlpha : 1,
      isPrintMode: this.mode === EditorMode.PRINT,
      printBackgroundDisabled:
        this.options.modeRule[EditorMode.PRINT]?.backgroundDisabled ?? false,
      headerDisabled: header.disabled,
      footerDisabled: footer.disabled,
      pageNumberDisabled: pageNumber.disabled,
      pageBorderDisabled: pageBorder.disabled,
      headerExtraHeight: this.header.getExtraHeight(),
      watermarkData: watermark.data,
      watermarkLayer: watermark.layer,
      watermarkType: watermark.type,
      watermarkOpacity: watermark.opacity,
      watermarkColor: watermark.color,
      watermarkFont: watermark.font,
      watermarkSize: watermark.size,
      watermarkRepeat: watermark.repeat,
      watermarkGap: watermark.gap,
      watermarkNumberType: watermark.numberType,
      pageBorderColor: pageBorder.color,
      pageBorderLineWidth: pageBorder.lineWidth,
      pageBorderPadding: pageBorder.padding,
      margins,
      headerVersion: this._headerChromeVersion,
      footerVersion: this._footerChromeVersion
    })
  }

  private _renderPageChromeCache(pageNo: number) {
    const { inactiveAlpha, pageMode, header, footer, pageNumber, pageBorder } =
      this.options
    const isPrintMode = this.mode === EditorMode.PRINT
    const isContinuityMode = pageMode === PageMode.CONTINUITY
    const chromeCtx = this.chromeCacheCtxList[pageNo]
    const chromeCanvas = this.chromeCacheCanvasList[pageNo]
    if (!chromeCtx || !chromeCanvas) return
    chromeCtx.clearRect(0, 0, this.getWidth(), this.getHeight())
    chromeCtx.globalAlpha = !this.zone.isMainActive() ? inactiveAlpha : 1
    if (
      !isPrintMode ||
      !this.options.modeRule[EditorMode.PRINT]?.backgroundDisabled
    ) {
      this.background.render(chromeCtx, pageNo)
    }
    if (
      !isContinuityMode &&
      this.options.watermark.data &&
      this.options.watermark.layer === WatermarkLayer.BOTTOM
    ) {
      this.waterMark.render(chromeCtx, pageNo)
    }
    if (!isPrintMode) {
      this.margin.render(chromeCtx, pageNo)
    }
    if (this.getIsPagingMode()) {
      if (!header.disabled) {
        this.header.render(chromeCtx, pageNo)
      }
      if (!pageNumber.disabled) {
        this.pageNumber.render(chromeCtx, pageNo)
      }
      if (!footer.disabled) {
        this.footer.render(chromeCtx, pageNo)
      }
    }
    if (!pageBorder.disabled) {
      this.pageBorder.render(chromeCtx)
    }
    if (
      !isContinuityMode &&
      this.options.watermark.data &&
      this.options.watermark.layer === WatermarkLayer.TOP
    ) {
      this.waterMark.render(chromeCtx, pageNo)
    }
  }

  private _blitPageChrome(ctx: CanvasRenderingContext2D, pageNo: number) {
    const nextKey = this._getPageChromeCacheKey(pageNo)
    if (this.chromeCacheKeyList[pageNo] !== nextKey) {
      this._renderPageChromeCache(pageNo)
      this.chromeCacheKeyList[pageNo] = nextKey
    }
    const chromeCanvas = this.chromeCacheCanvasList[pageNo]
    if (!chromeCanvas) return
    ctx.drawImage(chromeCanvas, 0, 0, this.getWidth(), this.getHeight())
  }

  private _drawPageWithContexts(
    payload: IDrawPagePayload,
    ctx: CanvasRenderingContext2D,
    decoCtx: CanvasRenderingContext2D,
    suppressDecorationPaint = false
  ) {
    const { elementList, positionList, rowList, pageNo } = payload
    const { inactiveAlpha, lineNumber } = this.options
    const isPrintMode = this.mode === EditorMode.PRINT
    const innerWidth = this.getInnerWidth()
    const canPartialPaint =
      !suppressDecorationPaint &&
      this._dirtyRange !== null &&
      !this._isDecorationActive() &&
      this.getIsPagingMode() &&
      this._paintPlanFirstShiftedPage === null &&
      !this._pageHasFloatImageOnPage(pageNo)
    const partialInfo = canPartialPaint
      ? this._getDirtyClipInfoForPage(rowList, positionList)
      : null
    const clipTop = partialInfo?.clipTop ?? 0
    const rowListToPaint = partialInfo
      ? rowList.slice(partialInfo.fromRowIndex)
      : rowList
    const w = this.getWidth()
    const h = this.getHeight()
    // PERF-PLAN — Strategy B：drawRow 内部 range / table-cross-row paint 时
    // 取这个 ctx 作为目标。打印模式不需要选区——保留 null，落到 base ctx 上
    // 保持原行为（实际打印模式下 startIndex===endIndex，不会画选区）。
    this._suppressDecorationPaint = suppressDecorationPaint
    this._currentDecorationCtx = !isPrintMode ? decoCtx : null
    // 判断当前激活区域-非正文区域时元素透明度降低
    ctx.globalAlpha = !this.zone.isMainActive() ? inactiveAlpha : 1
    if (decoCtx && decoCtx !== ctx) decoCtx.globalAlpha = ctx.globalAlpha
    this._clearPageContexts(pageNo, ctx, decoCtx, clipTop)
    const needsClip = clipTop > 0 && clipTop < h
    if (needsClip) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, clipTop, w, h - clipTop)
      ctx.clip()
      if (decoCtx && decoCtx !== ctx) {
        decoCtx.save()
        decoCtx.beginPath()
        decoCtx.rect(0, clipTop, w, h - clipTop)
        decoCtx.clip()
      }
    }
    this._blitPageChrome(ctx, pageNo)
    // 绘制区域
    if (!isPrintMode) {
      this.area.render(ctx, pageNo)
    }
    // 渲染衬于文字下方元素
    this._drawFloat(ctx, {
      pageNo,
      imgDisplays: [ImageDisplay.FLOAT_BOTTOM]
    })
    // 控件高亮
    if (!isPrintMode) {
      this.control.renderHighlightList(ctx, pageNo)
    }
    // 渲染元素
    const index = rowListToPaint[0]?.startIndex
    this.drawRow(ctx, {
      elementList,
      positionList,
      rowList: rowListToPaint,
      pageNo,
      startIndex: index,
      innerWidth,
      zone: EditorZone.MAIN
    })
    // 渲染浮于文字上方元素
    this._drawFloat(ctx, {
      pageNo,
      imgDisplays: [ImageDisplay.FLOAT_TOP, ImageDisplay.SURROUND]
    })
    // 搜索匹配绘制——PERF-PLAN — Strategy B：装饰层。打印模式没有搜索高亮，
    // 走原 ctx 是 no-op；其它情况落到 decoration canvas 上，便于 search-next
    // 触发的快路径重绘只擦除 decoration、不动 base 文字。
    if (
      !this._suppressDecorationPaint &&
      !isPrintMode &&
      this.search.getSearchKeyword()
    ) {
      this.search.render(this._currentDecorationCtx ?? ctx, pageNo)
    }
    // 绘制空白占位符
    if (this.elementList.length <= 1 && !this.elementList[0]?.listId) {
      this.placeholder.render(ctx)
    }
    // 渲染行数
    if (!lineNumber.disabled) {
      this.lineNumber.render(ctx, pageNo)
    }
    // 绘制签章
    this.badge.render(ctx, pageNo)
    // 绘制涂鸦
    if (this.isGraffitiMode()) {
      this.graffiti.render(ctx, pageNo)
    }
    // PERF-PLAN — Strategy B：完成本页后 decoration 视为最新；后续若仅
    // selection / search 改动则可走快路径只重绘装饰层。
    // B-γ：用 _decorationVersion 而非常量打 tag——下次 decoration-only render
    // 命中后即可跳过重绘（同 (range, search) 状态多次重入时直接复用）。
    this._decorationDrawnPages.set(pageNo, this._decorationVersion)
    this._currentDecorationCtx = null
    this._suppressDecorationPaint = false
    if (needsClip) {
      if (decoCtx && decoCtx !== ctx) {
        decoCtx.restore()
      }
      ctx.restore()
    }
  }

  private _drawPage(payload: IDrawPagePayload) {
    this._drawPageWithContexts(
      payload,
      this.ctxList[payload.pageNo],
      this.decorationCtxList[payload.pageNo]
    )
  }

  private _recordDecorationOnly(
    payload: IDrawPagePayload,
    decoCtx: CanvasRenderingContext2D
  ) {
    const { pageNo, elementList, positionList, rowList } = payload
    decoCtx.globalAlpha = !this.zone.isMainActive()
      ? this.options.inactiveAlpha
      : 1
    decoCtx.clearRect(0, 0, this.getWidth(), this.getHeight())
    if (!this._isDecorationActive()) {
      return
    }
    this._walkDecorationRow(decoCtx, {
      elementList,
      positionList,
      rowList,
      pageNo,
      startIndex: rowList[0]?.startIndex ?? 0,
      innerWidth: this.getInnerWidth(),
      zone: EditorZone.MAIN
    })
    if (this.search.getSearchKeyword()) {
      this.search.render(decoCtx, pageNo)
    }
  }

  /**
   * PERF-PLAN — Strategy B：装饰层独立重绘。
   *
   * 调用前提：base layer 完全干净（主元素列表 / 行布局 / 位置都未变）。仅清空
   * 并重绘 decoration canvas——选区矩形、搜索匹配高亮、表格跨行 / 列范围。
   * 通过 _walkDecorationRow 复用 drawRow 里的 rangeRecord 计算逻辑，但跳过
   * 全部文字 / 控件 / 下划线 / 删除线 / 列表标记 / 表格内文字 / 浮动元素的
   * 实际 paint——典型用例下成本约为 drawRow 的 5–10%。
   *
   * 当 _isPageLayered() 为 false 时直接退化到 _drawPage——单层 canvas 没法
   * 「只擦装饰」，必须重画整页。
   */
  private _drawDecorationOnly(payload: IDrawPagePayload) {
    if (!this._isPageLayered()) {
      this._drawPage(payload)
      return
    }
    const { pageNo } = payload
    const isPrintMode = this.mode === EditorMode.PRINT
    if (isPrintMode) {
      this._drawPage(payload)
      return
    }
    const decoCtx = this.decorationCtxList[pageNo]
    const baseCtx = this.ctxList[pageNo]
    if (!decoCtx || decoCtx === baseCtx) {
      this._drawPage(payload)
      return
    }
    // B-γ：版本号缓存——同 (range, search) 状态的重入直接跳过（典型场景：
    // mousemove 抖动多次落到同一选区位置，or 拖拽穿过完全可见的多页时）。
    const cachedVersion = this._decorationDrawnPages.get(pageNo)
    if (cachedVersion === this._decorationVersion) return
    decoCtx.globalAlpha = !this.zone.isMainActive()
      ? this.options.inactiveAlpha
      : 1
    decoCtx.clearRect(0, 0, this.getWidth(), this.getHeight())
    // B-β.1：装饰层逻辑「空状态」——选区收起、无搜索、非跨行表格选区时直接
    // 跳过整轮行遍历。clearRect 已经把上一帧的内容擦掉，绘制阶段无事可做。
    if (!this._isDecorationActive()) {
      this._decorationDrawnPages.set(pageNo, this._decorationVersion)
      return
    }
    // 走 row 仅跑 rangeRecord 逻辑，不做任何文字 / 几何 paint。
    this._recordDecorationOnly(payload, decoCtx)
    this._decorationDrawnPages.set(pageNo, this._decorationVersion)
  }

  /**
   * 装饰层是否「需要画东西」——选区展开 / 跨行 / 搜索关键字均算 active。
   * 三者全空时 _drawDecorationOnly 会 clearRect 后立刻 return（B-β.1），跳过
   * 整轮 _walkDecorationRow 行遍历。
   */
  private _isDecorationActive(): boolean {
    const { startIndex, endIndex, isCrossRowCol } = this.range.getRange()
    if (startIndex !== endIndex) return true
    if (isCrossRowCol) return true
    if (this.search.getSearchKeyword()) return true
    return false
  }

  private _pageHasFloatImageOnPage(pageNo: number): boolean {
    const floatPositionList = this.position.getFloatPositionList()
    for (let i = 0; i < floatPositionList.length; i++) {
      const floatPosition = floatPositionList[i]
      if (floatPosition.pageNo !== pageNo) continue
      const element = floatPosition.element
      if (
        element.type === ElementType.IMAGE &&
        element.imgDisplay &&
        [
          ImageDisplay.SURROUND,
          ImageDisplay.FLOAT_TOP,
          ImageDisplay.FLOAT_BOTTOM
        ].includes(element.imgDisplay)
      ) {
        return true
      }
    }
    return false
  }

  private _getDirtyClipInfoForPage(
    rowList: IRow[],
    positionList: IElementPosition[]
  ): { clipTop: number; fromRowIndex: number } | null {
    if (this._dirtyRange === null) return null
    if (!rowList.length) return null
    const dirtyIndex = Math.min(this._dirtyRange.start, this._dirtyRange.end)
    const pageStart = rowList[0].startIndex
    const lastRow = rowList[rowList.length - 1]
    const lastRowLen = Math.max(1, lastRow.elementList.length)
    const pageEnd = lastRow.startIndex + lastRowLen - 1
    if (dirtyIndex < pageStart || dirtyIndex > pageEnd) return null
    let lo = 0
    let hi = rowList.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const row = rowList[mid]
      const rowLen = Math.max(1, row.elementList.length)
      const rowEnd = row.startIndex + rowLen - 1
      if (dirtyIndex < row.startIndex) {
        hi = mid - 1
      } else if (dirtyIndex > rowEnd) {
        lo = mid + 1
      } else {
        if (mid <= 0) return null
        const pos = positionList[row.startIndex]
        const y = pos?.coordinate?.leftTop?.[1]
        if (typeof y !== 'number' || !Number.isFinite(y)) return null
        const clipTop = Math.max(0, y - 2)
        return {
          clipTop,
          fromRowIndex: mid
        }
      }
    }
    return null
  }

  /** [0, pageList.length) 的索引数组——visible filter fallback 时用。 */
  private _allPageIndices(): number[] {
    const out: number[] = []
    for (let i = 0; i < this.pageRowList.length; i++) out.push(i)
    return out
  }

  /**
   * B-γ：装饰层逻辑状态变更钩子——RangeManager.setRange 与 Search.setSearchKeyword
   * 在状态变化后调用，把 _decorationVersion +1。下次 decoration-only 路径取到
   * 不匹配的 cachedVersion，正常重绘并记录新版本。
   */
  public bumpDecorationVersion() {
    this._decorationVersion++
  }

  /**
   * 仅遍历 rowList 计算 + 绘制选区矩形 + 表格跨行/列范围；与 drawRow 中选区
   * 段落（lines 3846-3900 + 3930-3948）的逻辑完全等价，但跳过其他全部 paint。
   * 递归处理表格内单元格（嵌套选区）。
   */
  private _walkDecorationRow(
    decoCtx: CanvasRenderingContext2D,
    payload: IDrawRowPayload
  ) {
    const {
      rowList,
      elementList,
      positionList,
      startIndex,
      pageNo,
      zone = EditorZone.MAIN
    } = payload
    const {
      isCrossRowCol,
      tableId,
      zone: currentZone,
      startIndex: rs,
      endIndex: re
    } = this.range.getRange()
    const positionContext = this.position.getPositionContext()
    let index = startIndex
    for (let i = 0; i < rowList.length; i++) {
      const curRow = rowList[i]
      const rangeRecord: IElementFillRect = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      }
      let tableRangeElement: IElement | null = null
      for (let j = 0; j < curRow.elementList.length; j++) {
        const element = curRow.elementList[j]
        const metrics = element.metrics
        const {
          coordinate: {
            leftTop: [x, y]
          }
        } = positionList[curRow.startIndex + j]
        if (
          element.type === ElementType.TABLE &&
          isCrossRowCol &&
          !tableRangeElement
        ) {
          rangeRecord.x = x
          rangeRecord.y = y
          tableRangeElement = element
        }
        if (
          currentZone === zone &&
          rs !== re &&
          rs <= index &&
          index <= re &&
          ((!positionContext.isTable && !element.tdId) ||
            positionContext.tdId === element.tdId)
        ) {
          if (rs === index) {
            const nextElement = elementList[rs + 1]
            if (nextElement && nextElement.value === ZERO) {
              rangeRecord.x = x + metrics.width
              rangeRecord.y = y
              rangeRecord.height = curRow.height
              rangeRecord.width += this.options.rangeMinWidth
            }
          } else {
            let rangeWidth = metrics.width
            if (rangeWidth === 0 && curRow.elementList.length === 1) {
              rangeWidth = this.options.rangeMinWidth
            }
            if (!rangeRecord.width) {
              rangeRecord.x = x
              rangeRecord.y = y
              rangeRecord.height = curRow.height
            }
            rangeRecord.width += rangeWidth
          }
        }
        // 嵌套表格——处理单元格内选区。打印模式与外层一致跳过。
        if (
          element.type === ElementType.TABLE &&
          !element.hide &&
          element.trList
        ) {
          for (let t = 0; t < element.trList.length; t++) {
            const tr = element.trList[t]
            for (let d = 0; d < tr.tdList.length; d++) {
              const td = tr.tdList[d]
              if (!td.rowList || !td.positionList) continue
              this._walkDecorationRow(decoCtx, {
                elementList: td.value,
                positionList: td.positionList,
                rowList: td.rowList,
                pageNo,
                startIndex: 0,
                innerWidth: payload.innerWidth,
                zone
              })
            }
          }
        }
        index++
      }
      if (rangeRecord.width && rangeRecord.height) {
        const { x, y, width, height } = rangeRecord
        this.range.render(decoCtx, x, y, width, height)
      }
      if (
        isCrossRowCol &&
        tableRangeElement &&
        tableRangeElement.id === tableId
      ) {
        const {
          coordinate: {
            leftTop: [x, y]
          }
        } = positionList[curRow.startIndex]
        this.tableParticle.drawRange(decoCtx, tableRangeElement, x, y)
      }
    }
  }

  private _disconnectLazyRender() {
    this.lazyRenderIntersectionObserver?.disconnect()
  }

  private _getPageLayoutSignatures(
    pageRowList: IRow[][] = this.pageRowList
  ): IPageLayoutSignature[] {
    return pageRowList.map(rowList => {
      if (!rowList.length) {
        return {
          firstRowStartIndex: -1,
          lastRowStartIndex: -1,
          rowCount: 0,
          rowHeightSum: 0
        }
      }
      let rowHeightSum = 0
      for (let i = 0; i < rowList.length; i++) {
        const row = rowList[i]
        rowHeightSum += row.height + (row.offsetY || 0)
      }
      return {
        firstRowStartIndex: rowList[0].startIndex,
        lastRowStartIndex: rowList[rowList.length - 1].startIndex,
        rowCount: rowList.length,
        rowHeightSum: +rowHeightSum.toFixed(2)
      }
    })
  }

  private _findFirstShiftedPage(
    prev: IPageLayoutSignature[],
    cur: IPageLayoutSignature[]
  ): number | null {
    const sharedCount = Math.min(prev.length, cur.length)
    for (let i = 0; i < sharedCount; i++) {
      const a = prev[i]
      const b = cur[i]
      if (
        a.firstRowStartIndex !== b.firstRowStartIndex ||
        a.lastRowStartIndex !== b.lastRowStartIndex ||
        a.rowCount !== b.rowCount ||
        Math.abs(a.rowHeightSum - b.rowHeightSum) > 0.01
      ) {
        return i
      }
    }
    if (prev.length !== cur.length) return sharedCount
    return null
  }

  private _collectVisibleSyncPages(pageCount: number): Set<number> {
    const syncPages = new Set<number>()
    const overscan = Math.max(0, Math.floor(this.options.pagePaintOverscan))
    for (let i = 0; i < this.visiblePageNoList.length; i++) {
      const visiblePageNo = this.visiblePageNoList[i]
      if (visiblePageNo < 0 || visiblePageNo >= pageCount) continue
      const start = Math.max(0, visiblePageNo - overscan)
      const end = Math.min(pageCount - 1, visiblePageNo + overscan)
      for (let pageNo = start; pageNo <= end; pageNo++) {
        syncPages.add(pageNo)
      }
    }
    return syncPages
  }

  private _buildPagePaintPlan(): IPagePaintPlan | null {
    if (!this.getIsPagingMode()) return null
    if (this.options.pagePaintStrategy === 'full') return null
    if (this.visiblePageNoList.length === 0) return null
    if (this._prevPageLayoutSignatures === null) return null
    const pageCount = this.pageRowList.length
    const syncPages = this._collectVisibleSyncPages(pageCount)
    const curSignatures = this._getPageLayoutSignatures()
    const firstShiftedPage = this._findFirstShiftedPage(
      this._prevPageLayoutSignatures,
      curSignatures
    )
    const deferredPages = new Set<number>()
    if (firstShiftedPage !== null) {
      for (let i = firstShiftedPage; i < pageCount; i++) {
        deferredPages.add(i)
      }
    }
    if (this._dirtyRange !== null) {
      const positionList = this.position.getOriginalMainPositionList()
      const startPos =
        positionList[Math.min(this._dirtyRange.start, positionList.length - 1)]
      if (startPos) {
        syncPages.add(startPos.pageNo)
        deferredPages.delete(startPos.pageNo)
      }
      const endPos =
        positionList[Math.min(this._dirtyRange.end, positionList.length - 1)]
      if (endPos) {
        syncPages.add(endPos.pageNo)
        deferredPages.delete(endPos.pageNo)
      }
    }
    for (const pageNo of syncPages) {
      deferredPages.delete(pageNo)
    }
    for (let i = 0; i < pageCount; i++) {
      if (!syncPages.has(i) && !deferredPages.has(i)) {
        deferredPages.add(i)
      }
    }
    return {
      firstShiftedPage,
      syncPages,
      deferredPages
    }
  }

  private _getMainIndexPageNo(index: number): number | null {
    const positionList = this.position.getOriginalMainPositionList()
    if (!positionList.length) return null
    const safeIndex = Math.min(
      Math.max(0, Math.floor(index)),
      positionList.length - 1
    )
    return positionList[safeIndex]?.pageNo ?? null
  }

  private _collectPagesNeedingPaint(
    paintPlan: IPagePaintPlan,
    curIndex: number | undefined
  ): Set<number> {
    const out = new Set<number>()
    const pageCount = this.pageRowList.length
    if (paintPlan.firstShiftedPage !== null) {
      for (let i = paintPlan.firstShiftedPage; i < pageCount; i++) {
        out.add(i)
      }
    }
    if (this._dirtyRange !== null) {
      const startPage = this._getMainIndexPageNo(this._dirtyRange.start)
      const endPage = this._getMainIndexPageNo(this._dirtyRange.end)
      if (startPage !== null && endPage !== null) {
        const lo = Math.min(startPage, endPage)
        const hi = Math.max(startPage, endPage)
        for (let i = lo; i <= hi; i++) out.add(i)
      } else if (startPage !== null) {
        out.add(startPage)
      } else if (endPage !== null) {
        out.add(endPage)
      }
    }
    if (curIndex !== undefined) {
      const cursorPage = this._getMainIndexPageNo(curIndex)
      if (cursorPage !== null) out.add(cursorPage)
    }
    return out
  }

  private _lazyRender(
    deferredPages: Set<number>,
    syncPages: Set<number> | null = null
  ) {
    const positionList = this.position.getOriginalMainPositionList()
    const elementList = this.getOriginalMainElementList()
    this._disconnectLazyRender()
    if (!deferredPages.size) return
    // Backward-compatible helper behavior for direct callers in tests and
    // legacy code: if no explicit sync set is provided, treat the requested
    // pages plus the current viewport pages as "must paint now", and observe
    // only the remainder.
    if (syncPages === null) {
      const immediatePages = new Set<number>(deferredPages)
      const pageCount = this.pageRowList.length
      for (const pageNo of this._collectVisibleSyncPages(pageCount)) {
        immediatePages.add(pageNo)
      }
      for (const pageNo of immediatePages) {
        if (!this.pageRowList[pageNo]) continue
        this.paintPageOnDom({
          elementList,
          positionList,
          rowList: this.pageRowList[pageNo],
          pageNo
        })
        this._drawnPages.add(pageNo)
        deferredPages.delete(pageNo)
      }
      if (!deferredPages.size) return
    }
    this.lazyRenderIntersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = Number((<HTMLCanvasElement>entry.target).dataset.index)
          if (!deferredPages.has(index) || !this.pageRowList[index]) return
          this.paintPageOnDom({
            elementList,
            positionList,
            rowList: this.pageRowList[index],
            pageNo: index
          })
          this._drawnPages.add(index)
          this.lazyRenderIntersectionObserver?.unobserve(entry.target)
        }
      })
    })
    deferredPages.forEach(index => {
      const page = this.pageList[index]
      if (page) {
        this.lazyRenderIntersectionObserver!.observe(page)
      }
    })
  }

  private _immediateRender(syncPages: Set<number> | null) {
    const positionList = this.position.getOriginalMainPositionList()
    const elementList = this.getOriginalMainElementList()
    const pageIndices =
      syncPages === null
        ? this._allPageIndices()
        : Array.from(syncPages).sort((a, b) => a - b)
    for (const i of pageIndices) {
      if (!this.pageRowList[i]) continue
      this.paintPageOnDom({
        elementList,
        positionList,
        rowList: this.pageRowList[i],
        pageNo: i
      })
      this._drawnPages.add(i)
    }
  }

  /**
   * 合并 payload 后请求一次 rAF 渲染。
   *
   * 用于按键密集的入口（input、keydown 等），把同一帧内的多次 keystroke
   * 合并为单次 layout/paint，避免每个字符触发一次全量回流（详见
   * PERF-PLAN §1.1）。
   *
   * 合并语义：
   *  - curIndex / isLazy / isInit / isFirstRender / isSourceHistory：取最新值
   *  - isSubmitHistory / isCompute / isSetCursor：OR 合并（任一调用方需要即生效），
   *    保证 history、layout、cursor 不会因合并被吞掉
   *  - remoteDirtyRange：取并集（CRDT 6.2c 占位）
   *
   * 同步路径仍可走 {@link render}（首次渲染 / setValue / 打印等）。
   */
  public scheduleRender(payload?: IDrawOption) {
    this._pendingRenderPayload = this._mergeRenderPayload(
      this._pendingRenderPayload,
      payload
    )
    if (this._pendingRenderFrameId !== null) return
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) =>
            setTimeout(() => cb(performance.now()), 16) as unknown as number
    this._pendingRenderFrameId = raf(() => this._flushScheduledRender())
  }

  /** 立即清空 rAF 队列；同步代码路径需要立刻看到最新视图时使用。 */
  public flushScheduledRender() {
    if (this._pendingRenderFrameId === null) return
    const caf =
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : clearTimeout
    caf(this._pendingRenderFrameId as number)
    this._pendingRenderFrameId = null
    this._flushScheduledRender()
  }

  private _flushScheduledRender() {
    const payload = this._pendingRenderPayload
    this._pendingRenderPayload = null
    this._pendingRenderFrameId = null
    if (payload) this.render(payload)
  }

  private _mergeRenderPayload(
    a: IDrawOption | null,
    b: IDrawOption | undefined
  ): IDrawOption {
    if (!a) return { ...(b || {}) }
    if (!b) return a
    // OR：任一为 true 即取 true（默认 true 的字段缺省视为 true）
    const orTrue = (
      x: boolean | undefined,
      y: boolean | undefined
    ): boolean | undefined => {
      // 仅当两者都显式 false 时才保留 false
      if (x === false && y === false) return false
      if (x === undefined && y === undefined) return undefined
      return (x ?? true) || (y ?? true)
    }
    const merged: IDrawOption = {
      // last-write-wins
      curIndex: b.curIndex !== undefined ? b.curIndex : a.curIndex,
      isLazy: b.isLazy !== undefined ? b.isLazy : a.isLazy,
      isInit: b.isInit !== undefined ? b.isInit : a.isInit,
      isFirstRender:
        b.isFirstRender !== undefined ? b.isFirstRender : a.isFirstRender,
      isSourceHistory:
        b.isSourceHistory !== undefined ? b.isSourceHistory : a.isSourceHistory,
      // OR 合并
      isSubmitHistory: orTrue(a.isSubmitHistory, b.isSubmitHistory),
      isCompute: orTrue(a.isCompute, b.isCompute),
      isSetCursor: orTrue(a.isSetCursor, b.isSetCursor),
      // AND：只有当所有合并源都标注 isTextInput 时才视为输入合批；
      // 任一非输入动作进入本帧即按非输入处理（先 flush 当前 batch、再正常 submit）
      isTextInput:
        a.isTextInput === true && b.isTextInput === true ? true : undefined,
      // PERF-PLAN — Strategy B：装饰层快路径同样用 AND 合并——只要一个 caller
      // 是「全量重绘」级别的请求（typing / 缩放 / 字体改动），本帧必须走完整
      // render；将 isDecorationOnly 收敛到 false 是安全降级。
      isDecorationOnly:
        a.isDecorationOnly === true && b.isDecorationOnly === true
          ? true
          : undefined
    }
    // remoteDirtyRange：取区间并集
    if (a.remoteDirtyRange || b.remoteDirtyRange) {
      const ar = a.remoteDirtyRange
      const br = b.remoteDirtyRange
      if (ar && br) {
        merged.remoteDirtyRange = {
          start: Math.min(ar.start, br.start),
          end: Math.max(ar.end, br.end)
        }
      } else {
        merged.remoteDirtyRange = ar || br
      }
    }
    return merged
  }

  public render(payload?: IDrawOption) {
    // 同步 render 进入时若仍有 rAF 队列：合并并取消，确保后续调用看到的视图与
    // history 是最新的（避免被即将到来的 rAF 回调覆盖）。
    if (this._pendingRenderPayload || this._pendingRenderFrameId !== null) {
      if (this._pendingRenderPayload) {
        payload = this._mergeRenderPayload(this._pendingRenderPayload, payload)
        this._pendingRenderPayload = null
      }
      if (this._pendingRenderFrameId !== null) {
        const caf =
          typeof cancelAnimationFrame === 'function'
            ? cancelAnimationFrame
            : clearTimeout
        caf(this._pendingRenderFrameId as number)
        this._pendingRenderFrameId = null
      }
    }
    this.renderCount++
    // PERF-PLAN follow-up：渲染阶段计时桩（__perfTraceRender 隐藏选项开启）。
    // 仅在标志位开时构造，正常路径完全无开销（trace.mark / trace.flush 都是 no-op）。
    const trace = this._isPerfTraceRenderEnabled()
      ? this._createRenderTrace()
      : null
    const { header, footer } = this.options
    const {
      isSubmitHistory = true,
      isSetCursor = true,
      isCompute = true,
      isLazy = true,
      isInit = false,
      isSourceHistory = false,
      isFirstRender = false,
      isTextInput = false,
      isDecorationOnly = false
    } = payload || {}
    let { curIndex } = payload || {}
    const innerWidth = this.getInnerWidth()
    const isPagingMode = this.getIsPagingMode()
    // 缓存当前页数信息
    const oldPageSize = this.pageRowList.length

    // PERF-PLAN — Strategy B：装饰层独立重绘快路径。
    // 调用方显式标注 isDecorationOnly 时——典型来自 selection drag (mousemove) /
    // search-next/pre——若条件满足则走极简路径：只擦除 decoration canvas + 重画
    // 选区矩形 + 搜索高亮。完全跳过 computeRowList / computePositionList /
    // _drawPage 全套——成本约为 base 重绘的 5–10%。
    //
    // 安全条件：必须分层、非首次渲染、有有效 pageRowList、无未消化的 dirty 文本
    // 改动、非打印模式。任一不满足则降级为常规 render（行为不变）。
    if (
      isDecorationOnly &&
      !isCompute &&
      this._isPageLayered() &&
      !isInit &&
      !isFirstRender &&
      this.pageRowList.length > 0 &&
      this._dirtyRange === null &&
      this.mode !== EditorMode.PRINT
    ) {
      // B-γ：版本号由 RangeManager.setRange / Search.setSearchKeyword /
      // Search.searchNavigatePre/Next 在状态变更时 bump——这里不再无条件 ++，
      // 避免相同 (range, search) 状态的同帧重入也成为 cache miss。
      const positionList = this.position.getOriginalMainPositionList()
      const elementList = this.getOriginalMainElementList()
      // B-β.2：分页模式下只重绘可见页（mousemove drag 期间通常仅 2-3 页可见，
      // 而 _drawDecorationOnly 仍按 pageRowList 全量遍历是浪费）。
      // 连续模式 / 首帧未观察到 visiblePageNoList 时退回全量遍历。
      const useVisibleFilter = isPagingMode && this.visiblePageNoList.length > 0
      const pageIndices = useVisibleFilter
        ? this.visiblePageNoList
        : this._allPageIndices()
      for (const i of pageIndices) {
        if (!this.pageRowList[i] || !this.pageList[i]) continue
        this.paintDecorationOnDom({
          elementList,
          positionList,
          rowList: this.pageRowList[i],
          pageNo: i
        })
      }
      // setCursor / history 都不应在 decoration-only 路径上跑——decoration 不
      // 改变光标位置（光标位置由 selection drag 期间另行 setRange 触发）。
      // history 同理——选区拖拽不需要进入 undo stack。
      return
    }
    // 计算文档信息
    if (isCompute) {
      // 主元素列表是否需要重新布局：仅当当前编辑区域为 MAIN 或主列表 dirty
      // 已经被显式标记时才走全量。换言之，在 4-page 主文档场景下，用户在
      // 页眉/页脚里输入不会触发主体的 N 元素 computeRowList / computePositionList /
      // area.compute() —— 这些都依赖主元素，主元素未改时它们的结果是稳定的。
      const activeZone = this.zone.getZone()
      const isMainZone = activeZone === EditorZone.MAIN
      // _skipMainRowCompute 由 setPageScale 在已就地缩放 rowList 后设置——此时
      // 即便用户在 HEADER/FOOTER 区也必须刷新主体的 pageRowList / positionList，
      // 否则光标位置会停留在旧 scale 下、与已缩放的 rowList 出现 ½× 错位。
      const mainNeedsCompute =
        isMainZone ||
        this._dirtyRange !== null ||
        this._prevPageRowCounts === null ||
        this._skipMainRowCompute
      // 清空浮动元素位置信息（仅当本帧确实会重新布局主体时才清空，否则保留上次缓存）
      // PERF-PLAN §2.3：增量路径下浮动列表交给 computePositionListIncremental 自行
      // 按 dirty 边界过滤，因此这里不能无条件清空——延后到 _tryBuildResumeFrom 决定
      // 之后再处理。
      if (mainNeedsCompute) {
        // 保留：下方 mainNeedsCompute 块里再按是否走增量决定是否清空。
      }
      if (isPagingMode) {
        // 页眉信息：当前在页眉区或页眉 dirty 或主体重新布局时计算
        if (
          !header.disabled &&
          (this._headerDirty ||
            activeZone === EditorZone.HEADER ||
            mainNeedsCompute)
        ) {
          this.header.compute()
          this._headerDirty = false
        }
        // 页脚信息：同上
        if (
          !footer.disabled &&
          (this._footerDirty ||
            activeZone === EditorZone.FOOTER ||
            mainNeedsCompute)
        ) {
          this.footer.compute()
          this._footerDirty = false
        }
      }
      if (mainNeedsCompute && this._skipMainRowCompute) {
        // setPageScale 已在外层把 rowList / element.metrics / table cache 等
        // scale-相关字段就地乘以 ratio。computeRowList 在 25 页文档上是
        // setPageScale 的主要耗时来源（O(N) 元素遍历 + 类型分支 + measureText
        // 缓存命中开销 + listStyle / surround / 分页判定），但实际产生的输出
        // 等价于「按 ratio 缩放上一帧 rowList」——直接跳过，让下面 O(N) 算术
        // 依赖（pageRowList / positionList / area）从已就地缩放的 rowList 重派生。
        this._mainLayoutSig = this._buildLayoutSig({ isPagingMode, innerWidth })
        // 浮动元素 list 中存的是按旧 scale 算出的像素坐标——清空后由
        // computePositionList 从元素重新挑出 SURROUND/FLOAT_TOP/FLOAT_BOTTOM
        // 在新 scale 下重建。
        this.position.setFloatPositionList([])
        this.pageRowList = this._computePageList()
        this.position.computePositionList()
        this.area.compute()
        if (!this.isPrintMode()) {
          const searchKeyword = this.search.getSearchKeyword()
          if (searchKeyword) {
            this.search.compute(searchKeyword)
          }
          this.control.computeHighlightList()
        }
        if (this.isGraffitiMode()) {
          this.graffiti.compute()
        }
      } else if (mainNeedsCompute) {
        // 行信息
        const margins = this.getMargins()
        const pageHeight = this.getHeight()
        const extraHeight = this.header.getExtraHeight()
        const mainOuterHeight = this.getMainOuterHeight()
        // 行布局起点为第一列的左上角；单列时与页面左上一致
        const startX = this.getColumnStartX(0)
        const startY = margins[0] + extraHeight
        // PERF-PLAN follow-up：当主列表无 SURROUND 浮动元素时，skip O(N) 扫描——
        // 维护一个增量计数缓存，spliceElementList 同步更新；首次或失效后重新统计。
        if (this._mainSurroundCount === null) {
          let count = 0
          for (let e = 0; e < this.elementList.length; e++) {
            if (this.elementList[e].imgDisplay === ImageDisplay.SURROUND)
              count++
          }
          this._mainSurroundCount = count
        }
        const surroundElementList =
          this._mainSurroundCount === 0
            ? []
            : pickSurroundElementList(this.elementList)
        // PERF-PLAN §2.2 / Phase 2B：在「上一帧 row checkpoint 仍然有效 + 已有 dirty
        // 区间提示 + 布局签名未变 + 至少存在可保留的前缀行」时启用增量布局，
        // 跳过 dirty 起点之前的 measureText / 包装判定 / surround 计算等 O(N) 工作。
        const resumeFrom = this._tryBuildResumeFrom({
          isPagingMode,
          innerWidth
        })
        // 浮动元素列表清空策略：全量路径下按既有逻辑清空；增量路径下交给
        // computePositionListIncremental 按 dirty 边界过滤，避免误删 prefix 浮动。
        if (!resumeFrom) {
          this.position.setFloatPositionList([])
        }
        // PERF-PLAN §2.3：incremental computeRowList 的循环在第一次迭代时仍把
        // curRow 指向「前缀末尾行」（rowList[length-1]），如果新元素 isWrap=false
        // 就会被 push 进该行——前缀末尾行的 elementList 因此可能被原地扩展。
        // 我们在 computeRowList 之前先快照其长度，事后比对：长度变了说明这一行
        // 的位置缓存不再可信，position 增量恢复点必须包含该行。
        const lastPrefixRow = resumeFrom
          ? resumeFrom.prefixRowList[resumeFrom.prefixRowList.length - 1]
          : null
        const lastPrefixRowOriginalCount =
          lastPrefixRow?.elementList.length ?? 0
        this.rowList = this.computeRowList({
          startX,
          startY,
          pageHeight,
          mainOuterHeight,
          isPagingMode,
          innerWidth,
          surroundElementList,
          elementList: this.elementList,
          checkpointSink: this._mainRowCheckpoints,
          resumeFrom: resumeFrom ?? undefined
        })
        trace?.mark(
          resumeFrom?.convergenceTarget?.matched
            ? 'computeRowList(incr+converged)'
            : resumeFrom
              ? 'computeRowList(incr)'
              : 'computeRowList(full)'
        )
        // PERF-PLAN §2.2 / Phase 2B：收敛接驳——computeRowList 命中收敛后只
        // 重排到匹配点。把 oldRowsAfterCut[match+1..] 作为尾部接回（按 dirty
        // 处的元素索引漂移调整 startIndex），并把对应的旧 checkpoints 也接回，
        // 与 _mainRowCheckpoints 保持平行索引。
        // 同时记录复用窗口（fromNewRowGlobalIndex / deltaElems），稍后用于
        // 收敛尾部 positionList 复用——前提是 pagination 稳定。
        let convergedReuseInfo: {
          fromNewRowGlobalIndex: number
          deltaElems: number
        } | null = null
        if (resumeFrom && resumeFrom.convergenceTarget.matched !== null) {
          const target = resumeFrom.convergenceTarget
          const matchedIdx = target.matched!.atOldIdx
          const reusedRows = target.oldRowsAfterCut.slice(matchedIdx + 1)
          const reusedCkpts = target.oldCheckpointsAfterCut.slice(
            matchedIdx + 1
          )
          if (reusedRows.length) {
            // deltaElems：dirty 处实际位移量。匹配的旧行 vs 增量产出的同 logical
            // 行——后者的 startIndex 已是 NEW 坐标，前者是 OLD。
            const matchedOldRow = target.oldRowsAfterCut[matchedIdx]
            const matchedNewRow = this.rowList[this.rowList.length - 1]
            const deltaElems =
              matchedNewRow.startIndex - matchedOldRow.startIndex
            const baseRowIdx = this.rowList.length
            for (let r = 0; r < reusedRows.length; r++) {
              const old = reusedRows[r]
              // 浅克隆——保留行内元素引用 / metrics，但改写 startIndex / rowIndex
              // 到新坐标，避免污染上一帧 rowList 引用。
              this.rowList.push({
                ...old,
                startIndex: old.startIndex + deltaElems,
                rowIndex: baseRowIdx + r
              })
            }
            // checkpoints 也要并行扩展——下一帧的 _tryBuildResumeFrom 会要求
            // checkpointSink.length === rowList.length。旧 checkpoints 在收敛
            // 后仍然有效（state 仅依赖 dirty 之前的元素，未变）。
            if (this._mainRowCheckpoints.length < this.rowList.length) {
              for (
                let r = 0;
                r < reusedCkpts.length &&
                this._mainRowCheckpoints.length < this.rowList.length;
                r++
              ) {
                this._mainRowCheckpoints.push(reusedCkpts[r])
              }
            }
            // baseRowIdx 是「第一个被复用的旧行」在 NEW rowList 中的全局 index。
            convergedReuseInfo = {
              fromNewRowGlobalIndex: baseRowIdx,
              deltaElems
            }
          }
        }
        // 验证桩（PERF-PLAN §2.2 「validation harness」）：若启用，则同时跑一遍
        // 全量布局并按 IRow 关键字段 diff，发现增量分支结果与全量不一致时立刻
        // 上报错误。仅供 dev / 回归验证使用，正常生产路径请保持关闭。
        if (resumeFrom && this._isPerfValidateLayoutEnabled()) {
          this._validateIncrementalLayout({
            startX,
            startY,
            pageHeight,
            mainOuterHeight,
            isPagingMode,
            innerWidth,
            surroundElementList: pickSurroundElementList(this.elementList),
            elementList: this.elementList
          })
        }
        // 落盘本次布局签名，供下一帧增量决策使用
        this._mainLayoutSig = this._buildLayoutSig({ isPagingMode, innerWidth })
        // 页面信息
        this.pageRowList = this._computePageList()
        trace?.mark('_computePageList')
        // 位置信息——PERF-PLAN §2.3 增量分支：仅当 §2.2 的增量路径成立时启用，
        // 与 row prefix 同步保留 positionList prefix，省下 ~O(N) 对象构造。
        if (resumeFrom && lastPrefixRow) {
          // 前缀末尾行被原地扩展（curRow.elementList.push）→ 该行的 position
          // 缓存不再准确，position 恢复点必须前移一行（包含该行的全部元素）。
          // 否则前缀位置都是稳定的，按 §2.2 给出的 (fromRowGlobalIndex,
          // fromElementIndex) 直接走。
          const lastPrefixMutated =
            lastPrefixRow.elementList.length !== lastPrefixRowOriginalCount
          // 收敛尾部 position 复用：仅当行数收敛 + pagination 稳定（每页 row 数不变）
          // 时启用——此前提下被复用旧行的 pageNo / coordinate 全部字节相等，只需
          // 重写 .index。在用户的 25 页 typing 场景中，这一支把 computePositionList
          // 从 ~25-130ms 降回 ~1-3ms。
          const paginationStable =
            convergedReuseInfo !== null &&
            this._prevPageRowCounts !== null &&
            this._prevPageRowCounts.length === this.pageRowList.length &&
            this._prevPageRowCounts.every(
              (n, idx) => n === this.pageRowList[idx].length
            )
          const convergedReuse = paginationStable
            ? convergedReuseInfo
            : undefined
          if (lastPrefixMutated) {
            this.position.computePositionListIncremental({
              fromRowGlobalIndex: resumeFrom.prefixRowList.length - 1,
              fromElementIndex: lastPrefixRow.startIndex,
              convergedReuse: convergedReuse ?? undefined
            })
          } else {
            this.position.computePositionListIncremental({
              fromRowGlobalIndex: resumeFrom.prefixRowList.length,
              fromElementIndex: resumeFrom.startElementIndex,
              convergedReuse: convergedReuse ?? undefined
            })
          }
        } else {
          this.position.computePositionList()
        }
        trace?.mark(
          resumeFrom ? 'computePositionList(incr)' : 'computePositionList(full)'
        )
        // 区域信息
        this.area.compute()
        trace?.mark('area.compute')
        if (!this.isPrintMode()) {
          // 搜索信息
          const searchKeyword = this.search.getSearchKeyword()
          if (searchKeyword) {
            this.search.compute(searchKeyword)
          }
          // 控件关键词高亮
          this.control.computeHighlightList()
        }
        // 涂鸦信息
        if (this.isGraffitiMode()) {
          this.graffiti.compute()
        }
        trace?.mark('search+control+graffiti')
      }
    }
    // 清除光标等副作用
    this.imageObserver.clearAll()
    this.cursor.recoveryCursor()
    // 创建纸张
    for (let i = 0; i < this.pageRowList.length; i++) {
      if (!this.pageList[i]) {
        this._createPage(i)
      }
    }
    // 移除多余页
    const curPageCount = this.pageRowList.length
    const prePageCount = this.pageList.length
    if (prePageCount > curPageCount) {
      const deleteCount = prePageCount - curPageCount
      this.ctxList.splice(curPageCount, deleteCount)
      const removedBases = this.pageList.splice(curPageCount, deleteCount)
      this.decorationCtxList.splice(curPageCount, deleteCount)
      this.decorationCanvasList.splice(curPageCount, deleteCount)
      const removedWrappers = this.pageWrapperList.splice(
        curPageCount,
        deleteCount
      )
      // 优先移除 wrapper（带走 base + decoration）；单层模式 wrapper === base
      // 直接移除 base 即可——为兼容旧引用关系两条路径都 try。
      for (let i = 0; i < removedBases.length; i++) {
        const base = removedBases[i]
        const wrapper = removedWrappers[i]
        if (wrapper && wrapper !== (base as unknown as HTMLDivElement)) {
          wrapper.remove()
        } else {
          base.remove()
        }
      }
      // 同步移除已绘制集合中的越界条目
      for (const idx of Array.from(this._drawnPages)) {
        if (idx >= curPageCount) this._drawnPages.delete(idx)
      }
      for (const idx of Array.from(this._decorationDrawnPages.keys())) {
        if (idx >= curPageCount) this._decorationDrawnPages.delete(idx)
      }
    }
    const pagePaintPlan =
      isPagingMode &&
      isLazy &&
      !isInit &&
      !isFirstRender &&
      !this._skipMainRowCompute
        ? this._buildPagePaintPlan()
        : null
    this._paintPlanFirstShiftedPage = pagePaintPlan?.firstShiftedPage ?? null
    this._drawnPages.clear()
    trace?.mark('pre-paint')
    this._disconnectLazyRender()
    const isPaintFilterEligible =
      pagePaintPlan &&
      this._dirtyRange !== null &&
      !this._isDecorationActive() &&
      this.mode !== EditorMode.PRINT
    let effectiveSyncPages = pagePaintPlan?.syncPages ?? null
    let effectiveDeferredPages = pagePaintPlan?.deferredPages ?? null
    if (pagePaintPlan && isPaintFilterEligible) {
      const needed = this._collectPagesNeedingPaint(pagePaintPlan, curIndex)
      const filteredSync = new Set<number>()
      for (const pageNo of pagePaintPlan.syncPages) {
        if (needed.has(pageNo)) filteredSync.add(pageNo)
      }
      // 保底：避免由于边界条件导致可见页一个都不画。
      if (filteredSync.size) {
        effectiveSyncPages = filteredSync
        const filteredDeferred = new Set<number>()
        for (const pageNo of pagePaintPlan.deferredPages) {
          if (needed.has(pageNo)) filteredDeferred.add(pageNo)
        }
        effectiveDeferredPages = filteredDeferred
      }
    }
    if (trace && pagePaintPlan) {
      console.log(
        `[PerfTrace] paintPlan shifted=${
          pagePaintPlan.firstShiftedPage ?? 'none'
        } sync=${(effectiveSyncPages ?? pagePaintPlan.syncPages).size} deferred=${(effectiveDeferredPages ?? pagePaintPlan.deferredPages).size}`,
        {
          syncPages: Array.from(
            effectiveSyncPages ?? pagePaintPlan.syncPages
          ).sort((a, b) => a - b),
          deferredPages: Array.from(
            effectiveDeferredPages ?? pagePaintPlan.deferredPages
          ).sort((a, b) => a - b)
        }
      )
    }
    if (pagePaintPlan) {
      this._immediateRender(effectiveSyncPages)
      this._lazyRender(
        effectiveDeferredPages ?? new Set<number>(),
        effectiveSyncPages
      )
    } else {
      // 连续页因为有高度的变化会导致 canvas 渲染空白，需立即渲染，否则会出现闪动。
      // paging 模式在 fallback/full 策略下也同步渲染全部页面，避免可见页等待 observer 回调。
      this._immediateRender(null)
    }
    trace?.mark('paint')
    // 落盘本次 row 数与清除 dirty 提示，供下次渲染做差分
    this._prevPageRowCounts = this.pageRowList.map(rl => rl.length)
    this._prevPageLayoutSignatures = this._getPageLayoutSignatures()
    this.clearDirtyRange()
    // 光标重绘
    if (isSetCursor) {
      curIndex = this.setCursor(curIndex)
    } else if (this.range.getIsSelection()) {
      // 存在选区时仅定位避免事件无法捕获
      this.cursor.focus()
    }
    // 历史记录用于undo、redo（非首次渲染内容变更 || 第一次存在光标时）
    if (
      (isSubmitHistory && !isFirstRender) ||
      (curIndex !== undefined && this.historyManager.isStackEmpty())
    ) {
      // 输入合批：连续文本输入仅在 idle / 非输入动作 / undo·redo 时落盘单个 snapshot
      // 非首次（栈非空）且明确为输入路径时启用 batch；否则正常 submit（必要时
      // 先 flush 已挂起的 typing batch，确保 history 顺序正确）。
      // historyTypingBatchMs<=0 时关闭合批，保留每键一份 snapshot 的旧语义（默认）。
      const batchMs = this.options.historyTypingBatchMs
      const canBatch =
        isTextInput && batchMs > 0 && !this.historyManager.isStackEmpty()
      if (canBatch) {
        this._typingBatchActive = true
        this._typingBatchLastCurIndex = curIndex
        this._refreshTypingBatchTimer()
      } else {
        this.flushTypingBatch()
        this.submitHistory(curIndex)
      }
    }
    trace?.mark('history')
    trace?.flush()
    // 信息变动回调（使用微任务，避免一次宏任务排队带来的尾部开销，
    // 同时让范围样式 / tableTool / contentChange 等回调与本次渲染落在同一帧内）
    queueMicrotask(() => {
      // 选区样式
      this.range.setRangeStyle()
      // 重新唤起弹窗类控件
      if (isCompute && this.control.getActiveControl()) {
        this.control.reAwakeControl()
      }
      // 表格工具重新渲染
      if (
        isCompute &&
        !this.isReadonly() &&
        this.position.getPositionContext().isTable
      ) {
        this.tableTool.render()
      }
      // 页眉指示器重新渲染
      if (isCompute && !this.zone.isMainActive()) {
        this.zone.drawZoneIndicator()
      }
      // 页数改变
      if (oldPageSize !== this.pageRowList.length) {
        if (this.listener.pageSizeChange) {
          this.listener.pageSizeChange(this.pageRowList.length)
        }
        if (this.eventBus.isSubscribe('pageSizeChange')) {
          this.eventBus.emit('pageSizeChange', this.pageRowList.length)
        }
      }
      // 文档内容改变
      if ((isSubmitHistory || isSourceHistory) && !isInit) {
        if (this.listener.contentChange) {
          this.listener.contentChange()
        }
        if (this.eventBus.isSubscribe('contentChange')) {
          this.eventBus.emit('contentChange')
        }
      }
    })
  }

  public setCursor(curIndex: number | undefined) {
    const positionContext = this.position.getPositionContext()
    const positionList = this.position.getPositionList()
    if (positionContext.isTable) {
      const { index, trIndex, tdIndex } = positionContext
      const elementList = this.getOriginalElementList()
      const tablePositionList =
        elementList[index!].trList?.[trIndex!].tdList[tdIndex!].positionList
      if (curIndex === undefined && tablePositionList) {
        curIndex = tablePositionList.length - 1
      }
      const tablePosition = tablePositionList?.[curIndex!]
      this.position.setCursorPosition(tablePosition || null)
    } else {
      this.position.setCursorPosition(
        curIndex !== undefined ? positionList[curIndex] : null
      )
    }
    // 定位到图片元素并且位置发生变化
    let isShowCursor = true
    if (
      curIndex !== undefined &&
      positionContext.isImage &&
      positionContext.isDirectHit
    ) {
      const elementList = this.getElementList()
      const element = elementList[curIndex]
      if (IMAGE_ELEMENT_TYPE.includes(element.type!)) {
        isShowCursor = false
        const position = this.position.getCursorPosition()
        this.previewer.updateResizer(element, position)
      }
    }
    this.cursor.drawCursor({
      isShow: isShowCursor
    })
    return curIndex
  }

  /**
   * 将连续文本输入合并为单个 history snapshot（PERF-PLAN §1.2）。
   *
   * 合批生效后，每次 keystroke 不再支付 9× deepClone 的代价；500ms 闲置或被
   * 任何非输入动作 / undo / redo 中断时，会调用 {@link flushTypingBatch}
   * 落盘一次最终的 snapshot。语义上等价于 Office/Google Docs 的「按词撤销」。
   */
  public isTypingBatchActive(): boolean {
    return this._typingBatchActive
  }

  /** 立即将挂起的输入合批落盘（push 一份 history snapshot）。 */
  public flushTypingBatch() {
    if (!this._typingBatchActive) return
    const curIndex = this._typingBatchLastCurIndex
    this._typingBatchActive = false
    this._typingBatchLastCurIndex = undefined
    if (this._typingBatchTimer !== null) {
      clearTimeout(this._typingBatchTimer)
      this._typingBatchTimer = null
    }
    this.submitHistory(curIndex)
  }

  private _refreshTypingBatchTimer() {
    if (this._typingBatchTimer !== null) clearTimeout(this._typingBatchTimer)
    const idleMs = Math.max(1, this.options.historyTypingBatchMs)
    this._typingBatchTimer = setTimeout(() => {
      this._typingBatchTimer = null
      this.flushTypingBatch()
    }, idleMs)
  }

  public submitHistory(curIndex: number | undefined) {
    // PERF-PLAN §1.2 / Phase 1.2：尝试走 delta 分支——上一次 submit 之后只
    // 经历了 main 列表的纯 splice，没有 deletable 跳过、没有 listId 旁清理、
    // 没有 header / footer / table 改动、且初始 snapshot 已经在栈底。任何一
    // 项不满足都退回到 legacy snapshot（保留正确性兜底）。
    const canUseDelta =
      !this._deltaHistoryUnsafe &&
      this._pendingHistoryMutations.length > 0 &&
      this._preMutationMeta !== null &&
      !this.historyManager.isStackEmpty() &&
      this._pendingHistoryMutations.every(m => m.scope === 'main')
    if (this.options.debugHistory) {
      console.log('[canvas-editor submitHistory]', {
        canUseDelta,
        curIndex,
        pendingMutationCount: this._pendingHistoryMutations.length,
        deltaHistoryUnsafe: this._deltaHistoryUnsafe,
        hasPreMutationMeta: this._preMutationMeta !== null,
        historyEmpty: this.historyManager.isStackEmpty(),
        mutationScopes: this._pendingHistoryMutations.map(m => m.scope)
      })
    }
    if (canUseDelta) {
      this._submitDeltaHistory(curIndex)
    } else {
      this._submitSnapshotHistory(curIndex)
    }
    // 任意分支结束都重置内部累加器，准备下一轮。
    this._pendingHistoryMutations = []
    this._deltaHistoryUnsafe = false
    this._preMutationMeta = null
  }

  /**
   * PERF-PLAN §1.2 / Phase 1.2：把累积的 splice 序列封装成一对正反应用闭包，
   * 推入 history。每个 keystroke 不再付出 ~3× full deepClone 的代价，节省的
   * 主要是：
   *   1. `getSlimCloneElementList(this.elementList)` 一次完整遍历 + 对象拷贝；
   *   2. `historyManager.execute(...)` 闭包内部还要再 deepClone 一遍 main /
   *      header / footer / range / positionContext 共 5 处。
   *
   * delta 体积约等于 mutations 总条数 × （插入/删除元素个数）。对于持续打字
   * 这类 batch，体积线性于「按了几个键」，与文档总长度脱钩。
   */
  private _submitDeltaHistory(curIndex: number | undefined) {
    const mutations = this._pendingHistoryMutations.slice()
    const metaBefore = this._preMutationMeta!
    const metaAfter: IDeltaHistoryMeta = {
      range: deepClone(this.range.getRange()),
      positionContext: deepClone(this.position.getPositionContext()),
      pageNo: this.pageNo,
      zone: this.zone.getZone()
    }
    const curIndexAfter = curIndex
    const curIndexBefore = metaBefore.range.startIndex
    const applyForward = () => {
      this._isReplayingHistory = true
      try {
        // 顺序重放：每条 mutation 对当前 elementList 再次执行 splice(start,
        // removed.length, ...inserted)——等价于「把改动重新做一遍」。
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i]
          this.elementList.splice(
            m.start,
            m.removed.length,
            ...getSlimCloneElementList(m.inserted)
          )
        }
      } finally {
        this._isReplayingHistory = false
      }
      this.zone.setZone(metaAfter.zone)
      this.setPageNo(metaAfter.pageNo)
      this.position.setPositionContext(deepClone(metaAfter.positionContext))
      this.range.replaceRange(deepClone(metaAfter.range))
      // 按完整 elementList 重新布局——比照 snapshot 路径，触发 dirty 信号
      // 要让 §2.2 / §2.3 的增量分支也参与；这里对所有可能受影响的位置做最大
      // 标脏，简单可靠。
      const bounds = this._dirtyBoundsFromMutations(mutations)
      if (bounds) this.markDirty(bounds.start, bounds.end)
      this.render({
        curIndex: curIndexAfter,
        isSubmitHistory: false,
        isSourceHistory: true
      })
    }
    const applyBackward = () => {
      this._isReplayingHistory = true
      try {
        // 反向重放：每条 mutation 倒序应用其逆——splice(start, inserted.length,
        // ...removed)。注意必须从尾到头，因为后续 mutation 的 start 索引基于
        // 前一条已经应用之后的坐标系。
        for (let i = mutations.length - 1; i >= 0; i--) {
          const m = mutations[i]
          this.elementList.splice(
            m.start,
            m.inserted.length,
            ...getSlimCloneElementList(m.removed)
          )
        }
      } finally {
        this._isReplayingHistory = false
      }
      this.zone.setZone(metaBefore.zone)
      this.setPageNo(metaBefore.pageNo)
      this.position.setPositionContext(deepClone(metaBefore.positionContext))
      this.range.replaceRange(deepClone(metaBefore.range))
      const bounds = this._dirtyBoundsFromMutations(mutations)
      if (bounds) this.markDirty(bounds.start, bounds.end)
      this.render({
        curIndex: curIndexBefore,
        isSubmitHistory: false,
        isSourceHistory: true
      })
    }
    this.historyManager.executeDelta({ applyForward, applyBackward })
  }

  /**
   * 计算一组 mutations 影响的「最小 [start, end)」区间，用于 undo / redo
   * 重渲染时给增量布局提供 dirty 提示。仅在主元素列表上有效。
   */
  private _dirtyBoundsFromMutations(
    mutations: IMutationEvent[]
  ): { start: number; end: number } | null {
    if (mutations.length === 0) return null
    let lo = Number.POSITIVE_INFINITY
    let hi = -1
    for (const m of mutations) {
      const len = Math.max(m.removed.length, m.inserted.length)
      if (m.start < lo) lo = m.start
      const endCandidate = m.start + len
      if (endCandidate > hi) hi = endCandidate
    }
    if (hi < 0) return null
    return { start: lo, end: hi }
  }

  /**
   * Legacy 快照路径：兼容 property-only 命令、首次提交、跨分区改动等不能
   * 用 delta 描述的场景。语义与 Phase 1.2 之前的 submitHistory 完全一致——
   * 9× deepClone（主 / 页眉 / 页脚 / range / positionContext，构造时 4 次，
   * 闭包内部 5 次）。代价比 delta 高，但只在罕见路径上发生。
   */
  private _submitSnapshotHistory(curIndex: number | undefined) {
    const positionContext = this.position.getPositionContext()
    const oldElementList = getSlimCloneElementList(this.elementList)
    const oldHeaderElementList = getSlimCloneElementList(
      this.header.getElementList()
    )
    const oldFooterElementList = getSlimCloneElementList(
      this.footer.getElementList()
    )
    const oldRange = deepClone(this.range.getRange())
    const pageNo = this.pageNo
    const oldPositionContext = deepClone(positionContext)
    const zone = this.zone.getZone()
    this.historyManager.execute(() => {
      this._isReplayingHistory = true
      try {
        this.zone.setZone(zone)
        this.setPageNo(pageNo)
        this.position.setPositionContext(deepClone(oldPositionContext))
        this.header.setElementList(deepClone(oldHeaderElementList))
        this.footer.setElementList(deepClone(oldFooterElementList))
        this.elementList = deepClone(oldElementList)
        this.range.replaceRange(deepClone(oldRange))
      } finally {
        this._isReplayingHistory = false
      }
      this.render({
        curIndex,
        isSubmitHistory: false,
        isSourceHistory: true
      })
    })
  }

  public destroy() {
    if (this._pendingRenderFrameId !== null) {
      const caf =
        typeof cancelAnimationFrame === 'function'
          ? cancelAnimationFrame
          : clearTimeout
      caf(this._pendingRenderFrameId as number)
      this._pendingRenderFrameId = null
      this._pendingRenderPayload = null
    }
    if (this._typingBatchTimer !== null) {
      clearTimeout(this._typingBatchTimer)
      this._typingBatchTimer = null
    }
    this._typingBatchActive = false
    this._typingBatchLastCurIndex = undefined
    this._invalidatePaintCache()
    this.container.remove()
    this.globalEvent.removeEvent()
    this.scrollObserver.removeEvent()
    this.selectionObserver.removeEvent()
    this.workerManager.destroy()
    this.magnifier.destroy()
    this.lazyRenderIntersectionObserver?.disconnect()
  }

  public clearSideEffect() {
    // 预览工具组件
    this.getPreviewer().clearResizer()
    // 表格工具组件
    this.getTableTool().dispose()
    // 超链接弹窗
    this.getHyperlinkParticle().clearHyperlinkPopup()
    // 日期控件
    this.getDateParticle().clearDatePicker()
  }
}
