import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { IRowElement } from '../../../interface/Row'
import { SectionBreakType } from '../../../dataset/enum/SectionBreak'
import { I18n } from '../../i18n/I18n'
import { Draw } from '../Draw'

/**
 * Renders the in-document section-break placeholder. We reuse the page-break
 * visual idiom (dashed rule + centred label) and only swap the label, so the
 * user can still tell a NEXT_PAGE break from an EVEN_PAGE break at a glance.
 *
 * Section parity decisions (skip blank pages for EVEN_PAGE / ODD_PAGE) happen
 * in Draw._computePageList; this particle is purely cosmetic.
 */
export class SectionBreakParticle {
  private draw: Draw
  private options: DeepRequired<IEditorOption>
  private i18n: I18n

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
    this.i18n = draw.getI18n()
  }

  private getDisplayName(type?: SectionBreakType): string {
    const base = this.i18n.t('sectionBreak.displayName')
    const variant = (() => {
      switch (type) {
        case SectionBreakType.CONTINUOUS:
          return this.i18n.t('sectionBreak.continuous')
        case SectionBreakType.EVEN_PAGE:
          return this.i18n.t('sectionBreak.evenPage')
        case SectionBreakType.ODD_PAGE:
          return this.i18n.t('sectionBreak.oddPage')
        case SectionBreakType.NEXT_PAGE:
        default:
          return this.i18n.t('sectionBreak.nextPage')
      }
    })()
    return `${base} (${variant})`
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
    const displayName = this.getDisplayName(element.sectionBreakType)
    const { scale, defaultRowMargin } = this.options
    const size = fontSize * scale
    const elementWidth = element.width! * scale
    const offsetY =
      this.draw.getDefaultBasicRowMarginHeight() * defaultRowMargin
    ctx.save()
    ctx.font = `${size}px ${font}`
    const textMeasure = ctx.measureText(displayName)
    const halfX = (elementWidth - textMeasure.width) / 2
    // 线段
    ctx.setLineDash(lineDash)
    ctx.translate(0, 0.5 + offsetY)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + halfX, y)
    ctx.moveTo(x + halfX + textMeasure.width, y)
    ctx.lineTo(x + elementWidth, y)
    ctx.stroke()
    // 文字
    ctx.fillText(
      displayName,
      x + halfX,
      y + textMeasure.actualBoundingBoxAscent - size / 2
    )
    ctx.restore()
  }
}
