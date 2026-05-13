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
  // 在控件上下文时，tab键控制控件之间移动
  const control = draw.getControl()
  const activeControl = control.getActiveControl()
  if (activeControl && control.getIsRangeWithinControl()) {
    control.initNextControl({
      direction: evt.shiftKey ? MoveDirection.UP : MoveDirection.DOWN
    })
    return
  }
  const rangeManager = draw.getRange()
  const { startIndex, endIndex } = rangeManager.getRange()
  if (!~startIndex && !~endIndex) return

  // MS Word-style Tab behavior, two-path decision:
  //
  //   1. **Active paragraph has tabStops set** → insert an `ElementType.TAB`
  //      character. Draw.ts §"ElementType.TAB" sizes it to advance to the
  //      next tab stop on the next layout pass.
  //
  //   2. **No tab stops** → bump the paragraph's `firstLineIndent` (Tab) or
  //      decrement it (Shift+Tab). This is Word's default Tab behavior
  //      ("Tab = increase first-line indent"), produces the indented-first-
  //      line look from the user's reference image without inserting a
  //      character into the document.
  //
  // Both paths operate on the FULL paragraph, not just the current visual
  // row. `getRangeParagraphInfo` walks up/down stopping at ZERO delimiters
  // (`getRangeParagraph` in RangeManager.ts) so the returned `elementList`
  // includes every element of the paragraph — exactly what we need to
  // stamp paragraph-level properties consistently.
  const elementList = draw.getElementList()
  const isCollapsed = startIndex === endIndex
  const isShift = evt.shiftKey
  // `endIndex` is the caret's right boundary: `elementList[endIndex]` is the
  // element BEFORE the caret. The active paragraph's tabStops are stamped
  // on every element of the paragraph (see Ruler._addTabStop and the
  // EDITOR_ROW_ATTR-propagation done by formatElementContext on insert), so
  // reading the cursor element converges on the paragraph value.
  const caretEl = elementList[endIndex]
  const prevEl = endIndex > 0 ? elementList[endIndex - 1] : null
  const paragraphTabStops = caretEl?.tabStops || prevEl?.tabStops
  const hasExplicitTabStops = !!paragraphTabStops?.length

  // ── Path 1: insert TAB character ──────────────────────────────────────
  if (isCollapsed && !isShift && hasExplicitTabStops) {
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
    return
  }

  // ── Path 2: bump first-line indent of the paragraph ────────────────────
  const info = rangeManager.getRangeParagraphInfo()
  if (!info || !info.elementList.length) return
  const paragraphElements = info.elementList
  const paragraphStart = info.startIndex
  const paragraphEnd = paragraphStart + paragraphElements.length - 1

  // Shift+Tab on a paragraph that already has firstLineIndent = 0 is a
  // no-op (matches Word: "outdent below 0 does nothing").
  if (
    isShift &&
    paragraphElements.every(el => (el.firstLineIndent || 0) === 0)
  ) {
    return
  }

  // Capture before-snapshot for delta history. Stored as the prior
  // `firstLineIndent` value (or undefined if the property wasn't set), so
  // applyBackward can either restore the exact value or delete the
  // property — matching the zip-output and round-trip tidiness of the
  // existing indent commands (CommandAdapt._mutateRightIndent pattern).
  const before = paragraphElements.map(el => ({
    el,
    firstLineIndent: el.firstLineIndent
  }))

  const applyMutation = () => {
    for (const el of paragraphElements) {
      const cur = el.firstLineIndent || 0
      if (isShift) {
        if (cur > 0) el.firstLineIndent = cur - 1
        else delete el.firstLineIndent
      } else {
        el.firstLineIndent = cur + 1
      }
    }
  }
  const revertMutation = () => {
    for (const item of before) {
      if (item.firstLineIndent !== undefined) {
        item.el.firstLineIndent = item.firstLineIndent
      } else {
        delete item.el.firstLineIndent
      }
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
}
