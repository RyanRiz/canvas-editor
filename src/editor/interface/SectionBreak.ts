import { PaperDirection } from '../dataset/enum/Editor'
import { IMargin } from './Margin'

/**
 * Rendering options for section break placeholders shown in the editor view.
 * Mirrors `IPageBreak` so the visual treatment stays consistent — the
 * sectionBreakType discriminator is carried on each IElement, not the option.
 */
export interface ISectionBreak {
  font?: string
  fontSize?: number
  lineDash?: number[]
}

/**
 * MS Word `<w:sectPr>` analogue. A section's page geometry — direction, paper
 * size, margins — lives here. The properties at an element index are resolved
 * by walking backward from that index through the element list (run-length
 * encoded, same idiom as the existing `element.pageColumns`). When no element
 * in scope sets a field, the editor option default applies, so docs without
 * section breaks behave exactly as before.
 *
 * Columns are kept on the existing `element.pageColumns` field for backwards
 * compat with the column-layout command; section properties intentionally do
 * not duplicate them.
 */
export interface ISectionProperties {
  /** Overrides options.paperDirection for this and following content. */
  paperDirection?: PaperDirection
  /** Overrides {options.width, options.height} (intrinsic paper, pre-rotation). */
  paperSize?: {
    width: number
    height: number
  }
  /** Overrides options.margins (top / right / bottom / left, pre-scale). */
  margins?: IMargin
}
