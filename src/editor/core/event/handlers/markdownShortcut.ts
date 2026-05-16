import { ZERO } from '../../../dataset/constant/Common'
import { titleSizeMapping } from '../../../dataset/constant/Title'
import { ElementType } from '../../../dataset/enum/Element'
import { TitleLevel } from '../../../dataset/enum/Title'
import { getUUID } from '../../../utils'
import { isTextLikeElement } from '../../../utils/element'
import { CanvasEvent } from '../CanvasEvent'

const HEADING_LEVELS: TitleLevel[] = [
  TitleLevel.FIRST,
  TitleLevel.SECOND,
  TitleLevel.THIRD,
  TitleLevel.FOURTH,
  TitleLevel.FIFTH,
  TitleLevel.SIXTH
]

/**
 * Detect `#` … `######` + space at the start of a paragraph and convert to a
 * heading. Called from `input()` after the space has already been inserted.
 *
 * Returns the new cursor index if the shortcut fired, otherwise null. The
 * caller (input handler) substitutes this for its own curIndex so the final
 * scheduleRender lands on the post-transformation position with the single
 * merged history snapshot.
 */
export function tryApplyMarkdownHeading(
  host: CanvasEvent,
  data: string
): number | null {
  if (data !== ' ') return null
  if (host.isComposing) return null
  const draw = host.getDraw()
  if (!draw.getOptions().markdownShortcut) return null
  const rangeManager = draw.getRange()
  const { startIndex, endIndex } = rangeManager.getRange()
  if (startIndex !== endIndex) return null
  const elementList = draw.getElementList()
  // After input(), curIndex sits ON the just-inserted space (right after it).
  const spaceIndex = startIndex
  const spaceEl = elementList[spaceIndex]
  if (!spaceEl || spaceEl.value !== ' ' || spaceEl.type) return null

  // Walk backwards collecting plain `#` elements. A run stops at any element
  // that isn't a bare `#`, anything with a structural type/control/titleId,
  // or a paragraph delimiter (ZERO). The walk distinguishes "paragraph starts
  // with #s" from "user typed # mid-line" — only the former triggers.
  let firstHashIndex = spaceIndex
  for (let i = spaceIndex - 1; i >= 0; i--) {
    const el = elementList[i]
    if (!el) break
    // ZERO marks a paragraph boundary — stop the walk but keep counting #s
    // we've already collected.
    if (el.value === ZERO) break
    if (
      el.value !== '#' ||
      (el.type && el.type !== ElementType.TEXT) ||
      el.titleId ||
      el.controlId ||
      el.listId
    ) {
      return null
    }
    firstHashIndex = i
  }
  const hashCount = spaceIndex - firstHashIndex
  if (hashCount < 1 || hashCount > 6) return null
  const level = HEADING_LEVELS[hashCount - 1]

  // Remove the #s and the trailing space in one splice. spliceElementList
  // keeps cache invariants (e.g. _mainSurroundCount) consistent.
  draw.spliceElementList(elementList, firstHashIndex, hashCount + 1)

  // Bounded paragraph after the splice: walk to the previous ZERO (or list
  // start) and the next ZERO (or list end). title properties get applied to
  // every element in this range — ZERO included, so an empty paragraph still
  // carries the heading context for subsequent typing via formatElementContext
  // (TITLE_CONTEXT_ATTR is part of EDITOR_ELEMENT_CONTEXT_ATTR).
  let paragraphStart = 0
  for (let i = firstHashIndex - 1; i >= 0; i--) {
    if (elementList[i]?.value === ZERO) {
      paragraphStart = i
      break
    }
  }
  let paragraphEnd = elementList.length - 1
  for (let i = firstHashIndex; i < elementList.length; i++) {
    if (elementList[i]?.value === ZERO) {
      paragraphEnd = i - 1
      break
    }
  }

  const titleId = getUUID()
  const titleOptions = draw.getOptions().title
  const titleSize = titleOptions[titleSizeMapping[level]]
  for (let i = paragraphStart; i <= paragraphEnd; i++) {
    const el = elementList[i]
    if (!el) continue
    el.level = level
    el.titleId = titleId
    if (isTextLikeElement(el)) {
      el.size = titleSize
      el.bold = true
    }
  }

  const newCursor = Math.max(0, firstHashIndex - 1)
  rangeManager.setRange(newCursor, newCursor)
  draw.markDirty(paragraphStart, Math.max(paragraphStart, paragraphEnd))
  return newCursor
}
