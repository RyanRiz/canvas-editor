import { TitleLevel } from '../dataset/enum/Title'

export interface IRichtextOption {
  isIgnoreDisabledRule: boolean
}

export interface IWordStylePayload {
  wordStyle?: string
  heading: TitleLevel | null
  font: string
  size: number
  bold: boolean
  italic: boolean
  color: string | null
  spaceBefore: number
  spaceAfter: number
  lineSpacing?: number | null
  leftIndent?: number | null
}
