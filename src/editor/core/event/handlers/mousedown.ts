import { ZERO } from '../../../dataset/constant/Common'
import { ImageDisplay } from '../../../dataset/enum/Common'
import { EditorMode } from '../../../dataset/enum/Editor'
import { ElementType } from '../../../dataset/enum/Element'
import { MouseEventButton } from '../../../dataset/enum/Event'
import { ControlComponent } from '../../../dataset/enum/Control'
import { ControlType } from '../../../dataset/enum/Control'
import { IPreviewerDrawOption } from '../../../interface/Previewer'
import { deepClone } from '../../../utils'
import { isMod } from '../../../utils/hotkey'
import { CheckboxControl } from '../../draw/control/checkbox/CheckboxControl'
import { RadioControl } from '../../draw/control/radio/RadioControl'
import { CanvasEvent } from '../CanvasEvent'
import { IElement } from '../../../interface/Element'
import { Draw } from '../../draw/Draw'

/**
 * Hit-test the click against any list-marker glyph painted on the current
 * page (bounds stamped by ListParticle.drawListStyle). On hit:
 *   • First click on a marker → setRange spanning the whole list block
 *     (every paragraph sharing the same listId, contiguous)
 *   • Second click on the SAME marker → setRange covering only that
 *     paragraph
 *
 * Returns true when a marker was hit and the selection was updated, so the
 * caller can bail out of the normal cursor-positioning path.
 */
function handleMarkerClick(evt: MouseEvent, host: CanvasEvent): boolean {
  const draw = host.getDraw()
  const target = evt.target as HTMLDivElement
  const pageIndexAttr = target?.dataset?.index
  if (pageIndexAttr === undefined) return false
  const pageIndex = Number(pageIndexAttr)
  const pageRowList = draw.getPageRowList()[pageIndex]
  if (!pageRowList) return false
  for (const row of pageRowList) {
    const bounds = row.listGlyphBounds
    if (!bounds) continue
    if (
      evt.offsetX >= bounds.x &&
      evt.offsetX <= bounds.x + bounds.width &&
      evt.offsetY >= bounds.y &&
      evt.offsetY <= bounds.y + bounds.height
    ) {
      return applyMarkerSelection(host, draw, row.startIndex)
    }
  }
  return false
}

/**
 * Apply the Google-Docs marker selection rule given the paragraph's ZERO
 * index. Idempotent: re-clicking the same marker toggles between
 * whole-list-block and single-paragraph scope.
 */
function applyMarkerSelection(
  host: CanvasEvent,
  draw: Draw,
  paragraphZeroIndex: number
): boolean {
  const elementList = draw.getElementList()
  const zero = elementList[paragraphZeroIndex]
  if (!zero?.listId) return false
  const listId = zero.listId
  const clickedLevel = zero.listLevel ?? 1
  const isSecondClick = host.markerSelectionRow === paragraphZeroIndex
  let startIndex = paragraphZeroIndex
  let endIndex = paragraphZeroIndex
  let selectionLevel: number | undefined
  if (isSecondClick) {
    // Single paragraph: walk forward until next ZERO (paragraph boundary)
    // or listId change.
    while (
      endIndex + 1 < elementList.length &&
      elementList[endIndex + 1].listId === listId &&
      elementList[endIndex + 1].value !== ZERO
    ) {
      endIndex++
    }
  } else {
    // Level-scoped selection (Google Docs default): walk the whole listId
    // block, find first + last paragraph-start at the clicked marker's
    // listLevel. Other-level paragraphs in between fall inside the text-
    // range span but the render-level filter in Draw.drawRow skips painting
    // them, so child rows don't appear selected.
    selectionLevel = clickedLevel
    let blockStart = paragraphZeroIndex
    while (blockStart > 0 && elementList[blockStart - 1].listId === listId) {
      blockStart--
    }
    let blockEnd = paragraphZeroIndex
    while (
      blockEnd + 1 < elementList.length &&
      elementList[blockEnd + 1].listId === listId
    ) {
      blockEnd++
    }
    let firstAtLevel = -1
    let lastAtLevel = -1
    for (let i = blockStart; i <= blockEnd; i++) {
      const el = elementList[i]
      if (!el) continue
      const isParaStart = el.value === ZERO && !el.listWrap
      if (!isParaStart) continue
      if ((el.listLevel ?? 1) !== clickedLevel) continue
      if (firstAtLevel < 0) firstAtLevel = i
      let pEnd = i
      while (
        pEnd + 1 < elementList.length &&
        elementList[pEnd + 1].listId === listId &&
        elementList[pEnd + 1].value !== ZERO
      ) {
        pEnd++
      }
      lastAtLevel = pEnd
    }
    if (firstAtLevel >= 0 && lastAtLevel >= 0) {
      startIndex = firstAtLevel
      endIndex = lastAtLevel
    } else {
      // Fallback: no paragraphs at this level (shouldn't happen since the
      // clicked paragraph itself is at clickedLevel). Use single paragraph.
      while (
        endIndex + 1 < elementList.length &&
        elementList[endIndex + 1].listId === listId &&
        elementList[endIndex + 1].value !== ZERO
      ) {
        endIndex++
      }
    }
  }
  const rangeManager = draw.getRange()
  rangeManager.setRange(startIndex, endIndex)
  rangeManager.setMarkerSelection({
    startIndex,
    endIndex,
    listId,
    ...(selectionLevel !== undefined ? { level: selectionLevel } : {})
  })
  host.markerSelectionRow = isSecondClick ? null : paragraphZeroIndex
  draw.render({ isSubmitHistory: false, isCompute: false, isSetCursor: false })
  return true
}

export function setRangeCache(host: CanvasEvent) {
  const draw = host.getDraw()
  const position = draw.getPosition()
  const rangeManager = draw.getRange()
  // 缓存选区上下文信息
  host.isAllowDrag = true
  host.cacheRange = deepClone(rangeManager.getRange())
  host.cacheElementList = draw.getElementList()
  host.cachePositionList = position.getPositionList()
  host.cachePositionContext = position.getPositionContext()
}

export function hitCheckbox(element: IElement, draw: Draw) {
  const { checkbox, control } = element
  // 复选框不在控件内独立控制
  if (!control) {
    draw.getCheckboxParticle().setSelect(element)
  } else {
    const codes = control?.code ? control.code.split(',') : []
    if (checkbox?.value) {
      const codeIndex = codes.findIndex(c => c === checkbox.code)
      codes.splice(codeIndex, 1)
    } else {
      if (checkbox?.code) {
        codes.push(checkbox.code)
      }
    }
    const activeControl = draw.getControl().getActiveControl()
    if (activeControl instanceof CheckboxControl) {
      activeControl.setSelect(codes)
    }
  }
}

export function hitRadio(element: IElement, draw: Draw) {
  const { radio, control } = element
  // 单选框不在控件内独立控制
  if (!control) {
    draw.getRadioParticle().setSelect(element)
  } else {
    const codes = radio?.code ? [radio.code] : []
    const activeControl = draw.getControl().getActiveControl()
    if (activeControl instanceof RadioControl) {
      activeControl.setSelect(codes)
    }
  }
}

export function mousedown(evt: MouseEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  let isReadonly = draw.isReadonly()
  const rangeManager = draw.getRange()
  const position = draw.getPosition()
  // 存在选区时忽略右键点击
  const range = rangeManager.getRange()
  if (
    evt.button === MouseEventButton.RIGHT &&
    (range.isCrossRowCol || !rangeManager.getIsCollapsed())
  ) {
    return
  }
  // Google-Docs-style list-marker click: detect a left-button hit on the
  // bounds of a list paragraph's marker glyph (stamped on each row by
  // ListParticle.drawListStyle). First click selects the whole list block;
  // a subsequent click on the same marker narrows to just that paragraph.
  if (evt.button === MouseEventButton.LEFT) {
    const handled = handleMarkerClick(evt, host)
    if (handled) {
      evt.preventDefault()
      return
    }
    // Clear marker-selection state on non-marker click so a subsequent
    // marker click starts fresh with whole-list selection.
    host.markerSelectionRow = null
  }
  // 是否是选区拖拽
  if (!host.isAllowDrag) {
    if (!isReadonly && range.startIndex !== range.endIndex) {
      const isPointInRange = rangeManager.getIsPointInRange(
        evt.offsetX,
        evt.offsetY
      )
      if (isPointInRange) {
        setRangeCache(host)
        return
      }
    }
  }
  const target = evt.target as HTMLDivElement
  const pageIndex = target.dataset.index
  // 设置pageNo
  if (pageIndex) {
    draw.setPageNo(Number(pageIndex))
  }
  host.isAllowSelection = true
  // 缓存旧上下文信息
  const oldPositionContext = deepClone(position.getPositionContext())
  const positionResult = position.adjustPositionContext({
    x: evt.offsetX,
    y: evt.offsetY
  })
  if (!positionResult) return
  const {
    index,
    isDirectHit,
    isCheckbox,
    isRadio,
    isImage,
    isLabel,
    isTable,
    tdValueIndex,
    hitLineStartIndex
  } = positionResult
  // 记录选区开始位置
  host.mouseDownStartPosition = {
    ...positionResult,
    index: isTable ? tdValueIndex! : index,
    x: evt.offsetX,
    y: evt.offsetY
  }
  const elementList = draw.getElementList()
  const positionList = position.getPositionList()
  const curIndex = isTable ? tdValueIndex! : index
  const curElement = elementList[curIndex]
  // 绘制
  const isDirectHitImage = !!(isDirectHit && isImage)
  const isDirectHitCheckbox = !!(isDirectHit && isCheckbox)
  const isDirectHitRadio = !!(isDirectHit && isRadio)
  const isDirectHitLabel = !!(isDirectHit && isLabel)
  if (~index) {
    let startIndex = curIndex
    let endIndex = curIndex
    // shift激活时进行选区处理
    if (evt.shiftKey) {
      const { startIndex: oldStartIndex } = rangeManager.getRange()
      if (~oldStartIndex) {
        const newPositionContext = position.getPositionContext()
        if (newPositionContext.tdId === oldPositionContext.tdId) {
          if (curIndex > oldStartIndex) {
            startIndex = oldStartIndex
          } else {
            endIndex = oldStartIndex
          }
        }
      }
    }
    rangeManager.setRange(startIndex, endIndex)
    position.setCursorPosition(positionList[curIndex])
    // 更新只读状态
    isReadonly = draw.isReadonly()
    // 复选框
    if (isDirectHitCheckbox && !isReadonly) {
      hitCheckbox(curElement, draw)
    } else if (isDirectHitRadio && !isReadonly) {
      hitRadio(curElement, draw)
    } else if (
      curElement.controlComponent === ControlComponent.VALUE &&
      (curElement.control?.type === ControlType.CHECKBOX ||
        curElement.control?.type === ControlType.RADIO)
    ) {
      // 向左查找
      let preIndex = curIndex
      while (preIndex > 0) {
        const preElement = elementList[preIndex]
        if (preElement.controlComponent === ControlComponent.CHECKBOX) {
          hitCheckbox(preElement, draw)
          break
        } else if (preElement.controlComponent === ControlComponent.RADIO) {
          hitRadio(preElement, draw)
          break
        }
        preIndex--
      }
    } else {
      draw.render({
        curIndex,
        isCompute: false,
        isSubmitHistory: false,
        isSetCursor:
          !isDirectHitImage && !isDirectHitCheckbox && !isDirectHitRadio
      })
    }
    // 首字需定位到行首，非上一行最后一个字后
    if (hitLineStartIndex) {
      host.getDraw().getCursor().drawCursor({
        hitLineStartIndex
      })
    }
  }
  // 标签点击事件
  const eventBus = draw.getEventBus()
  if (isDirectHitLabel && eventBus.isSubscribe('labelMousedown')) {
    eventBus.emit('labelMousedown', {
      evt,
      element: curElement
    })
  }
  // 预览工具组件
  const previewer = draw.getPreviewer()
  previewer.clearResizer()
  if (isDirectHitImage) {
    const previewerDrawOption: IPreviewerDrawOption = {
      // 只读或控件外表单模式禁用拖拽
      dragDisable:
        isReadonly ||
        (!curElement.controlId && draw.getMode() === EditorMode.FORM)
    }
    if (curElement.type === ElementType.LATEX) {
      previewerDrawOption.mime = 'svg'
      previewerDrawOption.srcKey = 'laTexSVG'
    }
    previewer.drawResizer(
      curElement,
      positionList[curIndex],
      previewerDrawOption
    )
    // 光标事件代理丢失，重新定位
    draw.getCursor().drawCursor({
      isShow: false
    })
    // 点击图片允许拖拽调整位置
    setRangeCache(host)
    // 浮动元素创建镜像图片
    if (
      curElement.imgDisplay === ImageDisplay.SURROUND ||
      curElement.imgDisplay === ImageDisplay.FLOAT_TOP ||
      curElement.imgDisplay === ImageDisplay.FLOAT_BOTTOM
    ) {
      draw.getImageParticle().createFloatImage(curElement)
    }
    // 图片点击事件
    if (eventBus.isSubscribe('imageMousedown')) {
      eventBus.emit('imageMousedown', {
        evt,
        element: curElement
      })
    }
  }
  // 表格工具组件
  const tableTool = draw.getTableTool()
  tableTool.dispose()
  if (isTable && !isReadonly && draw.getMode() !== EditorMode.FORM) {
    tableTool.render()
  }
  // 超链接
  const hyperlinkParticle = draw.getHyperlinkParticle()
  hyperlinkParticle.clearHyperlinkPopup()
  if (curElement.type === ElementType.HYPERLINK) {
    if (isMod(evt)) {
      hyperlinkParticle.openHyperlink(curElement)
    } else {
      hyperlinkParticle.drawHyperlinkPopup(curElement, positionList[curIndex])
    }
  }
  // 日期控件
  const dateParticle = draw.getDateParticle()
  dateParticle.clearDatePicker()
  if (curElement.type === ElementType.DATE && !isReadonly) {
    dateParticle.renderDatePicker(curElement, positionList[curIndex])
  }
}
