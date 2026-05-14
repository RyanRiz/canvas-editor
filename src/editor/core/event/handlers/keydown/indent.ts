import { CanvasEvent } from '../../CanvasEvent'

/** MS Word-style indent keyboard shortcuts.
 *
 *  Ctrl+M      — increase left indent (both markers move right)
 *  Ctrl+Shift+M — decrease left indent (both markers move left, min 0)
 *  Ctrl+T       — hanging indent (body moves right, first-line stays)
 *  Ctrl+Shift+T — remove hanging indent (body moves left toward first-line)
 *
 *  Ctrl+M/T are dispatched from the keydown index. The handler inspects
 *  `evt.shiftKey` and the pressed key ('m' vs 't') to decide the operation.
 */
export function indent(evt: KeyboardEvent, host: CanvasEvent) {
  const draw = host.getDraw()
  const isReadonly = draw.isReadonly()
  if (isReadonly) return
  evt.preventDefault()

  const range = draw.getRange()
  const info = range.getRangeParagraphInfo()
  if (!info || !info.elementList.length) return

  const paragraphElements = info.elementList
  const paragraphStart = info.startIndex
  const paragraphEnd = paragraphStart + paragraphElements.length - 1

  const first = paragraphElements[0]
  const curIndent = first.indent || 0
  const curFirst = first.firstLineIndent || 0

  const isT = evt.key === 't' || evt.key === 'T'
  const isShift = evt.shiftKey

  let newIndent = curIndent
  let newFirst = curFirst

  if (isT) {
    // Ctrl+T: hanging indent (increase indent by 1, compensate firstLineIndent)
    // Ctrl+Shift+T: remove hanging indent (decrease indent by 1, add back to firstLineIndent)
    if (isShift) {
      if (curIndent <= 0) return
      newIndent = curIndent - 1
      newFirst = curFirst + 1
    } else {
      newIndent = curIndent + 1
      newFirst = curFirst - 1
    }
  } else {
    // Ctrl+M: increase indent by 1
    // Ctrl+Shift+M: decrease indent by 1 (clamped to >= 0)
    if (isShift) {
      if (curIndent <= 0) return
      newIndent = curIndent - 1
    } else {
      newIndent = curIndent + 1
    }
    // firstLineIndent is preserved (moves with indent)
  }

  // Clamp firstLineIndent lower bound: firstLineIndent >= -indent
  if (newFirst < -newIndent) newFirst = -newIndent

  // No-op guard
  if (newIndent === curIndent && newFirst === curFirst) return

  const before = paragraphElements.map(el => ({
    el,
    indent: el.indent,
    firstLineIndent: el.firstLineIndent
  }))

  const applyMutation = () => {
    for (const el of paragraphElements) {
      if (newIndent === 0) delete el.indent
      else el.indent = newIndent
      if (newFirst === 0) delete el.firstLineIndent
      else el.firstLineIndent = newFirst
    }
  }

  const revertMutation = () => {
    for (const item of before) {
      if (item.indent !== undefined) item.el.indent = item.indent
      else delete item.el.indent
      if (item.firstLineIndent !== undefined) item.el.firstLineIndent = item.firstLineIndent
      else delete item.el.firstLineIndent
    }
  }

  applyMutation()
  const isSetCursor = range.getRange().startIndex === range.getRange().endIndex
  const curIndex = isSetCursor ? range.getRange().endIndex : range.getRange().startIndex
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
