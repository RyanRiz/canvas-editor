import { ZERO } from '../dataset/constant/Common'
import { ListStyle, ListType } from '../dataset/enum/List'
import { IElement } from '../interface/Element'
import { ListNumberStyle } from '../interface/List'
import { getUUID } from '.'

/**
 * Word + Google Docs style auto-format triggers. Typing one of the patterns
 * below at the start of an empty paragraph followed by a SPACE converts the
 * paragraph into a list of the appropriate type. The trigger characters and
 * the space are consumed (removed); the cursor lands at the start of the
 * fresh list item, ready for the user to type content.
 *
 * The trigger fires only when:
 *   • The cursor is in a non-list paragraph
 *   • The entire paragraph content (between the paragraph's ZERO delimiter
 *     and the cursor) equals one of the registered trigger strings
 *   • The user typed a single space character
 *
 * One history snapshot is submitted for the whole conversion, so Ctrl+Z
 * reverses both the trigger removal and the list creation in one press.
 */
interface AutoFormatEntry {
  listType: ListType
  listStyle: ListStyle
  listFormat?: string
  listNumberStyle?: ListNumberStyle
  listBulletChar?: string
  checklistStyle?: 'standard' | 'plain'
}

const TRIGGER_TABLE: Record<string, AutoFormatEntry> = {
  // Bullet triggers — all map to default disc bullet.
  '*': {
    listType: ListType.UL,
    listStyle: ListStyle.DISC,
    listFormat: '%1',
    listBulletChar: '●'
  },
  '-': {
    listType: ListType.UL,
    listStyle: ListStyle.DISC,
    listFormat: '%1',
    listBulletChar: '●'
  },
  '+': {
    listType: ListType.UL,
    listStyle: ListStyle.DISC,
    listFormat: '%1',
    listBulletChar: '●'
  },
  // Numbered triggers — period suffix (Word's "%N." default).
  '1.': {
    listType: ListType.OL,
    listStyle: ListStyle.DECIMAL,
    listFormat: '%N.',
    listNumberStyle: 'decimal'
  },
  'a.': {
    listType: ListType.OL,
    listStyle: ListStyle.LOWER_ALPHA,
    listFormat: '%N.',
    listNumberStyle: 'lowerAlpha'
  },
  'A.': {
    listType: ListType.OL,
    listStyle: ListStyle.UPPER_ALPHA,
    listFormat: '%N.',
    listNumberStyle: 'upperAlpha'
  },
  'i.': {
    listType: ListType.OL,
    listStyle: ListStyle.LOWER_ROMAN,
    listFormat: '%N.',
    listNumberStyle: 'lowerRoman'
  },
  'I.': {
    listType: ListType.OL,
    listStyle: ListStyle.UPPER_ROMAN,
    listFormat: '%N.',
    listNumberStyle: 'upperRoman'
  },
  // Numbered triggers — paren suffix.
  '1)': {
    listType: ListType.OL,
    listStyle: ListStyle.DECIMAL,
    listFormat: '%N)',
    listNumberStyle: 'decimal'
  },
  'a)': {
    listType: ListType.OL,
    listStyle: ListStyle.LOWER_ALPHA,
    listFormat: '%N)',
    listNumberStyle: 'lowerAlpha'
  },
  'A)': {
    listType: ListType.OL,
    listStyle: ListStyle.UPPER_ALPHA,
    listFormat: '%N)',
    listNumberStyle: 'upperAlpha'
  },
  'i)': {
    listType: ListType.OL,
    listStyle: ListStyle.LOWER_ROMAN,
    listFormat: '%N)',
    listNumberStyle: 'lowerRoman'
  },
  'I)': {
    listType: ListType.OL,
    listStyle: ListStyle.UPPER_ROMAN,
    listFormat: '%N)',
    listNumberStyle: 'upperRoman'
  },
  // Checkbox trigger — square brackets become an unchecked checklist item.
  '[]': {
    listType: ListType.UL,
    listStyle: ListStyle.CHECKBOX,
    checklistStyle: 'standard',
    listFormat: '%1'
  }
}

/**
 * Walk backward from `cursorIdx` to find the paragraph's ZERO delimiter
 * (the start-of-paragraph marker). Returns -1 if no ZERO precedes the cursor.
 */
function findParagraphZeroIndex(
  elementList: IElement[],
  cursorIdx: number
): number {
  for (let i = cursorIdx; i >= 0; i--) {
    const el = elementList[i]
    if (el && el.value === ZERO && !el.listWrap) return i
  }
  return -1
}

/**
 * Returns the trigger entry + paragraph ZERO index when the typed character +
 * current paragraph state matches a registered trigger, otherwise null.
 */
export function matchAutoFormatTrigger(
  elementList: IElement[],
  endIndex: number,
  data: string
): { entry: AutoFormatEntry; zeroIndex: number } | null {
  if (data !== ' ') return null
  const zeroIdx = findParagraphZeroIndex(elementList, endIndex)
  if (zeroIdx < 0) return null
  const zero = elementList[zeroIdx]
  if (zero.listId) return null
  let text = ''
  for (let i = zeroIdx + 1; i <= endIndex; i++) {
    const v = elementList[i]?.value
    if (v === undefined || v === ZERO) return null
    text += v
  }
  const entry = TRIGGER_TABLE[text]
  return entry ? { entry, zeroIndex: zeroIdx } : null
}

/**
 * Apply the auto-format conversion in-place on the element list: remove the
 * trigger characters and stamp the matched list fields on the paragraph's
 * ZERO. Returns the new cursor index (always the ZERO position).
 */
export function applyAutoFormat(
  elementList: IElement[],
  zeroIndex: number,
  endIndex: number,
  entry: AutoFormatEntry
): number {
  if (endIndex > zeroIndex) {
    elementList.splice(zeroIndex + 1, endIndex - zeroIndex)
  }
  const zero = elementList[zeroIndex]
  if (!zero) return zeroIndex
  zero.listId = getUUID()
  zero.listType = entry.listType
  zero.listStyle = entry.listStyle
  zero.listLevel = 1
  if (entry.listFormat) zero.listFormat = entry.listFormat
  else delete zero.listFormat
  if (entry.listNumberStyle) zero.listNumberStyle = entry.listNumberStyle
  else delete zero.listNumberStyle
  if (entry.listBulletChar) zero.listBulletChar = entry.listBulletChar
  else delete zero.listBulletChar
  if (entry.checklistStyle) zero.checklistStyle = entry.checklistStyle
  else delete zero.checklistStyle
  return zeroIndex
}
