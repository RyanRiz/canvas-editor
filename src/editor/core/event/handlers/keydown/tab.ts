import { ZERO } from '../../../../dataset/constant/Common'
import { MoveDirection } from '../../../../dataset/enum/Observer'
import { EDITOR_ROW_ATTR } from '../../../../dataset/constant/Element'
import { ElementType } from '../../../../dataset/enum/Element'
import { IElement } from '../../../../interface/Element'
import { CanvasEvent } from '../../CanvasEvent'

export function tab(evt: KeyboardEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  const isReadonly = draw.isReadonly()
  if (isReadonly) return
  evt.preventDefault()

  // 在控件上下文时，tab 键控制控件之间移动
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

  // ── List-aware Tab/Shift+Tab (indent/outdent list items) ────────────────
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
  }

  if (!~startIndex && !~endIndex) return

  // MS Word-style Tab behavior:
  //
  //   Tab       — insert an ElementType.TAB character. Layout engine
  //               (Draw.ts) advances to the next tab stop or the next
  //               default-tab-grid position when no explicit tab stops
  //               exist — matching Word's "Tab always inserts a tab".
  //
  //   Shift+Tab — decrease paragraph left indent by one tab-width step
  //               (Word: "outdent"). No-op when indent is already 0.
  //
  const isShift = evt.shiftKey
  const caretEl = elementList[endIndex]
  const prevEl = endIndex > 0 ? elementList[endIndex - 1] : null

  // ── Shift+Tab: decrease indent ──────────────────────────────────────────
  if (isShift) {
    const info = rangeManager.getRangeParagraphInfo()
    if (!info || !info.elementList.length) return
    const paragraphElements = info.elementList
    const paragraphStart = info.startIndex
    const paragraphEnd = paragraphStart + paragraphElements.length - 1

    const first = paragraphElements[0]
    const curIndent = first.indent || 0
    if (curIndent <= 0) return

    const newIndent = curIndent - 1
    // Preserve firstLineIndent delta relative to indent:
    // firstLine stays the same, so when indent moves left by 1,
    // the absolute first-line position also moves left by 1.
    const curFirst = first.firstLineIndent || 0

    const before = paragraphElements.map(el => ({
      el,
      indent: el.indent,
      firstLineIndent: el.firstLineIndent
    }))

    const applyMutation = () => {
      for (const el of paragraphElements) {
        if (newIndent === 0) delete el.indent
        else el.indent = newIndent
        if (curFirst === 0) delete el.firstLineIndent
        else el.firstLineIndent = curFirst
      }
    }
    const revertMutation = () => {
      for (const item of before) {
        if (item.indent !== undefined) item.el.indent = item.indent
        else delete item.el.indent
        if (item.firstLineIndent !== undefined)
          item.el.firstLineIndent = item.firstLineIndent
        else delete item.el.firstLineIndent
      }
    }

    applyMutation()
    const isSetCursor = startIndex === endIndex
    const curIndex = isSetCursor ? endIndex : startIndex
    draw.getHistoryManager().executeDelta({
      applyForward: () => {
        applyMutation()
        draw.markDirty(paragraphStart, paragraphEnd)
        draw.cancelScheduledRender()
        draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      },
      applyBackward: () => {
        revertMutation()
        draw.markDirty(paragraphStart, paragraphEnd)
        draw.cancelScheduledRender()
        draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
      }
    })
    draw.markDirty(paragraphStart, paragraphEnd)
    draw.cancelScheduledRender()
    draw.render({ curIndex, isSetCursor, isSubmitHistory: false })
    return
  }

  // ── Tab: insert TAB character (Word always-inserts-tab behavior) ────────
  if (isCollapsed) {
    const tabEl: IElement = { type: ElementType.TAB, value: '' }
    // Propagate paragraph-level attributes (EDITOR_ROW_ATTR — indent,
    // firstLineIndent, rightIndent, tabStops, …) from the surrounding
    // element onto the new TAB. insertElementList runs formatElementList
    // but NOT formatElementContext, so it doesn't auto-propagate.
    const source = caretEl || prevEl
    if (source) {
      for (const attr of EDITOR_ROW_ATTR) {
        const v = source[attr]
        if (v !== undefined) {
          ;(tabEl as unknown as Record<string, unknown>)[attr] = v
        }
      }
    }
    draw.insertElementList([tabEl])
  }
}
