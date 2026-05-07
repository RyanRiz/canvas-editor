import { PaperDirection } from '../dataset/enum/Editor'
import { SectionBreakType } from '../dataset/enum/SectionBreak'

export interface ISectionBreak {
  font?: string
  fontSize?: number
  lineDash?: number[]
}

export interface ISectionPage {
  paperDirection?: PaperDirection
  width?: number
  height?: number
}

export interface ISectionBreakElement {
  sectionBreakType?: SectionBreakType
  sectionPage?: ISectionPage
}
