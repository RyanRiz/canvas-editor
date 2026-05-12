import { ZERO } from '../../../../dataset/constant/Common'
import { EDITOR_ELEMENT_STYLE_ATTR } from '../../../../dataset/constant/Element'
import { ElementType } from '../../../../dataset/enum/Element'
import { MoveDirection } from '../../../../dataset/enum/Observer'
import { IElement } from '../../../../interface/Element'
import { pickObject } from '../../../../utils'
import { formatElementContext } from '../../../../utils/element'
import { CanvasEvent } from '../../CanvasEvent'

export function tab(evt: KeyboardEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  const isReadonly = draw.isReadonly()
  if (isReadonly) return
  evt.preventDefault()

  const control = draw.getControl()
  const activeControl = control.getActiveControl()
  if (activeControl && control.getIsRangeWithinControl()) {
    control.initNextControl({
      direction: evt.shiftKey ? MoveDirection.UP : MoveDirection.DOWN
    })
    return
  }

  const rangeManager = draw.getRange()
  const elementList = draw.getElementList()
  const { startIndex, endIndex } = rangeManager.getRange()
  const isCollapsed = rangeManager.getIsCollapsed()
  const listParticle = draw.getListParticle()

  if (!isCollapsed) {
    const paragraphs = rangeManager.getRangeParagraphElementList()
    const hasList = paragraphs?.some(el => el.listId)
    if (hasList) {
      if (evt.shiftKey) {
        listParticle.outdent()
      } else {
        listParticle.indent()
      }
      return
    }
  } else {
    const endElement = elementList[endIndex]
    const atListItemStart = !!endElement?.listId && endElement.value === ZERO
    if (atListItemStart) {
      if (evt.shiftKey) {
        listParticle.outdent()
      } else {
        listParticle.indent()
      }
      return
    }
    if (evt.shiftKey) return
  }

  const anchorStyle = rangeManager.getRangeAnchorStyle(elementList, endIndex)
  const copyStyle = anchorStyle
    ? pickObject(anchorStyle, EDITOR_ELEMENT_STYLE_ATTR)
    : null
  const tabElement: IElement = {
    ...copyStyle,
    type: ElementType.TAB,
    value: ''
  }
  formatElementContext(elementList, [tabElement], startIndex, {
    editorOptions: draw.getOptions()
  })
  draw.insertElementList([tabElement])
}
