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

export class Draw {
  private container: HTMLDivElement
  private pageContainer: HTMLDivElement
  private pageList: HTMLCanvasElement[]
  private ctxList: CanvasRenderingContext2D[]
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
  // 上一次渲染各 page 的 row 数，用于检测下游 pagination 是否漂移
  private _prevPageRowCounts: number[] | null
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
    this._prevPageRowCounts = null
    this._drawnPages = new Set()
    this._mainRowCheckpoints = []
    this._mainLayoutSig = null
    this._mutationListeners = new Set()
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
    this.render({
      isInit: true,
      isSetCursor: false,
      isFirstRender: true
    })
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
        elementList.splice(startIndex, 1)
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
    if (isPrepend) {
      this.elementList.splice(1, 0, ...elementList)
      curIndex = elementList.length
    } else {
      this.elementList.push(...elementList)
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

  private _resolveMutationScope(elementList: IElement[]): HistoryScope {
    if (elementList === this.elementList) return 'main'
    if (elementList === this.header.getElementList()) return 'header'
    if (elementList === this.footer.getElementList()) return 'footer'
    return 'table'
  }

  public spliceElementList(
    elementList: IElement[],
    start: number,
    deleteCount: number,
    items?: IElement[],
    options?: ISpliceElementListOption
  ) {
    // 主列表 / 页眉 / 页脚分别维护 dirty 标志：render() 据此精确决定布局范围
    if (elementList === this.elementList) {
      const insertedLen = items?.length ?? 0
      this.markDirty(start, start + Math.max(deleteCount, insertedLen))
    } else if (elementList === this.header.getElementList()) {
      this._headerDirty = true
    } else if (elementList === this.footer.getElementList()) {
      this._footerDirty = true
    } else {
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
      }
    }
    // 事件订阅前先快照「将被删除」切片（splice 后无法访问）。
    const removedSnapshot =
      this._mutationListeners.size > 0 && deleteCount > 0
        ? elementList.slice(start, start + deleteCount)
        : []
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
          }
          deleteIndex--
        }
      } else {
        elementList.splice(start, deleteCount)
      }
    }
    // 循环添加，避免使用解构影响性能
    if (items?.length) {
      for (let i = 0; i < items.length; i++) {
        // PERF-PLAN §6.2a：CRDT readiness——为新插入的元素填充稳定 id。
        // 类型上 `id` 仍为可选，老代码 / fixture 不受影响；但凡通过 Mutator
        // 进来的元素都会拿到稳定 id，便于后续操作日志按 id 引用而非索引。
        const item = items[i]
        if (!item.id) item.id = getUUID()
        elementList.splice(start + i, 0, item)
      }
    }
    // 通知突变事件订阅者（PERF-PLAN §3.1）。仅在有订阅者时才构造 payload。
    if (this._mutationListeners.size > 0) {
      this._emitMutation({
        kind: 'splice',
        scope: this._resolveMutationScope(elementList),
        start,
        removed: removedSnapshot,
        inserted: items ? items.slice() : []
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
    const dpr = this.getPagePixelRatio()
    this.options.scale = payload
    const width = this.getWidth()
    const height = this.getHeight()
    this.container.style.width = `${width}px`
    this.pageList.forEach((p, i) => {
      p.width = width * dpr
      p.height = height * dpr
      p.style.width = `${width}px`
      p.style.height = `${height}px`
      p.style.marginBottom = `${this.getPageGap()}px`
      this._initPageContext(this.ctxList[i])
    })
    const cursorPosition = this.position.getCursorPosition()
    this.render({
      isSubmitHistory: false,
      isSetCursor: !!cursorPosition,
      curIndex: cursorPosition?.index
    })
    if (this.listener.pageScaleChange) {
      this.listener.pageScaleChange(payload)
    }
    if (this.eventBus.isSubscribe('pageScaleChange')) {
      this.eventBus.emit('pageScaleChange', payload)
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
    this.pageList.forEach((p, i) => {
      p.width = width * dpr
      p.height = height * dpr
      this._initPageContext(this.ctxList[i])
    })
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
    this.pageList.forEach((p, i) => {
      p.width = realWidth * dpr
      p.height = realHeight * dpr
      p.style.width = `${realWidth}px`
      p.style.height = `${realHeight}px`
      this._initPageContext(this.ctxList[i])
    })
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
    this.pageList.forEach((p, i) => {
      p.width = width * dpr
      p.height = height * dpr
      p.style.width = `${width}px`
      p.style.height = `${height}px`
      this._initPageContext(this.ctxList[i])
    })
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
    this._drawnPages.clear()
    this._dirtyRange = null
    this._headerDirty = false
    this._footerDirty = false
    // Phase 2B：增量布局所依赖的 row checkpoint 也一并失效，避免 setEditorData
    // 等大批量替换文档后还沿用上一份文档的恢复点（PERF-PLAN §2.2）。
    this._mainRowCheckpoints = []
    this._mainLayoutSig = null
  }

  /**
   * PERF-PLAN §2.2 / Phase 2B：构建本帧的「布局输入签名」。
   *
   * 任何会让任意一行的几何形状（width / height / x / y / page break 时机）改变的
   * 选项必须列入。签名变了 → 上一帧的 _mainRowCheckpoints 不再可信，必须全量。
   */
  private _buildLayoutSig(extra: { isPagingMode: boolean; innerWidth: number }) {
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
  } | null {
    if (!this._dirtyRange) return null
    if (!this._mainRowCheckpoints.length) return null
    if (this.rowList.length <= 1) return null
    if (this._mainRowCheckpoints.length !== this.rowList.length) return null
    if (!this._isLayoutSigCompatible(extra)) return null
    const dirtyStart = this._dirtyRange.start
    // 找出第一个 startIndex > dirtyStart 的行，则它的前一行就是「dirty 行」。
    // dirty 行（含起点）必须重排，dirty 行之前的行可以保留。
    let dirtyRowIndex = this.rowList.length - 1
    for (let i = 0; i < this.rowList.length; i++) {
      if (this.rowList[i].startIndex > dirtyStart) {
        dirtyRowIndex = i - 1
        break
      }
    }
    if (dirtyRowIndex <= 0) return null
    const prefixRowList = this.rowList.slice(0, dirtyRowIndex)
    const checkpoint = this._mainRowCheckpoints[dirtyRowIndex]
    if (!checkpoint) return null
    // dirty 行的第一个元素索引：从该行开始重排
    const startElementIndex = this.rowList[dirtyRowIndex].startIndex
    return {
      startElementIndex,
      prefixRowList,
      checkpoint
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
        console.error(
          `[Phase2B/validate] row ${r} mismatch`,
          { full: a, incremental: b }
        )
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
    const canvas = document.createElement('canvas')
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.style.display = 'block'
    canvas.style.backgroundColor = '#ffffff'
    canvas.style.marginBottom = `${this.getPageGap()}px`
    canvas.setAttribute('data-index', String(pageNo))
    this.pageContainer.append(canvas)
    // 调整分辨率
    const dpr = this.getPagePixelRatio()
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.cursor = 'text'
    const ctx = canvas.getContext('2d')!
    // 初始化上下文配置
    this._initPageContext(ctx)
    // 缓存上下文
    this.pageList.push(canvas)
    this.ctxList.push(ctx)
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
        for (let t = 0; t < trList.length; t++) {
          const tr = trList[t]
          for (let d = 0; d < tr.tdList.length; d++) {
            const td = tr.tdList[d]
            // PERF-PLAN §2.5 / Phase 2B：在 Mutator 边界（spliceElementList）能找到
            // 「这条 elementList 属于哪个 td」的能力靠 td.value 上的隐藏 _owningTd
            // 反向引用——这里保证每次 render 都重新设置一次（td 引用可能在表格
            // 重排时变化，因此 writable + 重写）。
            ;(td.value as unknown as { _owningTd: typeof td })._owningTd = td
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
    }
    return rowList
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
      if (pageHeight > pageDomHeight) {
        pageDom.style.height = `${pageHeight}px`
        pageDom.height = pageHeight * dpr
      } else {
        const reduceHeight = pageHeight < height ? height : pageHeight
        pageDom.style.height = `${reduceHeight}px`
        pageDom.height = reduceHeight * dpr
      }
      this._initPageContext(this.ctxList[0])
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
      // 绘制选区
      if (!isPrintMode && !isGraffitiMode) {
        if (rangeRecord.width && rangeRecord.height) {
          const { x, y, width, height } = rangeRecord
          this.range.render(ctx, x, y, width, height)
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
          this.tableParticle.drawRange(ctx, tableRangeElement, x, y)
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

  private _clearPage(pageNo: number) {
    const ctx = this.ctxList[pageNo]
    const pageDom = this.pageList[pageNo]
    ctx.clearRect(
      0,
      0,
      Math.max(pageDom.width, this.getWidth()),
      Math.max(pageDom.height, this.getHeight())
    )
    this.blockParticle.clear()
  }

  private _drawPage(payload: IDrawPagePayload) {
    const { elementList, positionList, rowList, pageNo } = payload
    const {
      inactiveAlpha,
      pageMode,
      header,
      footer,
      pageNumber,
      lineNumber,
      pageBorder
    } = this.options
    const isPrintMode = this.mode === EditorMode.PRINT
    const isContinuityMode = pageMode === PageMode.CONTINUITY
    const innerWidth = this.getInnerWidth()
    const ctx = this.ctxList[pageNo]
    // 判断当前激活区域-非正文区域时元素透明度降低
    ctx.globalAlpha = !this.zone.isMainActive() ? inactiveAlpha : 1
    this._clearPage(pageNo)
    // 绘制背景
    if (
      !isPrintMode ||
      !this.options.modeRule[EditorMode.PRINT]?.backgroundDisabled
    ) {
      this.background.render(ctx, pageNo)
    }
    // 绘制区域
    if (!isPrintMode) {
      this.area.render(ctx, pageNo)
    }
    // 绘制水印（底层）
    if (
      !isContinuityMode &&
      this.options.watermark.data &&
      this.options.watermark.layer === WatermarkLayer.BOTTOM
    ) {
      this.waterMark.render(ctx, pageNo)
    }
    // 绘制页边距
    if (!isPrintMode) {
      this.margin.render(ctx, pageNo)
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
    const index = rowList[0]?.startIndex
    this.drawRow(ctx, {
      elementList,
      positionList,
      rowList,
      pageNo,
      startIndex: index,
      innerWidth,
      zone: EditorZone.MAIN
    })
    if (this.getIsPagingMode()) {
      // 绘制页眉
      if (!header.disabled) {
        this.header.render(ctx, pageNo)
      }
      // 绘制页码
      if (!pageNumber.disabled) {
        this.pageNumber.render(ctx, pageNo)
      }
      // 绘制页脚
      if (!footer.disabled) {
        this.footer.render(ctx, pageNo)
      }
    }
    // 渲染浮于文字上方元素
    this._drawFloat(ctx, {
      pageNo,
      imgDisplays: [ImageDisplay.FLOAT_TOP, ImageDisplay.SURROUND]
    })
    // 搜索匹配绘制
    if (!isPrintMode && this.search.getSearchKeyword()) {
      this.search.render(ctx, pageNo)
    }
    // 绘制空白占位符
    if (this.elementList.length <= 1 && !this.elementList[0]?.listId) {
      this.placeholder.render(ctx)
    }
    // 渲染行数
    if (!lineNumber.disabled) {
      this.lineNumber.render(ctx, pageNo)
    }
    // 绘制页面边框
    if (!pageBorder.disabled) {
      this.pageBorder.render(ctx)
    }
    // 绘制签章
    this.badge.render(ctx, pageNo)
    // 绘制涂鸦
    if (this.isGraffitiMode()) {
      this.graffiti.render(ctx, pageNo)
    }
    // 绘制水印（顶层）
    if (
      !isContinuityMode &&
      this.options.watermark.data &&
      this.options.watermark.layer === WatermarkLayer.TOP
    ) {
      this.waterMark.render(ctx, pageNo)
    }
  }

  private _disconnectLazyRender() {
    this.lazyRenderIntersectionObserver?.disconnect()
  }

  /**
   * 根据上一次渲染的每页 row 数与本次渲染的 dirty 提示，计算需要重绘的 page 集合
   * （PERF-PLAN §2.4）。返回 null 表示「无法判定，应全量重绘」。
   *
   * 触发非全量的条件：
   *  - 必须有 _prevPageRowCounts（首次渲染或被 invalidatePaintCache() 清空时全量）
   *  - 必须有 _dirtyRange 提示（无 spliceElementList 等显式信号时全量，保证安全）
   *
   * 落在 dirty 集合的 page：
   *  - 包含 dirty 区间起/止元素的 page（光标插入点所在页）
   *  - 第一处 row 数与上次不同的 page 及其后所有 page（pagination 漂移）
   *  - 任何新增的 page
   */
  private _computeDirtyPages(): Set<number> | null {
    if (this._prevPageRowCounts === null) return null
    if (this._dirtyRange === null) return null
    const cur = this.pageRowList
    const curCount = cur.length
    const prev = this._prevPageRowCounts
    const dirty = new Set<number>()
    // 1) row 数差异：从首处差异页起，本帧及之后均视为脏（pagination 下游漂移）
    let firstShifted = curCount
    for (let i = 0; i < curCount; i++) {
      const prevLen = i < prev.length ? prev[i] : -1
      if (prevLen !== cur[i].length) {
        firstShifted = i
        break
      }
    }
    for (let i = firstShifted; i < curCount; i++) dirty.add(i)
    // 2) dirty 元素区间所在页（即便 row 数不变，单页内容仍需重绘）
    const positionList = this.position.getOriginalMainPositionList()
    const startPos =
      positionList[Math.min(this._dirtyRange.start, positionList.length - 1)]
    if (startPos) dirty.add(startPos.pageNo)
    const endPos =
      positionList[Math.min(this._dirtyRange.end, positionList.length - 1)]
    if (endPos) dirty.add(endPos.pageNo)
    return dirty
  }

  private _lazyRender(dirtyPages: Set<number> | null) {
    const positionList = this.position.getOriginalMainPositionList()
    const elementList = this.getOriginalMainElementList()
    this._disconnectLazyRender()
    this.lazyRenderIntersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = Number((<HTMLCanvasElement>entry.target).dataset.index)
          // 已绘制且未被本帧标脏：跳过（PERF-PLAN §2.4）
          const isDirty = dirtyPages === null || dirtyPages.has(index)
          if (!isDirty && this._drawnPages.has(index)) return
          this._drawPage({
            elementList,
            positionList,
            rowList: this.pageRowList[index],
            pageNo: index
          })
          this._drawnPages.add(index)
        }
      })
    })
    this.pageList.forEach(el => {
      this.lazyRenderIntersectionObserver!.observe(el)
    })
  }

  private _immediateRender(dirtyPages: Set<number> | null) {
    const positionList = this.position.getOriginalMainPositionList()
    const elementList = this.getOriginalMainElementList()
    for (let i = 0; i < this.pageRowList.length; i++) {
      const isDirty = dirtyPages === null || dirtyPages.has(i)
      // 干净且已绘制：跳过本页 _drawPage 调用
      if (!isDirty && this._drawnPages.has(i)) continue
      this._drawPage({
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
        b.isSourceHistory !== undefined
          ? b.isSourceHistory
          : a.isSourceHistory,
      // OR 合并
      isSubmitHistory: orTrue(a.isSubmitHistory, b.isSubmitHistory),
      isCompute: orTrue(a.isCompute, b.isCompute),
      isSetCursor: orTrue(a.isSetCursor, b.isSetCursor),
      // AND：只有当所有合并源都标注 isTextInput 时才视为输入合批；
      // 任一非输入动作进入本帧即按非输入处理（先 flush 当前 batch、再正常 submit）
      isTextInput:
        a.isTextInput === true && b.isTextInput === true ? true : undefined
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
    const { header, footer } = this.options
    const {
      isSubmitHistory = true,
      isSetCursor = true,
      isCompute = true,
      isLazy = true,
      isInit = false,
      isSourceHistory = false,
      isFirstRender = false,
      isTextInput = false
    } = payload || {}
    let { curIndex } = payload || {}
    const innerWidth = this.getInnerWidth()
    const isPagingMode = this.getIsPagingMode()
    // 缓存当前页数信息
    const oldPageSize = this.pageRowList.length
    // 计算文档信息
    if (isCompute) {
      // 主元素列表是否需要重新布局：仅当当前编辑区域为 MAIN 或主列表 dirty
      // 已经被显式标记时才走全量。换言之，在 4-page 主文档场景下，用户在
      // 页眉/页脚里输入不会触发主体的 N 元素 computeRowList / computePositionList /
      // area.compute() —— 这些都依赖主元素，主元素未改时它们的结果是稳定的。
      const activeZone = this.zone.getZone()
      const isMainZone = activeZone === EditorZone.MAIN
      const mainNeedsCompute =
        isMainZone || this._dirtyRange !== null || this._prevPageRowCounts === null
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
      if (mainNeedsCompute) {
        // 行信息
        const margins = this.getMargins()
        const pageHeight = this.getHeight()
        const extraHeight = this.header.getExtraHeight()
        const mainOuterHeight = this.getMainOuterHeight()
        // 行布局起点为第一列的左上角；单列时与页面左上一致
        const startX = this.getColumnStartX(0)
        const startY = margins[0] + extraHeight
        const surroundElementList = pickSurroundElementList(this.elementList)
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
        // 位置信息——PERF-PLAN §2.3 增量分支：仅当 §2.2 的增量路径成立时启用，
        // 与 row prefix 同步保留 positionList prefix，省下 ~O(N) 对象构造。
        if (resumeFrom && lastPrefixRow) {
          // 前缀末尾行被原地扩展（curRow.elementList.push）→ 该行的 position
          // 缓存不再准确，position 恢复点必须前移一行（包含该行的全部元素）。
          // 否则前缀位置都是稳定的，按 §2.2 给出的 (fromRowGlobalIndex,
          // fromElementIndex) 直接走。
          const lastPrefixMutated =
            lastPrefixRow.elementList.length !== lastPrefixRowOriginalCount
          if (lastPrefixMutated) {
            this.position.computePositionListIncremental({
              fromRowGlobalIndex: resumeFrom.prefixRowList.length - 1,
              fromElementIndex: lastPrefixRow.startIndex
            })
          } else {
            this.position.computePositionListIncremental({
              fromRowGlobalIndex: resumeFrom.prefixRowList.length,
              fromElementIndex: resumeFrom.startElementIndex
            })
          }
        } else {
          this.position.computePositionList()
        }
        // 区域信息
        this.area.compute()
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
      this.pageList
        .splice(curPageCount, deleteCount)
        .forEach(page => page.remove())
      // 同步移除已绘制集合中的越界条目
      for (const idx of Array.from(this._drawnPages)) {
        if (idx >= curPageCount) this._drawnPages.delete(idx)
      }
    }
    // 计算 dirty pages（PERF-PLAN §2.4）。无 dirty 提示 / 首次渲染时返回 null
    // 表示「全部重绘」，行为与原版完全一致。
    const dirtyPages = isCompute ? this._computeDirtyPages() : null
    // 全量重绘时清空已绘制集合，让本次渲染无条件重画所有 page
    if (dirtyPages === null) this._drawnPages.clear()
    // 绘制元素
    // 连续页因为有高度的变化会导致canvas渲染空白，需立即渲染，否则会出现闪动
    if (isLazy && isPagingMode) {
      this._lazyRender(dirtyPages)
    } else {
      this._immediateRender(dirtyPages)
    }
    // 落盘本次 row 数与清除 dirty 提示，供下次渲染做差分
    this._prevPageRowCounts = this.pageRowList.map(rl => rl.length)
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
        isTextInput &&
        batchMs > 0 &&
        !this.historyManager.isStackEmpty()
      if (canBatch) {
        this._typingBatchActive = true
        this._typingBatchLastCurIndex = curIndex
        this._refreshTypingBatchTimer()
      } else {
        this.flushTypingBatch()
        this.submitHistory(curIndex)
      }
    }
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
      this.zone.setZone(zone)
      this.setPageNo(pageNo)
      this.position.setPositionContext(deepClone(oldPositionContext))
      this.header.setElementList(deepClone(oldHeaderElementList))
      this.footer.setElementList(deepClone(oldFooterElementList))
      this.elementList = deepClone(oldElementList)
      this.range.replaceRange(deepClone(oldRange))
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
