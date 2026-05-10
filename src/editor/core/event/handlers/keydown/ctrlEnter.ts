import { WRAP } from '../../../../dataset/constant/Common'
import { ElementType } from '../../../../dataset/enum/Element'
import { formatElementContext, formatElementList } from '../../../../utils/element'
import { CanvasEvent } from '../../CanvasEvent'

export function ctrlEnter(evt: KeyboardEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  if (draw.isReadonly()) return
  const rangeManager = draw.getRange()
  if (!rangeManager.getIsCanInput()) return
  const control = draw.getControl()
  if (control.getActiveControl() && control.getIsRangeWithinControl()) return
  const { startIndex, endIndex } = rangeManager.getRange()
  const isCollapsed = rangeManager.getIsCollapsed()
  const elementList = draw.getElementList()
  const pageBreakElementList = [
    {
      type: ElementType.PAGE_BREAK,
      value: WRAP
    }
  ]
  formatElementContext(elementList, pageBreakElementList, startIndex, {
    isBreakWhenWrap: true,
    editorOptions: draw.getOptions()
  })
  formatElementList(pageBreakElementList, {
    isHandleFirstElement: false,
    editorOptions: draw.getOptions()
  })
  const insertIndex = startIndex + 1
  if (!isCollapsed) {
    draw.spliceElementList(elementList, insertIndex, endIndex - startIndex)
  }
  draw.spliceElementList(elementList, insertIndex, 0, pageBreakElementList)
  const curIndex = startIndex + pageBreakElementList.length
  rangeManager.setRange(curIndex, curIndex)
  draw.scheduleRender({ curIndex })
  const nextIndex = curIndex + 1
  if (nextIndex < elementList.length) {
    requestAnimationFrame(() => {
      draw.getCursor().drawCursor({
        hitLineStartIndex: nextIndex
      })
    })
  }
  evt.preventDefault()
}
