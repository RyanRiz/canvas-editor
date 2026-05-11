import { ElementType, ListStyle, RowFlex, VerticalAlign } from '../..'
import { ZERO } from '../../dataset/constant/Common'
import { ControlComponent } from '../../dataset/enum/Control'
import {
  IComputePageRowPositionPayload,
  IComputePageRowPositionResult,
  IComputeRowPositionPayload,
  IFloatPosition,
  IGetFloatPositionByXYPayload,
  ISetSurroundPositionPayload
} from '../../interface/Position'
import { IEditorOption } from '../../interface/Editor'
import { IElement, IElementPosition } from '../../interface/Element'
import {
  ICurrentPosition,
  IGetPositionByXYPayload,
  IPositionContext
} from '../../interface/Position'
import { Draw } from '../draw/Draw'
import { EditorMode, EditorZone } from '../../dataset/enum/Editor'
import { isRectIntersect } from '../../utils'
import { ImageDisplay } from '../../dataset/enum/Common'
import { DeepRequired } from '../../interface/Common'
import { EventBus } from '../event/eventbus/EventBus'
import { EventBusMap } from '../../interface/EventBus'
import { getIsBlockElement } from '../../utils/element'

export class Position {
  private cursorPosition: IElementPosition | null
  private positionContext: IPositionContext
  private positionList: IElementPosition[]
  private floatPositionList: IFloatPosition[]

  private draw: Draw
  private eventBus: EventBus<EventBusMap>
  private options: DeepRequired<IEditorOption>

  constructor(draw: Draw) {
    this.positionList = []
    this.floatPositionList = []
    this.cursorPosition = null
    this.positionContext = {
      isTable: false,
      isControl: false
    }

    this.draw = draw
    this.eventBus = draw.getEventBus()
    this.options = draw.getOptions()
  }

  public getFloatPositionList(): IFloatPosition[] {
    return this.floatPositionList
  }

  public getTablePositionList(
    sourceElementList: IElement[]
  ): IElementPosition[] {
    const { index, trIndex, tdIndex } = this.positionContext
    return (
      sourceElementList[index!].trList![trIndex!].tdList[tdIndex!]
        .positionList || []
    )
  }

  public getPositionList(): IElementPosition[] {
    return this.positionContext.isTable
      ? this.getTablePositionList(this.draw.getOriginalElementList())
      : this.getOriginalPositionList()
  }

  public getMainPositionList(): IElementPosition[] {
    return this.positionContext.isTable
      ? this.getTablePositionList(this.draw.getOriginalMainElementList())
      : this.positionList
  }

  public getOriginalPositionList(): IElementPosition[] {
    const zoneManager = this.draw.getZone()
    if (zoneManager.isHeaderActive()) {
      const header = this.draw.getHeader()
      return header.getPositionList()
    }
    if (zoneManager.isFooterActive()) {
      const footer = this.draw.getFooter()
      return footer.getPositionList()
    }
    return this.positionList
  }

  public getOriginalMainPositionList(): IElementPosition[] {
    return this.positionList
  }

  public getSelectionPositionList(): IElementPosition[] | null {
    const { startIndex, endIndex } = this.draw.getRange().getRange()
    if (startIndex === endIndex) return null
    const positionList = this.getPositionList()
    return positionList.slice(startIndex + 1, endIndex + 1)
  }

  public setPositionList(payload: IElementPosition[]) {
    this.positionList = payload
  }

  public setFloatPositionList(payload: IFloatPosition[]) {
    this.floatPositionList = payload
  }

  public computePageRowPosition(
    payload: IComputePageRowPositionPayload
  ): IComputePageRowPositionResult {
    const {
      positionList,
      rowList,
      pageNo,
      startRowNo = 0,
      startX,
      startY,
      startRowIndex,
      startIndex,
      innerWidth,
      zone
    } = payload
    const {
      scale,
      table: { tdPadding }
    } = this.options
    let x = startX
    let y = startY
    let index = startIndex
    for (let i = 0; i < rowList.length; i++) {
      const curRow = rowList[i]
      // 行存在环绕的可能性均不设置行布局
      if (!curRow.isSurround) {
        // 计算行偏移量（行居中、居右）
        // Right indent (curRow.rightOffsetX) trims the usable area from the
        // right edge: centered rows center between left indent and the
        // (innerWidth − rightIndent) point; right-aligned rows pin to that
        // same inner-right point instead of the page's right edge.
        const curRowWidth = curRow.width + (curRow.offsetX || 0)
        const rightOffsetX = curRow.rightOffsetX || 0
        if (curRow.rowFlex === RowFlex.CENTER) {
          x += (innerWidth - curRowWidth - rightOffsetX) / 2
        } else if (curRow.rowFlex === RowFlex.RIGHT) {
          x += innerWidth - curRowWidth - rightOffsetX
        }
      }
      // 当前行X/Y轴偏移量
      x += curRow.offsetX || 0
      y += curRow.offsetY || 0
      // 当前td所在位置
      const tablePreX = x
      let tablePreY = y
      for (let j = 0; j < curRow.elementList.length; j++) {
        const element = curRow.elementList[j]
        if (element.type === ElementType.TABLE && !element.hide) {
          const draw = this.draw
          const tableParticle = draw.getTableParticle()
          if (tableParticle.isTableFigure(element)) {
            tablePreY += tableParticle.getTableFigureLabelHeight(element)
          }
        }
        const metrics = element.metrics
        const rowMargin = this.draw.getElementRowMargin(element)
        const offsetY =
          !element.hide &&
          ((element.imgDisplay !== ImageDisplay.INLINE &&
            element.type === ElementType.IMAGE) ||
            element.type === ElementType.LATEX)
            ? curRow.ascent - metrics.height
            : Math.max(0, curRow.ascent - rowMargin * 1.2)
        // 偏移量（内部计算使用）
        if (element.left) {
          x += element.left
        }
        // 偏移量（外部传入）
        if (element.translateX) {
          x += element.translateX * scale
        }
        const positionItem: IElementPosition = {
          pageNo,
          index,
          value: element.value,
          rowIndex: startRowIndex + i,
          rowNo: startRowNo + i,
          metrics,
          left: element.left || 0,
          ascent: offsetY,
          lineHeight: curRow.height,
          isFirstLetter: j === 0,
          isLastLetter: j === curRow.elementList.length - 1,
          coordinate: {
            leftTop: [x, y],
            leftBottom: [x, y + curRow.height],
            rightTop: [x + metrics.width, y],
            rightBottom: [x + metrics.width, y + curRow.height]
          }
        }
        // 缓存浮动元素信息
        if (
          element.imgDisplay === ImageDisplay.SURROUND ||
          element.imgDisplay === ImageDisplay.FLOAT_TOP ||
          element.imgDisplay === ImageDisplay.FLOAT_BOTTOM
        ) {
          // 浮动元素使用上一位置信息
          const prePosition = positionList[positionList.length - 1]
          if (prePosition) {
            positionItem.metrics = prePosition.metrics
            positionItem.coordinate = prePosition.coordinate
          }
          // 兼容浮动元素初始坐标为空的情况-默认使用左上坐标
          if (!element.imgFloatPosition) {
            element.imgFloatPosition = {
              x,
              y,
              pageNo
            }
          }
          this.floatPositionList.push({
            pageNo,
            element,
            position: positionItem,
            isTable: payload.isTable,
            index: payload.index,
            tdIndex: payload.tdIndex,
            trIndex: payload.trIndex,
            tdValueIndex: index,
            zone
          })
        }
        positionList.push(positionItem)
        index++
        x += metrics.width
        // 计算表格内元素位置
        if (element.type === ElementType.TABLE && !element.hide) {
          const tdPaddingWidth = tdPadding[1] + tdPadding[3]
          const tdPaddingHeight = tdPadding[0] + tdPadding[2]
          for (let t = 0; t < element.trList!.length; t++) {
            const tr = element.trList![t]
            for (let d = 0; d < tr.tdList!.length; d++) {
              const td = tr.tdList[d]
              td.positionList = []
              const rowList = td.rowList!
              const drawRowResult = this.computePageRowPosition({
                positionList: td.positionList,
                rowList,
                pageNo,
                startRowIndex: 0,
                startIndex: 0,
                startX:
                  (td.x! + tdPadding[3]) * scale +
                  tablePreX +
                  (element.translateX || 0) * scale,
                startY: (td.y! + tdPadding[0]) * scale + tablePreY,
                innerWidth: (td.width! - tdPaddingWidth) * scale,
                isTable: true,
                index: index - 1,
                tdIndex: d,
                trIndex: t,
                zone
              })
              // 垂直对齐方式
              if (
                td.verticalAlign === VerticalAlign.MIDDLE ||
                td.verticalAlign === VerticalAlign.BOTTOM
              ) {
                const rowsHeight = rowList.reduce(
                  (pre, cur) => pre + cur.height,
                  0
                )
                const blankHeight =
                  (td.height! - tdPaddingHeight) * scale - rowsHeight
                const offsetHeight =
                  td.verticalAlign === VerticalAlign.MIDDLE
                    ? blankHeight / 2
                    : blankHeight
                if (Math.floor(offsetHeight) > 0) {
                  td.positionList.forEach(tdPosition => {
                    const {
                      coordinate: { leftTop, leftBottom, rightBottom, rightTop }
                    } = tdPosition
                    leftTop[1] += offsetHeight
                    leftBottom[1] += offsetHeight
                    rightBottom[1] += offsetHeight
                    rightTop[1] += offsetHeight
                  })
                }
              }
              x = drawRowResult.x
              y = drawRowResult.y
            }
          }
          // 恢复初始x、y
          x = tablePreX
          y = tablePreY
        }
      }
      x = startX
      y += curRow.height
    }
    return { x, y, index }
  }

  public computePositionList() {
    // 置空原位置信息
    this.positionList = []
    const pageRowList = this.draw.getPageRowList()
    const margins = this.draw.getMargins()
    // 起始位置受页眉影响
    const header = this.draw.getHeader()
    const extraHeight = header.getExtraHeight()
    const startY = margins[0] + extraHeight
    let startRowIndex = 0
    for (let i = 0; i < pageRowList.length; i++) {
      const rowList = pageRowList[i]
      if (!rowList?.length) continue
      for (let k = 0; k < rowList.length; k++) {
        const row = rowList[k]
        this.computePageRowPosition({
          positionList: this.positionList,
          rowList: [row],
          pageNo: i,
          startRowNo: k,
          startRowIndex: startRowIndex + k,
          startIndex: row.startIndex,
          startX: row.pageStartX ?? margins[3],
          startY: row.pageStartY ?? startY,
          innerWidth: row.innerWidth ?? this.draw.getInnerWidth()
        })
      }
      startRowIndex += rowList.length
    }
  }

  /**
   * PERF-PLAN §2.3 / Phase 2B: 增量重建 positionList。
   *
   * 与 §2.2 的 incremental computeRowList 配套——已知 dirty 之前的所有元素位置
   * 都未受影响（前缀 row 引用未变 → 元素引用未变 → 它们的 IElementPosition
   * 也仍然有效），只需要：
   *   1. 把 positionList 截断到 dirty 起点之前；
   *   2. floatPositionList 中 index >= dirty 起点的条目清掉，等下重建；
   *   3. 跳过 pageRowList 中 globalRowIndex < fromRowGlobalIndex 的全部行；
   *   4. 从匹配的 (pageNo, rowK) 起继续 computePageRowPosition。
   *
   * 7441 字 / 10 页文档每键击省下约 30ms 的对象构造。命中条件由 Draw.render
   * 与 §2.2 的 _tryBuildResumeFrom 协同决定，调用方负责传入正确的 fromRowGlobalIndex
   * （= 上一帧 rowList 的前缀长度）和 fromElementIndex（= 该行的 startIndex）。
   *
   * 安全降级：调用方若不能保证 prefix 行未变，应回落到 computePositionList()。
   */
  public computePositionListIncremental(payload: {
    fromRowGlobalIndex: number
    fromElementIndex: number
    /**
     * 收敛尾部复用提示（PERF-PLAN follow-up）。
     *
     * 当 §2.2 的 row-list 收敛命中、且 pagination 稳定时调用方传入：
     *   - fromNewRowGlobalIndex：NEW pageRowList 中第一个「来自旧 rowList 的
     *     被复用行」的全局索引——之前的行（含 matched 新行）需要 fresh 计算。
     *   - deltaElems：dirty 处的元素索引漂移（newTotalElems - oldTotalElems）。
     *
     * 命中后：fresh 计算到 fromNewRowGlobalIndex 之前为止；剩余位置直接复用
     * 上一帧的 IElementPosition 对象（仅修改 `index` 字段为 NEW 坐标）——这
     * 跳过 ~95% 的对象构造，是 25 页文档 typing 时本函数从 ~25-130ms 降回
     * 1-3ms 的关键。
     *
     * 安全：调用方负责验证「pagination 稳定 + 行布局未漂」——典型场景是
     * 不引发换行的字符插入。两侧 row 数 / 高度有任何变化都不应传入。
     */
    convergedReuse?: {
      fromNewRowGlobalIndex: number
      deltaElems: number
    }
  }) {
    const { fromRowGlobalIndex, fromElementIndex, convergedReuse } = payload
    if (fromElementIndex <= 0 || fromRowGlobalIndex <= 0) {
      // 没有可保留的前缀——退化成全量
      this.computePositionList()
      return
    }
    // PERF-PLAN follow-up：在截断前快照旧 positionList，供后段「收敛尾部复用」使用。
    // 仅当 convergedReuse 存在时拷贝，正常路径无开销。
    const oldPositionSnapshot = convergedReuse
      ? this.positionList.slice()
      : null
    // 1) 截断 positionList——前缀部分继续沿用上一帧
    if (this.positionList.length > fromElementIndex) {
      this.positionList.length = fromElementIndex
    }
    // 2) 清掉 dirty 起点之后的浮动条目；前缀里的浮动定位仍然有效
    if (this.floatPositionList.length) {
      this.floatPositionList = this.floatPositionList.filter(
        f => f.position.index < fromElementIndex
      )
    }
    // 3) 找出从哪一页 / 哪一行开始恢复——pageRowList 是本帧 _computePageList()
    //    刚刚重建的，所以行的 globalRowIndex 与 this.rowList 同序。
    const pageRowList = this.draw.getPageRowList()
    const margins = this.draw.getMargins()
    const header = this.draw.getHeader()
    const extraHeight = header.getExtraHeight()
    const startY = margins[0] + extraHeight
    let startRowIndex = 0
    let reuseHit = false
    outer: for (let i = 0; i < pageRowList.length; i++) {
      const rowList = pageRowList[i]
      if (!rowList?.length) continue
      // 整页都在 fromRowGlobalIndex 之前——直接跳过
      if (startRowIndex + rowList.length <= fromRowGlobalIndex) {
        startRowIndex += rowList.length
        continue
      }
      // 4) 本页跨过了 boundary——从匹配行开始 replay
      for (let k = 0; k < rowList.length; k++) {
        const globalRowIndex = startRowIndex + k
        if (globalRowIndex < fromRowGlobalIndex) continue
        // 收敛尾部复用：到达 reuse 起点行——停止 fresh 计算，下面统一接驳。
        if (
          convergedReuse &&
          globalRowIndex >= convergedReuse.fromNewRowGlobalIndex
        ) {
          reuseHit = true
          break outer
        }
        const row = rowList[k]
        this.computePageRowPosition({
          positionList: this.positionList,
          rowList: [row],
          pageNo: i,
          startRowNo: k,
          startRowIndex: globalRowIndex,
          startIndex: row.startIndex,
          startX: row.pageStartX ?? margins[3],
          startY: row.pageStartY ?? startY,
          innerWidth: row.innerWidth ?? this.draw.getInnerWidth()
        })
      }
      startRowIndex += rowList.length
    }
    // 收敛尾部复用：fresh 计算结束位置 = 当前 positionList.length。其后所有元素
    // 都来自旧 rowList（同对象引用 + 同 layout），仅 absolute index 漂了 deltaElems。
    //
    // 性能要点：直接「就地修改 .index」并 push 旧对象——避免每条 IElementPosition
    // 的 spread {...old} 分配（13 字段 × 28k 元素 = ~360k 拷贝，spread 占了
    // computePositionList 时间里相当大的一块）。安全性：
    //   - 老 positionList 已经被 truncate 截断，外部从此处看不到那些旧对象。
    //   - oldPositionSnapshot 是浅拷贝数组，引用同一组对象——我们仍持有它，
    //     但本帧用完即丢；不会被外部观察到「中间态 index 旧值」。
    //   - cursorPosition / floatPositionList 的相关引用都在本 render 后续步骤里
    //     被重新填充（setCursor / area.compute / 重新 push 浮动），不依赖旧 .index。
    if (convergedReuse && reuseHit && oldPositionSnapshot) {
      const newReuseStart = this.positionList.length
      const oldReuseStart = newReuseStart - convergedReuse.deltaElems
      const delta = convergedReuse.deltaElems
      // 预分配数组长度——避免 push() 在 V8 内部触发多次容量扩张（amortized O(1)
      // 但每次扩张都要 memcpy）。对 30k 元素文档可省 ~30% 复用循环时间。
      const reuseCount = oldPositionSnapshot.length - oldReuseStart
      this.positionList.length = newReuseStart + reuseCount
      for (let t = 0; t < reuseCount; t++) {
        const old = oldPositionSnapshot[oldReuseStart + t]
        if (!old) continue
        old.index += delta
        this.positionList[newReuseStart + t] = old
      }
    }
  }

  public computeRowPosition(
    payload: IComputeRowPositionPayload
  ): IElementPosition[] {
    const { row, innerWidth } = payload
    const positionList: IElementPosition[] = []
    // 浅拷贝即可：computePageRowPosition 不写回 row 的标量字段，
    // 仅可能默认化共享元素的 imgFloatPosition（幂等）以及为表格元素重置
    // td.positionList——本辅助调用仅用于行级预览（非表格行），无需 deepClone
    // 整个元素子树。
    this.computePageRowPosition({
      positionList,
      innerWidth,
      rowList: [{ ...row }],
      pageNo: 0,
      startX: 0,
      startY: 0,
      startIndex: 0,
      startRowIndex: 0
    })
    return positionList
  }

  public setCursorPosition(position: IElementPosition | null) {
    this.cursorPosition = position
  }

  public getCursorPosition(): IElementPosition | null {
    return this.cursorPosition
  }

  public getPositionContext(): IPositionContext {
    return this.positionContext
  }

  public setPositionContext(payload: IPositionContext) {
    this.eventBus.emit('positionContextChange', {
      value: payload,
      oldValue: this.positionContext
    })
    this.positionContext = payload
  }

  public getPositionByXY(payload: IGetPositionByXYPayload): ICurrentPosition {
    const { x, y, isTable } = payload
    let { elementList, positionList } = payload
    if (!elementList) {
      elementList = this.draw.getOriginalElementList()
    }
    if (!positionList) {
      positionList = this.getOriginalPositionList()
    }
    const zoneManager = this.draw.getZone()
    const curPageNo = payload.pageNo ?? this.draw.getPageNo()
    const isMainActive = zoneManager.isMainActive()
    const positionNo = isMainActive ? curPageNo : 0
    const shouldScopeRowsByColumn = !isTable
    const pageRowList = this.draw.getPageRowList()
    const currentPageRows = shouldScopeRowsByColumn
      ? pageRowList[positionNo] || []
      : []
    const columnRowNoSet = shouldScopeRowsByColumn
      ? new Set(
          currentPageRows
            .filter(row => {
              const startX = row.pageStartX ?? this.draw.getMargins()[3]
              const endX = startX + (row.innerWidth ?? this.draw.getInnerWidth())
              return x >= startX && x <= endX
            })
            .map(row => row.rowIndex)
        )
      : new Set<number>()
    const hasColumnScopedRows =
      shouldScopeRowsByColumn && columnRowNoSet.size > 0
    const firstScopedRowIndex = hasColumnScopedRows
      ? currentPageRows.find(row => columnRowNoSet.has(row.rowIndex))?.rowIndex
      : undefined
    // 验证浮于文字上方元素
    if (!isTable) {
      const floatTopPosition = this.getFloatPositionByXY({
        ...payload,
        imgDisplays: [ImageDisplay.FLOAT_TOP, ImageDisplay.SURROUND]
      })
      if (floatTopPosition) return floatTopPosition
    }
    // 普通元素
    for (let j = 0; j < positionList.length; j++) {
      const {
        index,
        pageNo,
        left,
        isFirstLetter,
        coordinate: { leftTop, rightTop, leftBottom }
      } = positionList[j]
      if (positionNo !== pageNo) continue
      if (pageNo > positionNo) break
      // 命中元素
      if (
        leftTop[0] - left <= x &&
        rightTop[0] >= x &&
        leftTop[1] <= y &&
        leftBottom[1] >= y
      ) {
        let curPositionIndex = j
        const element = elementList[j]
        // 表格被命中
        if (element.type === ElementType.TABLE) {
          for (let t = 0; t < element.trList!.length; t++) {
            const tr = element.trList![t]
            for (let d = 0; d < tr.tdList.length; d++) {
              const td = tr.tdList[d]
              const tablePosition = this.getPositionByXY({
                x,
                y,
                td,
                pageNo: curPageNo,
                tablePosition: positionList[j],
                isTable: true,
                elementList: td.value,
                positionList: td.positionList
              })
              if (~tablePosition.index) {
                const { index: tdValueIndex, hitLineStartIndex } = tablePosition
                const tdValueElement = td.value[tdValueIndex]
                return {
                  index,
                  isCheckbox:
                    tablePosition.isCheckbox ||
                    tdValueElement.type === ElementType.CHECKBOX ||
                    tdValueElement.controlComponent ===
                      ControlComponent.CHECKBOX,
                  isRadio:
                    tdValueElement.type === ElementType.RADIO ||
                    tdValueElement.controlComponent === ControlComponent.RADIO,
                  isControl: !!tdValueElement.controlId,
                  isImage: tablePosition.isImage,
                  isDirectHit: tablePosition.isDirectHit,
                  isTable: true,
                  tdIndex: d,
                  trIndex: t,
                  tdValueIndex,
                  tdId: td.id,
                  trId: tr.id,
                  tableId: element.id,
                  hitLineStartIndex
                }
              }
            }
          }
        }
        // 图片区域均为命中
        if (
          element.type === ElementType.IMAGE ||
          element.type === ElementType.LATEX
        ) {
          return {
            index: curPositionIndex,
            isDirectHit: true,
            isImage: true
          }
        }
        if (
          element.type === ElementType.CHECKBOX ||
          element.controlComponent === ControlComponent.CHECKBOX
        ) {
          return {
            index: curPositionIndex,
            isDirectHit: true,
            isCheckbox: true
          }
        }
        // 标签元素检测
        if (element.type === ElementType.LABEL) {
          return {
            index: curPositionIndex,
            isDirectHit: true,
            isLabel: true
          }
        }
        if (
          element.type === ElementType.TAB &&
          element.listStyle === ListStyle.CHECKBOX
        ) {
          // 向前找checkbox元素
          let index = curPositionIndex - 1
          while (index > 0) {
            const element = elementList[index]
            if (
              element.value === ZERO &&
              element.listStyle === ListStyle.CHECKBOX
            ) {
              break
            }
            index--
          }
          return {
            index,
            isDirectHit: true,
            isCheckbox: true
          }
        }
        if (
          element.type === ElementType.RADIO ||
          element.controlComponent === ControlComponent.RADIO
        ) {
          return {
            index: curPositionIndex,
            isDirectHit: true,
            isRadio: true
          }
        }
        let hitLineStartIndex: number | undefined
        // 判断是否在文字中间前后
        if (elementList[index].value !== ZERO) {
          const valueWidth = rightTop[0] - leftTop[0]
          if (x < leftTop[0] + valueWidth / 2) {
            curPositionIndex = j - 1
            if (isFirstLetter) {
              hitLineStartIndex = j
            }
          }
        }
        return {
          isDirectHit: true,
          hitLineStartIndex,
          index: curPositionIndex,
          isControl: !!element.controlId
        }
      }
    }
    // 验证衬于文字下方元素
    if (!isTable) {
      const floatBottomPosition = this.getFloatPositionByXY({
        ...payload,
        imgDisplays: [ImageDisplay.FLOAT_BOTTOM]
      })
      if (floatBottomPosition) return floatBottomPosition
    }
    // 非命中区域
    let isLastArea = false
    let curPositionIndex = -1
    let hitLineStartIndex: number | undefined
    // 判断是否在表格内
    if (isTable) {
      const { scale } = this.options
      const { td, tablePosition } = payload
      if (td && tablePosition) {
        const { leftTop } = tablePosition.coordinate
        const tdX = td.x! * scale + leftTop[0]
        const tdY = td.y! * scale + leftTop[1]
        const tdWidth = td.width! * scale
        const tdHeight = td.height! * scale
        if (!(tdX < x && x < tdX + tdWidth && tdY < y && y < tdY + tdHeight)) {
          return {
            index: curPositionIndex
          }
        }
      }
    }
    // 判断所属行是否存在元素
    const lastLetterList = positionList.filter(
      p =>
        p.isLastLetter &&
        p.pageNo === positionNo &&
        (!hasColumnScopedRows || columnRowNoSet.has(p.rowIndex))
    )
    for (let j = 0; j < lastLetterList.length; j++) {
      const {
        index,
        rowNo,
        coordinate: { leftTop, leftBottom }
      } = lastLetterList[j]
      if (y > leftTop[1] && y <= leftBottom[1]) {
        const headIndex = positionList.findIndex(
          p => p.pageNo === positionNo && p.rowNo === rowNo
        )
        const headElement = elementList[headIndex]
        const headPosition = positionList[headIndex]
        // 是否在头部
        const headStartX =
          headElement.listStyle === ListStyle.CHECKBOX
            ? this.draw.getMargins()[3]
            : headPosition.coordinate.leftTop[0]
        if (x < headStartX) {
          // 头部元素为空元素时无需选中
          if (~headIndex) {
            if (headPosition.value === ZERO) {
              curPositionIndex = headIndex
            } else {
              curPositionIndex = headIndex - 1
              hitLineStartIndex = headIndex
            }
          } else {
            curPositionIndex = index
          }
        } else {
          // 是否是复选框列表
          if (headElement.listStyle === ListStyle.CHECKBOX && x < leftTop[0]) {
            return {
              index: headIndex,
              isDirectHit: true,
              isCheckbox: true
            }
          }
          curPositionIndex = index
        }
        isLastArea = true
        break
      }
    }
    if (!isLastArea) {
      // 页眉页脚正文切换
      if (this.draw.getIsPagingMode()) {
        // 页眉底部距离页面顶部距离
        const header = this.draw.getHeader()
        const headerHeight = header.getHeight()
        const headerBottomY = header.getHeaderTop() + headerHeight
        // 页脚上部距离页面顶部距离
        const footer = this.draw.getFooter()
        const pageHeight = this.draw.getHeight()
        const footerTopY =
          pageHeight - (footer.getFooterBottom() + footer.getHeight())
        // 判断所属位置是否属于页眉页脚区域
        if (isMainActive) {
          // 页眉：当前位置小于页眉底部位置
          if (y < headerBottomY) {
            return {
              index: -1,
              zone: EditorZone.HEADER
            }
          }
          // 页脚：当前位置大于页脚顶部位置
          if (y > footerTopY) {
            return {
              index: -1,
              zone: EditorZone.FOOTER
            }
          }
        } else {
          // main区域：当前位置小于页眉底部位置 && 大于页脚顶部位置
          if (y <= footerTopY && y >= headerBottomY) {
            return {
              index: -1,
              zone: EditorZone.MAIN
            }
          }
        }
      }
      // 正文上-循环首行
      const margins = this.draw.getMargins()
      if (y <= margins[0]) {
        for (let p = 0; p < positionList.length; p++) {
          const position = positionList[p]
          if (
            position.pageNo !== positionNo ||
            (hasColumnScopedRows && !columnRowNoSet.has(position.rowIndex)) ||
            (hasColumnScopedRows
              ? position.rowIndex !== firstScopedRowIndex
              : position.rowNo !== 0)
          ) {
            continue
          }
          const { leftTop, rightTop } = position.coordinate
          // 小于左页边距 || 命中文字 || 首行最后元素
          if (
            x <= margins[3] ||
            (x >= leftTop[0] && x <= rightTop[0]) ||
            positionList[p + 1]?.rowNo !== 0
          ) {
            return {
              index: position.index
            }
          }
        }
      } else {
        // 正文下-循环尾行
        const lastLetter = lastLetterList[lastLetterList.length - 1]
        if (lastLetter) {
          const lastRowNo = lastLetter.rowNo
          const lastRowIndex = lastLetter.rowIndex
          for (let p = 0; p < positionList.length; p++) {
            const position = positionList[p]
            if (
              position.pageNo !== positionNo ||
              position.rowNo !== lastRowNo ||
              (hasColumnScopedRows && position.rowIndex !== lastRowIndex)
            ) {
              continue
            }
            const { leftTop, rightTop } = position.coordinate
            // 小于左页边距 || 命中文字 || 尾行最后元素
            if (
              x <= margins[3] ||
              (x >= leftTop[0] && x <= rightTop[0]) ||
              positionList[p + 1]?.rowNo !== lastRowNo
            ) {
              return {
                index: position.index
              }
            }
          }
        }
      }
      // 当前页最后一行
      return {
        index:
          lastLetterList[lastLetterList.length - 1]?.index ||
          positionList.length - 1
      }
    }
    return {
      hitLineStartIndex,
      index: curPositionIndex,
      isControl: !!elementList[curPositionIndex]?.controlId
    }
  }

  public getFloatPositionByXY(
    payload: IGetFloatPositionByXYPayload
  ): ICurrentPosition | void {
    const { x, y } = payload
    const currentPageNo = payload.pageNo ?? this.draw.getPageNo()
    const currentZone = this.draw.getZone().getZone()
    const { scale } = this.options
    for (let f = 0; f < this.floatPositionList.length; f++) {
      const {
        position,
        element,
        isTable,
        index,
        trIndex,
        tdIndex,
        tdValueIndex,
        zone: floatElementZone,
        pageNo
      } = this.floatPositionList[f]
      if (
        currentPageNo === pageNo &&
        element.type === ElementType.IMAGE &&
        element.imgDisplay &&
        payload.imgDisplays.includes(element.imgDisplay) &&
        (!floatElementZone || floatElementZone === currentZone)
      ) {
        const imgFloatPosition = element.imgFloatPosition!
        const imgFloatPositionX = imgFloatPosition.x * scale
        const imgFloatPositionY = imgFloatPosition.y * scale
        const elementWidth = element.width! * scale
        const elementHeight = element.height! * scale
        if (
          x >= imgFloatPositionX &&
          x <= imgFloatPositionX + elementWidth &&
          y >= imgFloatPositionY &&
          y <= imgFloatPositionY + elementHeight
        ) {
          if (isTable) {
            return {
              index: index!,
              isDirectHit: true,
              isImage: true,
              isTable,
              trIndex,
              tdIndex,
              tdValueIndex,
              tdId: element.tdId,
              trId: element.trId,
              tableId: element.tableId
            }
          }
          return {
            index: position.index,
            isDirectHit: true,
            isImage: true
          }
        }
      }
    }
  }

  public adjustPositionContext(
    payload: IGetPositionByXYPayload
  ): ICurrentPosition | null {
    const positionResult = this.getPositionByXY(payload)
    if (!~positionResult.index) return null
    // 移动控件内光标
    if (
      positionResult.isControl &&
      this.draw.getMode() !== EditorMode.READONLY
    ) {
      const { index, isTable, trIndex, tdIndex, tdValueIndex } = positionResult
      const control = this.draw.getControl()
      const { newIndex } = control.moveCursor({
        index,
        isTable,
        trIndex,
        tdIndex,
        tdValueIndex
      })
      if (isTable) {
        positionResult.tdValueIndex = newIndex
      } else {
        positionResult.index = newIndex
      }
    }
    const {
      index,
      isCheckbox,
      isRadio,
      isControl,
      isImage,
      isLabel,
      isDirectHit,
      isTable,
      trIndex,
      tdIndex,
      tdId,
      trId,
      tableId
    } = positionResult
    // 设置位置上下文
    this.setPositionContext({
      isTable: isTable || false,
      isCheckbox: isCheckbox || false,
      isRadio: isRadio || false,
      isControl: isControl || false,
      isImage: isImage || false,
      isLabel: isLabel || false,
      isDirectHit: isDirectHit || false,
      index,
      trIndex,
      tdIndex,
      tdId,
      trId,
      tableId
    })
    return positionResult
  }

  public setSurroundPosition(payload: ISetSurroundPositionPayload) {
    const { scale } = this.options
    const {
      pageNo,
      row,
      rowElement,
      rowElementRect,
      surroundElementList,
      availableWidth
    } = payload
    let x = rowElementRect.x
    let rowIncreaseWidth = 0
    if (
      surroundElementList.length &&
      !getIsBlockElement(rowElement) &&
      !rowElement.control?.minWidth
    ) {
      for (let s = 0; s < surroundElementList.length; s++) {
        const surroundElement = surroundElementList[s]
        const floatPosition = surroundElement.imgFloatPosition!
        if (floatPosition.pageNo !== pageNo) continue
        const surroundRect = {
          ...floatPosition,
          x: floatPosition.x * scale,
          y: floatPosition.y * scale,
          width: surroundElement.width! * scale,
          height: surroundElement.height! * scale
        }
        if (isRectIntersect(rowElementRect, surroundRect)) {
          row.isSurround = true
          // 需向左移动距离：浮动元素宽度 + 浮动元素左上坐标 - 元素左上坐标
          const translateX =
            surroundRect.width + surroundRect.x - rowElementRect.x
          rowElement.left = translateX
          // 增加行宽
          row.width += translateX
          rowIncreaseWidth += translateX
          // 下个元素起始位置：浮动元素右坐标 - 元素宽度
          x = surroundRect.x + surroundRect.width
          // 检测宽度是否足够，不够则移动到下一行，并还原状态
          if (row.width + rowElement.metrics.width > availableWidth) {
            rowElement.left = 0
            row.width -= rowIncreaseWidth
            break
          }
        }
      }
    }
    return { x, rowIncreaseWidth }
  }
}
