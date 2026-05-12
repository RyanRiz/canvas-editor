import { IListLevelStyle, ListNumberStyle } from '../../interface/List'
import { ListStyle, ListType, UlStyle } from '../enum/List'

export const LIST_INDENT_STEP = 36

export const LIST_NUMBER_ALIGNMENT_STEP = 18

export const DEFAULT_LIST_LEVEL_CASCADE_DECIMAL: ListNumberStyle[] = [
  'decimal',
  'lowerAlpha',
  'lowerRoman',
  'decimal',
  'lowerAlpha',
  'lowerRoman',
  'decimal',
  'lowerAlpha',
  'lowerRoman'
]

export const DEFAULT_UL_LEVEL_CASCADE: UlStyle[] = [
  UlStyle.DISC,
  UlStyle.CIRCLE,
  UlStyle.SQUARE,
  UlStyle.DISC,
  UlStyle.CIRCLE,
  UlStyle.SQUARE,
  UlStyle.DISC,
  UlStyle.CIRCLE,
  UlStyle.SQUARE
]

export function buildDefaultLevelStyle(
  level: number,
  listType: ListType | undefined,
  listStyle: ListStyle | undefined
): IListLevelStyle {
  const idx = Math.max(0, Math.min(level - 1, 8))
  const isCheckbox = listStyle === ListStyle.CHECKBOX
  const isUl = listType === ListType.UL
  let numberStyle: ListNumberStyle
  let bulletChar: string | undefined
  if (isCheckbox) {
    numberStyle = 'bullet'
  } else if (isUl) {
    numberStyle = 'bullet'
    bulletChar = undefined
  } else if (level === 1) {
    // OL L1 honors explicit listStyle; deeper levels cascade default.
    switch (listStyle) {
      case ListStyle.LOWER_ALPHA:
        numberStyle = 'lowerAlpha'
        break
      case ListStyle.UPPER_ALPHA:
        numberStyle = 'upperAlpha'
        break
      case ListStyle.LOWER_ROMAN:
        numberStyle = 'lowerRoman'
        break
      case ListStyle.UPPER_ROMAN:
        numberStyle = 'upperRoman'
        break
      default:
        numberStyle = 'decimal'
    }
  } else {
    numberStyle = DEFAULT_LIST_LEVEL_CASCADE_DECIMAL[idx]
  }
  return {
    level,
    format: numberStyle === 'bullet' ? '%N' : '%N.',
    numberStyle,
    bulletChar,
    numberAlignment: idx * LIST_NUMBER_ALIGNMENT_STEP,
    textIndent: idx * LIST_INDENT_STEP,
    followNumberWith: 'tab'
  }
}
