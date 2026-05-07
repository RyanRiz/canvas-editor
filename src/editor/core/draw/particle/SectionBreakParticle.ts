import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { IRowElement } from '../../../interface/Row'
import { SectionBreakType } from '../../../dataset/enum/SectionBreak'
import { I18n } from '../../i18n/I18n'
import { Draw } from '../Draw'

export class SectionBreakParticle {
  private draw: Draw
  private options: DeepRequired<IEditorOption>
  private i18n: I18n

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
    this.i18n = draw.getI18n()
  }

  public render(
    ctx: CanvasRenderingContext2D,
    element: IRowElement,
    x: number,
    y: number
  ) {
    const {
      sectionBreak: { font, fontSize, lineDash }
    } = this.options
    const sectionBreakType = element.sectionBreakType || SectionBreakType.NEXT_PAGE
    const displayName = this.i18n.t(
      `sectionBreak.${sectionBreakType}`
    )
    const { scale, defaultRowMargin } = this.options
    const size = fontSize * scale
    const elementWidth = element.width! * scale
    const offsetY =
      this.draw.getDefaultBasicRowMarginHeight() * defaultRowMargin
    ctx.save()
    ctx.font = `${size}px ${font}`
    const textMeasure = ctx.measureText(displayName)
    const halfX = (elementWidth - textMeasure.width) / 2
    ctx.setLineDash(lineDash)
    ctx.translate(0, 0.5 + offsetY)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + halfX, y)
    ctx.moveTo(x + halfX + textMeasure.width, y)
    ctx.lineTo(x + elementWidth, y)
    ctx.stroke()
    ctx.fillText(
      displayName,
      x + halfX,
      y + textMeasure.actualBoundingBoxAscent - size / 2
    )
    ctx.restore()
  }
}
