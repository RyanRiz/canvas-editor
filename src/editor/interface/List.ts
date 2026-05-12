export type ListNumberStyle =
  | 'decimal'
  | 'lowerAlpha'
  | 'upperAlpha'
  | 'lowerRoman'
  | 'upperRoman'
  | 'bullet'

export type ListFamily = 'decimal' | 'legal' | 'bulleted' | 'roman' | 'custom'

export type FollowNumberWith = 'tab' | 'space' | 'nothing'

export interface IListLevelStyle {
  level: number
  format: string
  numberStyle: ListNumberStyle
  bulletChar?: string
  numberAlignment: number
  textIndent: number
  followNumberWith: FollowNumberWith
}

export interface IListStyle {
  id: string
  family: ListFamily
  continuePrevious: boolean
  levels: IListLevelStyle[]
}

export interface IListGlyphResult {
  glyph: string
  level: number
}

export const LIST_MAX_LEVEL = 9
