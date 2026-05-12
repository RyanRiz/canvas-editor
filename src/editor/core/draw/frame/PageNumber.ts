import { FORMAT_PLACEHOLDER } from '../../../dataset/constant/PageNumber'
import { NumberType } from '../../../dataset/enum/Common'
import { RowFlex } from '../../../dataset/enum/Row'
import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { convertNumberToChinese, convertNumberToRoman } from '../../../utils'
import { Draw } from '../Draw'

export class PageNumber {
  private draw: Draw
  private options: DeepRequired<IEditorOption>

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
  }

  static formatNumberPlaceholder(
    text: string,
    pageNo: number,
    replaceReg: RegExp,
    numberType: NumberType
  ) {
    let pageNoText: string
    switch (numberType) {
      case NumberType.CHINESE:
        pageNoText = convertNumberToChinese(pageNo)
        break
      case NumberType.ROMAN_UPPER:
        pageNoText = convertNumberToRoman(pageNo, true)
        break
      case NumberType.ROMAN_LOWER:
        pageNoText = convertNumberToRoman(pageNo, false)
        break
      default:
        pageNoText = `${pageNo}`
    }
    return text.replace(replaceReg, pageNoText)
  }

  public render(ctx: CanvasRenderingContext2D, pageNo: number) {
    const {
      scale,
      pageNumber: {
        size,
        font,
        color,
        rowFlex,
        numberType,
        format,
        startPageNo,
        fromPageNo
      },
      header,
      footer
    } = this.options
    // `Different first page` treats page 0 as a cover; auto-skip it for the
    // global page-number frame too so numbering matches the inline tokens.
    const skipFirstCover = !!header?.firstPageEnabled || !!footer?.firstPageEnabled
    const effectiveFrom = Math.max(fromPageNo, skipFirstCover ? 1 : 0)
    if (pageNo < effectiveFrom) return
    // 处理页码格式
    let text = format
    const pageNoReg = new RegExp(FORMAT_PLACEHOLDER.PAGE_NO)
    if (pageNoReg.test(text)) {
      text = PageNumber.formatNumberPlaceholder(
        text,
        pageNo + startPageNo - effectiveFrom,
        pageNoReg,
        numberType
      )
    }
    const pageCountReg = new RegExp(FORMAT_PLACEHOLDER.PAGE_COUNT)
    if (pageCountReg.test(text)) {
      text = PageNumber.formatNumberPlaceholder(
        text,
        this.draw.getPageCount() - effectiveFrom,
        pageCountReg,
        numberType
      )
    }
    const width = this.draw.getWidth()
    // 计算y位置
    const height = this.draw.getHeight()
    const pageNumberBottom = this.draw.getPageNumberBottom()
    const y = height - pageNumberBottom
    ctx.save()
    ctx.fillStyle = color
    ctx.font = `${size * scale}px ${font}`
    // 计算x位置-居左、居中、居右
    let x = 0
    const margins = this.draw.getMargins()
    const { width: textWidth } = ctx.measureText(text)
    if (rowFlex === RowFlex.CENTER) {
      x = (width - textWidth) / 2
    } else if (rowFlex === RowFlex.RIGHT) {
      x = width - textWidth - margins[1]
    } else {
      x = margins[3]
    }
    ctx.fillText(text, x, y)
    ctx.restore()
  }
}
