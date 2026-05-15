import { NBSP, ZERO } from '../../../dataset/constant/Common'
import { TEXTLIKE_ELEMENT_TYPE } from '../../../dataset/constant/Element'
import { ListStyle } from '../../../dataset/enum/List'
import { VerticalAlign } from '../../../dataset/enum/VerticalAlign'
import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { IElement } from '../../../interface/Element'
import { IRow, IRowElement } from '../../../interface/Row'
import { Draw } from '../Draw'

interface ICheckboxRenderOption {
  ctx: CanvasRenderingContext2D
  x: number
  y: number
  row: IRow
  index: number
}

export class CheckboxParticle {
  private draw: Draw
  private options: DeepRequired<IEditorOption>

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
  }

  public setSelect(element: IElement) {
    const prevValue = !!element.checkbox?.value
    const nextValue = !prevValue
    const draw = this.draw

    // Find the paragraph's ZERO element (which holds the checkbox + checklistStyle)
    const elementList = draw.getElementList()
    const elIdx = elementList.indexOf(element)
    let zeroElement = element
    let zeroIdx = elIdx
    if (elIdx >= 0) {
      let p = elIdx
      while (p > 0 && elementList[p].value !== ZERO) p--
      if (
        elementList[p].value === ZERO &&
        elementList[p].listStyle === ListStyle.CHECKBOX
      ) {
        zeroElement = elementList[p]
        zeroIdx = p
      }
    }

    // Collect text-element indices within this paragraph for styling
    const textIndices: number[] = []
    if (zeroElement.listStyle === ListStyle.CHECKBOX) {
      let p = zeroIdx + 1
      while (p < elementList.length && elementList[p].value !== ZERO) {
        const t = elementList[p].type
        if (!t || TEXTLIKE_ELEMENT_TYPE.includes(t)) {
          textIndices.push(p)
        }
        p++
      }
    }

    const checklistStyle = zeroElement.checklistStyle || 'standard'
    const mutedColor = '#5F6368'

    // Capture old text styles for undo
    const oldTextStyles = textIndices.map(i => ({
      index: i,
      strikeout: elementList[i].strikeout,
      color: elementList[i].color
    }))

    const applyForward = () => {
      if (element.checkbox) {
        element.checkbox.value = nextValue
      } else {
        element.checkbox = { value: nextValue }
      }
      const list = draw.getElementList()
      for (const item of oldTextStyles) {
        const el = list[item.index]
        if (!el) continue
        if (nextValue) {
          el.color = mutedColor
          if (checklistStyle === 'standard') el.strikeout = true
        } else {
          delete el.color
          delete el.strikeout
        }
      }
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false
      })
    }

    const applyBackward = () => {
      if (element.checkbox) {
        element.checkbox.value = prevValue
      } else {
        element.checkbox = { value: prevValue }
      }
      const list = draw.getElementList()
      for (const item of oldTextStyles) {
        const el = list[item.index]
        if (!el) continue
        if (item.strikeout !== undefined) el.strikeout = item.strikeout
        else delete el.strikeout
        if (item.color !== undefined) el.color = item.color
        else delete el.color
      }
      draw.render({
        isCompute: false,
        isSetCursor: false,
        isSubmitHistory: false
      })
    }

    applyForward()
    draw.getHistoryManager().executeDelta({
      applyForward,
      applyBackward
    })
  }

  public render(payload: ICheckboxRenderOption) {
    const { ctx, x, index, row } = payload
    let { y } = payload
    const {
      checkbox: {
        gap,
        lineWidth,
        fillStyle,
        strokeStyle,
        checkFillStyle,
        checkStrokeStyle,
        checkMarkColor,
        verticalAlign
      },
      scale
    } = this.options
    const { metrics, checkbox } = row.elementList[index]
    // 垂直布局设置
    if (
      verticalAlign === VerticalAlign.TOP ||
      verticalAlign === VerticalAlign.MIDDLE
    ) {
      let nextIndex = index + 1
      let nextElement: IRowElement | null = null
      while (nextIndex < row.elementList.length) {
        nextElement = row.elementList[nextIndex]
        if (nextElement.value !== ZERO && nextElement.value !== NBSP) break
        nextIndex++
      }
      if (nextElement) {
        const {
          metrics: { boundingBoxAscent, boundingBoxDescent }
        } = nextElement
        const textHeight = boundingBoxAscent + boundingBoxDescent
        if (textHeight > metrics.height) {
          if (verticalAlign === VerticalAlign.TOP) {
            y -= boundingBoxAscent - metrics.height
          } else if (verticalAlign === VerticalAlign.MIDDLE) {
            y -= (textHeight - metrics.height) / 2
          }
        }
      }
    }
    // Rounded rectangle dimensions
    const left = Math.round(x + gap * scale)
    const top = Math.round(y - metrics.height)
    const boxWidth = metrics.width - gap * 2 * scale
    const boxHeight = metrics.height
    const cornerRadius = 2 * scale

    ctx.save()
    ctx.lineWidth = lineWidth * scale

    if (checkbox?.value) {
      // Checked: filled blue rect with white checkmark
      ctx.fillStyle = checkFillStyle
      ctx.strokeStyle = checkStrokeStyle
      this.roundRect(ctx, left, top, boxWidth, boxHeight, cornerRadius)
      ctx.fill()
      ctx.stroke()

      // White checkmark (two-stroke path matching GDocs proportions)
      ctx.beginPath()
      ctx.strokeStyle = checkMarkColor
      ctx.lineWidth = 2 * scale
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const cx = left + boxWidth * 0.25
      const cy = top + boxHeight * 0.55
      const mx = left + boxWidth * 0.45
      const my = top + boxHeight * 0.75
      const ex = left + boxWidth * 0.78
      const ey = top + boxHeight * 0.28
      ctx.moveTo(cx, cy)
      ctx.lineTo(mx, my)
      ctx.lineTo(ex, ey)
      ctx.stroke()
    } else {
      // Unchecked: white fill with gray border
      ctx.fillStyle = fillStyle
      ctx.strokeStyle = strokeStyle
      this.roundRect(ctx, left, top, boxWidth, boxHeight, cornerRadius)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
  }
}
