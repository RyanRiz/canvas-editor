import { MoveDirection } from '../../../../dataset/enum/Observer'
import { CanvasEvent } from '../../CanvasEvent'

export function tab(evt: KeyboardEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  const isReadonly = draw.isReadonly()
  if (isReadonly) return
  evt.preventDefault()
  // 在控件上下文时，tab键控制控件之间移动
  const control = draw.getControl()
  const activeControl = control.getActiveControl()
  if (activeControl && control.getIsRangeWithinControl()) {
    control.initNextControl({
      direction: evt.shiftKey ? MoveDirection.UP : MoveDirection.DOWN
    })
    return
  }
  // 缩进/减少缩进
  const rangeManager = draw.getRange()
  const { startIndex, endIndex } = rangeManager.getRange()
  if (!~startIndex && !~endIndex) return
  const rowElementList = rangeManager.getRangeRowElementList()
  if (!rowElementList) return
  rowElementList.forEach(element => {
    const currentIndent = element.indent || 0
    if (evt.shiftKey) {
      if (currentIndent > 0) {
        element.indent = currentIndent - 1
      }
    } else {
      element.indent = currentIndent + 1
    }
  })
  const isSetCursor = startIndex === endIndex
  const curIndex = isSetCursor ? endIndex : startIndex
  draw.render({ curIndex, isSetCursor })
}
