import { ElementType, IElement, TableBorder } from '../../../..'
import {
  TableBorderStyle,
  TdBorder,
  TdSlash
} from '../../../../dataset/enum/table/Table'
import { DeepRequired } from '../../../../interface/Common'
import { IEditorOption } from '../../../../interface/Editor'
import { ITd } from '../../../../interface/table/Td'
import { ITr } from '../../../../interface/table/Tr'
import { deepClone } from '../../../../utils'
import { RangeManager } from '../../../range/RangeManager'
import { Draw } from '../../Draw'

export class TableParticle {
  private draw: Draw
  private range: RangeManager
  private options: DeepRequired<IEditorOption>

  constructor(draw: Draw) {
    this.draw = draw
    this.range = draw.getRange()
    this.options = draw.getOptions()
  }

  public getTrListGroupByCol(payload: ITr[]): ITr[] {
    const trList = deepClone(payload)
    for (let t = 0; t < payload.length; t++) {
      const tr = trList[t]
      for (let d = tr.tdList.length - 1; d >= 0; d--) {
        const td = tr.tdList[d]
        const { rowspan, rowIndex, colIndex } = td
        const curRowIndex = rowIndex! + rowspan - 1
        if (curRowIndex !== d) {
          const changeTd = tr.tdList.splice(d, 1)[0]
          trList[curRowIndex]?.tdList.splice(colIndex!, 0, changeTd)
        }
      }
    }
    return trList
  }

  public getRangeRowCol(): ITd[][] | null {
    const { isTable, index, trIndex, tdIndex } = this.draw
      .getPosition()
      .getPositionContext()
    if (!isTable) return null
    const {
      isCrossRowCol,
      startTdIndex,
      endTdIndex,
      startTrIndex,
      endTrIndex
    } = this.range.getRange()
    const originalElementList = this.draw.getOriginalElementList()
    const element = originalElementList[index!]
    const curTrList = element.trList!
    // 非跨列直接返回光标所在单元格
    if (!isCrossRowCol) {
      return [[curTrList[trIndex!].tdList[tdIndex!]]]
    }
    let startTd = curTrList[startTrIndex!].tdList[startTdIndex!]
    let endTd = curTrList[endTrIndex!].tdList[endTdIndex!]
    // 交换起始位置
    if (startTd.x! > endTd.x! || startTd.y! > endTd.y!) {
      ;[startTd, endTd] = [endTd, startTd]
    }
    const startColIndex = startTd.colIndex!
    const endColIndex = endTd.colIndex! + (endTd.colspan - 1)
    const startRowIndex = startTd.rowIndex!
    const endRowIndex = endTd.rowIndex! + (endTd.rowspan - 1)
    // 选区行列
    const rowCol: ITd[][] = []
    for (let t = 0; t < curTrList.length; t++) {
      const tr = curTrList[t]
      const tdList: ITd[] = []
      for (let d = 0; d < tr.tdList.length; d++) {
        const td = tr.tdList[d]
        const tdColIndex = td.colIndex!
        const tdRowIndex = td.rowIndex!
        if (
          tdColIndex >= startColIndex &&
          tdColIndex <= endColIndex &&
          tdRowIndex >= startRowIndex &&
          tdRowIndex <= endRowIndex
        ) {
          tdList.push(td)
        }
      }
      if (tdList.length) {
        rowCol.push(tdList)
      }
    }
    return rowCol.length ? rowCol : null
  }

  private _drawSlash(
    ctx: CanvasRenderingContext2D,
    td: ITd,
    startX: number,
    startY: number
  ) {
    const { scale } = this.options
    ctx.save()
    const width = td.width! * scale
    const height = td.height! * scale
    const x = Math.round(td.x! * scale + startX)
    const y = Math.round(td.y! * scale + startY)
    // 正斜线 /
    if (td.slashTypes?.includes(TdSlash.FORWARD)) {
      ctx.moveTo(x + width, y)
      ctx.lineTo(x, y + height)
    }
    // 反斜线 \
    if (td.slashTypes?.includes(TdSlash.BACK)) {
      ctx.moveTo(x, y)
      ctx.lineTo(x + width, y + height)
    }
    ctx.stroke()
    ctx.restore()
  }

  private _drawBorder(
    ctx: CanvasRenderingContext2D,
    element: IElement,
    startX: number,
    startY: number
  ) {
    const {
      colgroup,
      trList,
      borderType,
      borderStyle,
      borderColor,
      borderWidth = 1,
      borderExternalWidth
    } = element
    if (!colgroup || !trList) return
    const {
      scale,
      table: { defaultBorderColor }
    } = this.options

    // 无边框
    const isEmptyBorderType = borderType === TableBorder.EMPTY
    // 仅外边框
    const isExternalBorderType = borderType === TableBorder.EXTERNAL
    // 内边框
    const isInternalBorderType = borderType === TableBorder.INTERNAL

    // 构建单元格索引映射，用于查询相邻单元格是否有显式边框控制
    const tdMap = new Map<string, ITd>()
    for (let t = 0; t < trList.length; t++) {
      const tr = trList[t]
      for (let d = 0; d < tr.tdList.length; d++) {
        const td = tr.tdList[d]
        tdMap.set(`${td.rowIndex},${td.colIndex}`, td)
      }
    }

    ctx.save()
    // 虚线 / 边框样式
    if (borderStyle === TableBorderStyle.DASHED) {
      ctx.setLineDash([3, 3])
    } else if (borderStyle === TableBorderStyle.DOTTED) {
      ctx.setLineDash([1, 2])
    } else if (borderType === TableBorder.DASH) {
      ctx.setLineDash([3, 3])
    }
    ctx.lineWidth = borderWidth * scale
    ctx.strokeStyle = borderColor || defaultBorderColor

    // 渲染单元格
    for (let t = 0; t < trList.length; t++) {
      const tr = trList[t]
      for (let d = 0; d < tr.tdList.length; d++) {
        const td = tr.tdList[d]
        // 单元格内斜线
        if (td.slashTypes?.length) {
          this._drawSlash(ctx, td, startX, startY)
        }
        // 没有设置单元格边框 && 没有设置表格边框则忽略
        if (
          !td.borderTypes?.length &&
          (isEmptyBorderType || isExternalBorderType)
        ) {
          continue
        }
        const width = td.width! * scale
        const height = td.height! * scale
        const x = Math.round(td.x! * scale + startX + width)
        const y = Math.round(td.y! * scale + startY)

        ctx.save()
        // 优先使用单元格级别的边框属性，回退到表格全局属性
        const cellBorderWidth = td.borderWidth ?? borderWidth ?? 1
        const cellBorderColor =
          td.borderColor || borderColor || defaultBorderColor
        const cellBorderStyle =
          td.borderStyle || borderStyle || TableBorderStyle.SOLID

        if (cellBorderStyle === TableBorderStyle.DASHED) {
          ctx.setLineDash([3, 3])
        } else if (cellBorderStyle === TableBorderStyle.DOTTED) {
          ctx.setLineDash([1, 2])
        } else if (borderType === TableBorder.DASH) {
          ctx.setLineDash([3, 3])
        } else {
          ctx.setLineDash([])
        }
        ctx.lineWidth = cellBorderWidth * scale
        ctx.strokeStyle = cellBorderColor

        ctx.translate(0.5, 0.5)
        ctx.beginPath()
        // 单元格显式边框（borderTypes 路径）
        // Shared edges are deduplicated: TOP is skipped when the top neighbour
        // already draws its BOTTOM; LEFT is skipped when the left neighbour
        // already draws its RIGHT.  This prevents double-stroking on shared
        // cell edges, which would make those lines appear visually bolder than
        // unmodified grid lines.
        if (td.borderTypes?.includes(TdBorder.TOP)) {
          const topNeighbor = tdMap.get(`${td.rowIndex! - 1},${td.colIndex}`)
          if (!topNeighbor?.borderTypes?.includes(TdBorder.BOTTOM)) {
            ctx.moveTo(x - width, y)
            ctx.lineTo(x, y)
            ctx.stroke()
          }
        }
        if (td.borderTypes?.includes(TdBorder.RIGHT)) {
          ctx.moveTo(x, y)
          ctx.lineTo(x, y + height)
          ctx.stroke()
        }
        if (td.borderTypes?.includes(TdBorder.BOTTOM)) {
          ctx.moveTo(x, y + height)
          ctx.lineTo(x - width, y + height)
          ctx.stroke()
        }
        if (td.borderTypes?.includes(TdBorder.LEFT)) {
          const leftNeighbor = tdMap.get(`${td.rowIndex},${td.colIndex! - 1}`)
          if (!leftNeighbor?.borderTypes?.includes(TdBorder.RIGHT)) {
            ctx.moveTo(x - width, y)
            ctx.lineTo(x - width, y + height)
            ctx.stroke()
          }
        }
        // 表格默认网格线
        // 如果单元格有显式 borderTypes（包括空数组），则跳过网格线
        const hasCellBorderControl = td.borderTypes !== undefined
        if (!hasCellBorderControl && !isEmptyBorderType) {
          const isOuterTop = td.rowIndex === 0
          const isOuterLeft = td.colIndex === 0
          const isOuterRight = td.colIndex! + td.colspan === colgroup.length
          const isOuterBottom = td.rowIndex! + td.rowspan === trList.length

          const drawGridLine = (
            startX: number,
            startY: number,
            endX: number,
            endY: number,
            isOuter: boolean
          ) => {
            if (
              isOuter &&
              borderExternalWidth &&
              borderExternalWidth !== borderWidth
            ) {
              ctx.stroke()
              ctx.beginPath()
              ctx.moveTo(startX, startY)
              ctx.lineTo(endX, endY)
              const lw = ctx.lineWidth
              ctx.lineWidth = borderExternalWidth * scale
              ctx.stroke()
              ctx.beginPath()
              ctx.lineWidth = lw
            } else {
              ctx.moveTo(startX, startY)
              ctx.lineTo(endX, endY)
            }
          }

          // TOP
          if (isOuterTop && !isInternalBorderType) {
            drawGridLine(x - width, y, x, y, true)
          }

          // LEFT
          if (isOuterLeft && !isInternalBorderType) {
            drawGridLine(x - width, y, x - width, y + height, true)
          }

          // RIGHT
          const rightNeighbor = tdMap.get(
            `${td.rowIndex},${td.colIndex! + td.colspan}`
          )
          const rightNeighborOwnsLeft =
            rightNeighbor?.borderTypes !== undefined &&
            rightNeighbor.borderTypes.includes(TdBorder.LEFT)

          const shouldDrawRight = isOuterRight
            ? !isInternalBorderType
            : !isExternalBorderType

          if (!rightNeighborOwnsLeft && shouldDrawRight) {
            drawGridLine(x, y, x, y + height, isOuterRight)
          }

          // BOTTOM
          const bottomNeighbor = tdMap.get(
            `${td.rowIndex! + td.rowspan},${td.colIndex}`
          )
          const bottomNeighborOwnsTop =
            bottomNeighbor?.borderTypes !== undefined &&
            bottomNeighbor.borderTypes.includes(TdBorder.TOP)

          const shouldDrawBottom = isOuterBottom
            ? !isInternalBorderType
            : !isExternalBorderType

          if (!bottomNeighborOwnsTop && shouldDrawBottom) {
            drawGridLine(x, y + height, x - width, y + height, isOuterBottom)
          }

          ctx.stroke()
        }
        ctx.translate(-0.5, -0.5)
        ctx.restore()
      }
    }
    ctx.restore()
  }

  private _drawBackgroundColor(
    ctx: CanvasRenderingContext2D,
    element: IElement,
    startX: number,
    startY: number
  ) {
    const { trList } = element
    if (!trList) return
    const { scale } = this.options
    for (let t = 0; t < trList.length; t++) {
      const tr = trList[t]
      for (let d = 0; d < tr.tdList.length; d++) {
        const td = tr.tdList[d]
        if (!td.backgroundColor) continue
        ctx.save()
        const width = td.width! * scale
        const height = td.height! * scale
        const x = Math.round(td.x! * scale + startX)
        const y = Math.round(td.y! * scale + startY)
        ctx.fillStyle = td.backgroundColor
        ctx.fillRect(x, y, width, height)
        ctx.restore()
      }
    }
  }

  public getTableWidth(element: IElement): number {
    return element.colgroup!.reduce((pre, cur) => pre + cur.width, 0)
  }

  public getTableHeight(element: IElement): number {
    const trList = element.trList
    if (!trList?.length) return 0
    return this.getTdListByColIndex(trList, 0).reduce(
      (pre, cur) => pre + cur.height!,
      0
    )
  }

  public getRowCountByColIndex(trList: ITr[], colIndex: number): number {
    return this.getTdListByColIndex(trList, colIndex).reduce(
      (pre, cur) => pre + cur.rowspan,
      0
    )
  }

  public getTdListByColIndex(trList: ITr[], colIndex: number): ITd[] {
    const data: ITd[] = []
    for (let r = 0; r < trList.length; r++) {
      const tdList = trList[r].tdList
      for (let d = 0; d < tdList.length; d++) {
        const td = tdList[d]
        const min = td.colIndex!
        const max = min + td.colspan - 1
        if (colIndex >= min && colIndex <= max) {
          data.push(td)
        }
      }
    }
    return data
  }

  public getTdListByRowIndex(trList: ITr[], rowIndex: number) {
    const data: ITd[] = []
    for (let r = 0; r < trList.length; r++) {
      const tdList = trList[r].tdList
      for (let d = 0; d < tdList.length; d++) {
        const td = tdList[d]
        const min = td.rowIndex!
        const max = min + td.rowspan - 1
        if (rowIndex >= min && rowIndex <= max) {
          data.push(td)
        }
      }
    }
    return data
  }

  public computeRowColInfo(element: IElement) {
    const { colgroup, trList } = element
    if (!colgroup || !trList) return
    let preX = 0
    for (let t = 0; t < trList.length; t++) {
      const tr = trList[t]
      // 表格最后一行
      const isLastTr = trList.length - 1 === t
      // 当前行最小高度
      let rowMinHeight = 0
      for (let d = 0; d < tr.tdList.length; d++) {
        const td = tr.tdList[d]
        // 计算当前td所属列索引
        let colIndex = 0
        // 第一行td位置为当前列索引+上一个单元格colspan，否则从第一行开始计算列偏移量
        if (trList.length > 1 && t !== 0) {
          // 当前列起始索引：以之前单元格为起始点
          const preTd = tr.tdList[d - 1]
          const start = preTd ? preTd.colIndex! + preTd.colspan : d
          for (let c = start; c < colgroup.length; c++) {
            // 查找相同索引列之前行数，相加判断是否位置被挤占
            const rowCount = this.getRowCountByColIndex(trList.slice(0, t), c)
            // 不存在挤占则默认当前单元格可以存在该位置
            if (rowCount === t) {
              colIndex = c
              // 重置单元格起始位置坐标
              let preColWidth = 0
              for (let preC = 0; preC < c; preC++) {
                preColWidth += colgroup[preC].width
              }
              preX = preColWidth
              break
            }
          }
        } else {
          const preTd = tr.tdList[d - 1]
          if (preTd) {
            colIndex = preTd.colIndex! + preTd.colspan
          }
        }
        // 计算格宽高
        let width = 0
        for (let col = 0; col < td.colspan; col++) {
          width += colgroup[col + colIndex].width
        }
        let height = 0
        for (let row = 0; row < td.rowspan; row++) {
          const curTr = trList[row + t] || trList[t]
          height += curTr.height
        }
        // y偏移量
        if (rowMinHeight === 0 || rowMinHeight > height) {
          rowMinHeight = height
        }
        // 当前行最后一个td
        const isLastRowTd = tr.tdList.length - 1 === d
        // 当前列最后一个td
        let isLastColTd = isLastTr
        if (!isLastColTd) {
          if (td.rowspan > 1) {
            const nextTrLength = trList.length - 1 - t
            isLastColTd = td.rowspan - 1 === nextTrLength
          }
        }
        // 当前表格最后一个td
        const isLastTd = isLastTr && isLastRowTd
        td.isLastRowTd = isLastRowTd
        td.isLastColTd = isLastColTd
        td.isLastTd = isLastTd
        // 修改当前格clientBox
        td.x = preX
        // 之前行相同列的高度
        let preY = 0
        for (let preR = 0; preR < t; preR++) {
          const preTdList = trList[preR].tdList
          for (let preD = 0; preD < preTdList.length; preD++) {
            const td = preTdList[preD]
            if (
              colIndex >= td.colIndex! &&
              colIndex < td.colIndex! + td.colspan
            ) {
              preY += td.height!
              break
            }
          }
        }
        td.y = preY
        td.width = width
        td.height = height
        td.rowIndex = t
        td.colIndex = colIndex
        td.trIndex = t
        td.tdIndex = d
        // 当前列x轴累加
        preX += width
        // 一行中的最后td
        if (isLastRowTd && !isLastTd) {
          preX = 0
        }
      }
    }
  }

  public drawRange(
    ctx: CanvasRenderingContext2D,
    element: IElement,
    startX: number,
    startY: number
  ) {
    const { scale, rangeAlpha, rangeColor } = this.options
    const { type, trList } = element
    if (!trList || type !== ElementType.TABLE) return
    const {
      isCrossRowCol,
      startTdIndex,
      endTdIndex,
      startTrIndex,
      endTrIndex
    } = this.range.getRange()
    // 存在跨行/列
    if (!isCrossRowCol) return
    let startTd = trList[startTrIndex!].tdList[startTdIndex!]
    let endTd = trList[endTrIndex!].tdList[endTdIndex!]
    // 交换起始位置
    if (startTd.x! > endTd.x! || startTd.y! > endTd.y!) {
      ;[startTd, endTd] = [endTd, startTd]
    }
    const startColIndex = startTd.colIndex!
    const endColIndex = endTd.colIndex! + (endTd.colspan - 1)
    const startRowIndex = startTd.rowIndex!
    const endRowIndex = endTd.rowIndex! + (endTd.rowspan - 1)
    ctx.save()
    for (let t = 0; t < trList.length; t++) {
      const tr = trList[t]
      for (let d = 0; d < tr.tdList.length; d++) {
        const td = tr.tdList[d]
        const tdColIndex = td.colIndex!
        const tdRowIndex = td.rowIndex!
        if (
          tdColIndex >= startColIndex &&
          tdColIndex <= endColIndex &&
          tdRowIndex >= startRowIndex &&
          tdRowIndex <= endRowIndex
        ) {
          const x = td.x! * scale
          const y = td.y! * scale
          const width = td.width! * scale
          const height = td.height! * scale
          ctx.globalAlpha = rangeAlpha
          ctx.fillStyle = rangeColor
          ctx.fillRect(x + startX, y + startY, width, height)
        }
      }
    }
    ctx.restore()
  }

  public render(
    ctx: CanvasRenderingContext2D,
    element: IElement,
    startX: number,
    startY: number
  ) {
    this._drawBackgroundColor(ctx, element, startX, startY)
    this._drawBorder(ctx, element, startX, startY)
  }

  public static FIGURE_LABEL_GAP = 6
  public static FIGURE_DESCRIPTION_GAP = 8

  public isTableFigure(element: IElement): boolean {
    return (
      element.type === ElementType.TABLE &&
      (!!element.tableFigureLabel ||
        !!element.tableFigureCaption ||
        !!element.tableFigureDescription)
    )
  }

  public getTableFigureLabelHeight(element: IElement): number {
    if (!this.isTableFigure(element)) return 0
    const { scale, imgCaption } = this.options
    const fontSize = imgCaption.size + 2
    return (fontSize + TableParticle.FIGURE_LABEL_GAP) * scale
  }

  public getTableFigureDescriptionHeight(element: IElement): number {
    if (!element.tableFigureDescription) return 0
    const { scale, imgCaption } = this.options
    return (imgCaption.size + TableParticle.FIGURE_DESCRIPTION_GAP) * scale
  }
}
