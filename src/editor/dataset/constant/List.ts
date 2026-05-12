import { ListStyle, ListType, UlStyle } from '../enum/List'
import { IListOption } from '../../interface/Element'

export const defaultListOption: Readonly<Required<IListOption>> = {
  inheritStyle: false,
  levelIndents: [0, 36, 72, 108, 144, 180, 216, 252, 288]
}

export const ulStyleMapping: Record<UlStyle, string> = {
  [UlStyle.DISC]: '•',
  [UlStyle.CIRCLE]: '◦',
  [UlStyle.SQUARE]: '▫︎',
  [UlStyle.CHECKBOX]: '☑️'
}

export const listTypeElementMapping: Record<ListType, string> = {
  [ListType.OL]: 'ol',
  [ListType.UL]: 'ul'
}

export const listStyleCSSMapping: Record<ListStyle, string> = {
  [ListStyle.DISC]: 'disc',
  [ListStyle.CIRCLE]: 'circle',
  [ListStyle.SQUARE]: 'square',
  [ListStyle.DECIMAL]: 'decimal',
  [ListStyle.LOWER_ALPHA]: 'lower-alpha',
  [ListStyle.UPPER_ALPHA]: 'upper-alpha',
  [ListStyle.LOWER_ROMAN]: 'lower-roman',
  [ListStyle.UPPER_ROMAN]: 'upper-roman',
  [ListStyle.LEGAL]: 'decimal',
  [ListStyle.CHECKBOX]: 'checkbox'
}
