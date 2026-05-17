import { ZERO } from '../../../dataset/constant/Common'
import {
  EDITOR_ELEMENT_COPY_ATTR,
  EDITOR_ELEMENT_STYLE_ATTR
} from '../../../dataset/constant/Element'
import { ElementType } from '../../../dataset/enum/Element'
import { IElement } from '../../../interface/Element'
import { IRangeElementStyle } from '../../../interface/Range'
import { splitText } from '../../../utils'
import { formatElementContext } from '../../../utils/element'
import {
  applyAutoFormat,
  matchAutoFormatTrigger
} from '../../../utils/autoFormat'
import { CanvasEvent } from '../CanvasEvent'

export function input(data: string, host: CanvasEvent) {
  const draw = host.getDraw()
  if (draw.isReadonly() || draw.isDisabled()) return
  const position = draw.getPosition()
  const cursorPosition = position.getCursorPosition()
  if (!data || !cursorPosition) return
  const isComposing = host.isComposing
  // 正在合成文本进行非输入操作
  if (isComposing && host.compositionInfo?.value === data) return
  const rangeManager = draw.getRange()
  if (!rangeManager.getIsCanInput()) return
  // 移除合成前，缓存设置的默认样式设置
  const defaultStyle =
    rangeManager.getDefaultStyle() || host.compositionInfo?.defaultStyle || null
  // 移除合成输入
  removeComposingInput(host)
  if (!isComposing) {
    const cursor = draw.getCursor()
    cursor.clearAgentDomValue()
  }
  const { TEXT, HYPERLINK, SUBSCRIPT, SUPERSCRIPT, DATE, TAB } = ElementType
  const text = data.replaceAll(`\n`, ZERO)
  const { startIndex, endIndex } = rangeManager.getRange()
  // 格式化元素
  const elementList = draw.getElementList()
  const copyElement = rangeManager.getRangeAnchorStyle(elementList, endIndex)
  if (!copyElement) return
  // Word/GDocs auto-format triggers (e.g. "*" + space → bullet, "1." + space →
  // numbered list). Detect a trigger BEFORE the space character is inserted;
  // if matched, swap the typed space for an atomic paragraph→list conversion
  // that submits a single history snapshot. Skipped during IME composition.
  if (!isComposing && data === ' ' && startIndex === endIndex) {
    const match = matchAutoFormatTrigger(elementList, endIndex, data)
    if (match) {
      const newIdx = applyAutoFormat(
        elementList,
        match.zeroIndex,
        endIndex,
        match.entry
      )
      rangeManager.setRange(newIdx, newIdx)
      // Force paint + list-layout invalidation so the new list marker
      // renders immediately. Direct elementList mutation here bypasses the
      // markDirty/executeDelta cycle that toolbar list operations rely on.
      draw.invalidatePaintCache?.()
      draw.invalidateListLayoutCache?.()
      draw.render({ curIndex: newIdx, isSubmitHistory: true })
      return
    }
  }
  const isDesignMode = draw.isDesignMode()
  const inputData: IElement[] = splitText(text).map(value => {
    const newElement: IElement = {
      value
    }
    if (
      isDesignMode ||
      (!copyElement.title?.disabled && !copyElement.control?.disabled)
    ) {
      const nextElement = elementList[endIndex + 1]
      // 文本、超链接、日期、上下标：复制所有信息（元素类型、样式、特殊属性）
      if (
        !copyElement.type ||
        copyElement.type === TEXT ||
        (copyElement.type === HYPERLINK && nextElement?.type === HYPERLINK) ||
        (copyElement.type === DATE && nextElement?.type === DATE) ||
        (copyElement.type === SUBSCRIPT && nextElement?.type === SUBSCRIPT) ||
        (copyElement.type === SUPERSCRIPT && nextElement?.type === SUPERSCRIPT)
      ) {
        EDITOR_ELEMENT_COPY_ATTR.forEach(attr => {
          // 在分组外无需复制分组信息
          if (attr === 'groupIds' && !nextElement?.groupIds) return
          const value = copyElement[attr] as never
          if (value !== undefined) {
            newElement[attr] = value
          }
        })
      }
      // 仅复制样式：存在默认样式设置 || 无法匹配文本类元素时（TAB）
      if (defaultStyle || copyElement.type === TAB) {
        EDITOR_ELEMENT_STYLE_ATTR.forEach(attr => {
          const value = Object.prototype.hasOwnProperty.call(
            defaultStyle || {},
            attr
          )
            ? defaultStyle?.[attr as keyof IRangeElementStyle]
            : copyElement[attr]
          if (value !== undefined) {
            newElement[attr] = value as never
          }
        })
        if (
          defaultStyle &&
          Object.prototype.hasOwnProperty.call(defaultStyle, 'extension')
        ) {
          newElement.extension = defaultStyle.extension
        }
      }
      if (isComposing) {
        newElement.underline = true
      }
    }
    return newElement
  })
  // 控件-移除placeholder
  const control = draw.getControl()
  let curIndex: number
  if (control.getActiveControl() && control.getIsRangeWithinControl()) {
    curIndex = control.setValue(inputData)
    if (!isComposing) {
      control.emitControlContentChange()
    }
  } else {
    const start = startIndex + 1
    if (startIndex !== endIndex) {
      draw.spliceElementList(elementList, start, endIndex - startIndex)
    }
    formatElementContext(elementList, inputData, startIndex, {
      editorOptions: draw.getOptions()
    })
    draw.spliceElementList(elementList, start, 0, inputData)
    curIndex = startIndex + inputData.length
  }
  if (~curIndex) {
    rangeManager.setRange(curIndex, curIndex)
    // rAF 合并：fast typing 的连续 keystroke 会被合并为单帧 layout（PERF-PLAN §1.1）。
    // isTextInput=true 进入 history 合批：连续输入只在 idle / 非输入动作时落盘单个 snapshot（§1.2）
    draw.scheduleRender({
      curIndex,
      isSubmitHistory: !isComposing,
      isTextInput: true
    })
  }
  if (isComposing && ~curIndex) {
    host.compositionInfo = {
      elementList,
      value: text,
      startIndex: curIndex - inputData.length,
      endIndex: curIndex,
      defaultStyle
    }
  }
}

export function removeComposingInput(host: CanvasEvent) {
  if (!host.compositionInfo) return
  const { elementList, startIndex, endIndex } = host.compositionInfo
  elementList.splice(startIndex + 1, endIndex - startIndex)
  const rangeManager = host.getDraw().getRange()
  rangeManager.setRange(startIndex, startIndex)
  host.compositionInfo = null
}
