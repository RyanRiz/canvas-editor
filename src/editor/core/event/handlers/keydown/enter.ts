import { ZERO } from '../../../../dataset/constant/Common'
import {
  AREA_CONTEXT_ATTR,
  EDITOR_ELEMENT_STYLE_ATTR,
  EDITOR_ROW_ATTR
} from '../../../../dataset/constant/Element'
import { ControlComponent } from '../../../../dataset/enum/Control'
import { IElement } from '../../../../interface/Element'
import { getUUID, omitObject } from '../../../../utils'
import { formatElementContext } from '../../../../utils/element'
import { CanvasEvent } from '../../CanvasEvent'

export function enter(evt: KeyboardEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  if (draw.isReadonly()) return
  const rangeManager = draw.getRange()
  if (!rangeManager.getIsCanInput()) return
  const { startIndex, endIndex } = rangeManager.getRange()
  const isCollapsed = rangeManager.getIsCollapsed()
  const elementList = draw.getElementList()
  const startElement = elementList[startIndex]
  const endElement = elementList[endIndex]
  // 空列表项回车: L>1 升级，L1 仅该项退出列表 (Word parity — single-item scope)
  if (isCollapsed && endElement.listId && endElement.value === ZERO) {
    const next = elementList[endIndex + 1]
    const isEmptyItem =
      !next ||
      next.listId !== endElement.listId ||
      (next.listId === endElement.listId && next.value === ZERO)
    if (isEmptyItem) {
      const listParticle = draw.getListParticle()
      const level = endElement.listLevel ?? 1
      if (level > 1) {
        listParticle.outdent()
        evt.preventDefault()
        return
      }
      // Single-paragraph exit: remove list from only the cursor item.
      // Items above keep their listId; items below get a fresh listId so
      // they restart numbering as a new list block.
      const exitedListId = endElement.listId
      // Capture by index, NOT by reference. _submitSnapshotHistory replaces
      // this.elementList via deepClone, invalidating element refs. Index-based
      // lookup at apply-time survives that restore.
      const exitOldValues = {
        mainIndex: endIndex,
        listId: endElement.listId,
        listType: endElement.listType,
        listStyle: endElement.listStyle,
        listWrap: endElement.listWrap,
        listLevel: endElement.listLevel
      }
      const newListId = getUUID()
      // Collect indices of all elements below that share the old listId —
      // they will be assigned a fresh listId so they become a new list block.
      const belowIndices: number[] = []
      let p = endIndex + 1
      while (
        p < elementList.length &&
        elementList[p]?.listId === exitedListId
      ) {
        belowIndices.push(p)
        p++
      }

      // Apply mutations
      delete endElement.listId
      delete endElement.listType
      delete endElement.listStyle
      delete endElement.listWrap
      delete endElement.listLevel
      for (const idx of belowIndices) {
        const el = elementList[idx]
        if (el) el.listId = newListId
      }

      // Push a single delta so undo/redo goes through applyBackward/applyForward
      // directly instead of _restoreUndoStackTop snapshot replay.
      const isSetCursor = true
      const curIndex = endIndex
      const dirtyStart = endIndex
      const dirtyEnd = endIndex + (belowIndices.length > 0 ? belowIndices[belowIndices.length - 1] : 0)
      draw.getHistoryManager().executeDelta({
        applyForward: () => {
          const list = draw.getElementList()
          const el = list[exitOldValues.mainIndex]
          if (el) {
            if (el.listId !== undefined) delete el.listId
            if (el.listType !== undefined) delete el.listType
            if (el.listStyle !== undefined) delete el.listStyle
            if (el.listWrap !== undefined) delete el.listWrap
            if (el.listLevel !== undefined) delete el.listLevel
          }
          for (const idx of belowIndices) {
            const b = list[idx]
            if (b) b.listId = newListId
          }
          draw.markDirty(dirtyStart, dirtyEnd)
          draw.invalidatePaintCache()
          draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
        },
        applyBackward: () => {
          const list = draw.getElementList()
          const el = list[exitOldValues.mainIndex]
          if (el) {
            if (exitOldValues.listId === undefined) delete el.listId
            else el.listId = exitOldValues.listId
            if (exitOldValues.listType === undefined) delete el.listType
            else el.listType = exitOldValues.listType
            if (exitOldValues.listStyle === undefined) delete el.listStyle
            else el.listStyle = exitOldValues.listStyle
            if (exitOldValues.listWrap === undefined) delete el.listWrap
            else el.listWrap = exitOldValues.listWrap
            if (exitOldValues.listLevel === undefined) delete el.listLevel
            else el.listLevel = exitOldValues.listLevel
          }
          for (const idx of belowIndices) {
            const b = list[idx]
            if (b) b.listId = exitedListId
          }
          draw.markDirty(dirtyStart, dirtyEnd)
          draw.invalidatePaintCache()
          draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
        }
      })
      draw.markDirty(dirtyStart, dirtyEnd)
      draw.invalidatePaintCache()
      draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      console.log(
        '[HIST-ENTER] Branch A exit-list DELTA pushed, stack=',
        (draw.getHistoryManager() as any).undoStack.length,
        'redo=',
        (draw.getHistoryManager() as any).redoStack.length
      )
      evt.preventDefault()
      return
    }
  }
  // 列表块内换行
  let enterText: IElement = {
    value: ZERO
  }
  // Inherit list properties so Enter inside a non-empty list item creates a
  // continuing list item (Word Desktop / Google Docs pattern).
  if (startElement.listId) {
    enterText.listId = startElement.listId
    enterText.listType = startElement.listType
    enterText.listStyle = startElement.listStyle
    enterText.listLevel = startElement.listLevel ?? 1
  }
  if (evt.shiftKey && startElement.listId) {
    enterText.listWrap = true
  }
  // 格式化上下文
  formatElementContext(elementList, [enterText], startIndex, {
    isBreakWhenWrap: true,
    editorOptions: draw.getOptions()
  })
  // shift长按 && 最后位置回车无需复制区域上下文
  if (
    evt.shiftKey &&
    endElement.areaId &&
    endElement.areaId !== elementList[endIndex + 1]?.areaId
  ) {
    enterText = omitObject(enterText, AREA_CONTEXT_ATTR)
  }
  // 标题开始 && 标题结尾处回车 => 无需格式化及样式复制
  if (
    !(
      elementList[startIndex + 1]?.titleId &&
      (!startElement.titleId ||
        startElement.titleId !== elementList[startIndex + 1]?.titleId)
    ) &&
    !(
      endElement.titleId &&
      endElement.titleId !== elementList[endIndex + 1]?.titleId
    )
  ) {
    // 复制样式属性
    const copyElement = rangeManager.getRangeAnchorStyle(elementList, endIndex)
    if (copyElement) {
      const copyAttr = [...EDITOR_ROW_ATTR]
      // 不复制控件后缀样式
      if (copyElement.controlComponent !== ControlComponent.POSTFIX) {
        copyAttr.push(...EDITOR_ELEMENT_STYLE_ATTR)
      }
      copyAttr.forEach(attr => {
        const value = copyElement[attr] as never
        if (value !== undefined) {
          enterText[attr] = value
        }
      })
    }
  }
  // 控件或文档插入换行元素
  const control = draw.getControl()
  const activeControl = control.getActiveControl()
  let curIndex: number
  if (activeControl && control.getIsRangeWithinControl()) {
    curIndex = control.setValue([enterText])
    control.emitControlContentChange()
  } else {
    const position = draw.getPosition()
    const cursorPosition = position.getCursorPosition()
    if (!cursorPosition) return
    const { index } = cursorPosition
    if (isCollapsed) {
      draw.spliceElementList(elementList, index + 1, 0, [enterText])
      // 如果在标题中间回车，为换行后的元素生成新的titleId
      if (
        endElement.titleId &&
        elementList[index + 2]?.titleId === endElement.titleId
      ) {
        const newTitleId = getUUID()
        // 循环处理换行符后面的标题元素
        let nextIndex = index + 2
        while (
          nextIndex < elementList.length &&
          elementList[nextIndex]?.titleId === endElement.titleId
        ) {
          elementList[nextIndex].titleId = newTitleId
          nextIndex++
        }
      }
    } else {
      draw.spliceElementList(
        elementList,
        startIndex + 1,
        endIndex - startIndex,
        [enterText]
      )
    }
    curIndex = index + 1
  }
  if (~curIndex) {
    rangeManager.setRange(curIndex, curIndex)
    draw.render({ curIndex })
    console.log(
      '[HIST-ENTER] Branch C normal Enter — render called, stack=',
      (draw.getHistoryManager() as any).undoStack.length,
      'redo=',
      (draw.getHistoryManager() as any).redoStack.length
    )
  }
  evt.preventDefault()
}
