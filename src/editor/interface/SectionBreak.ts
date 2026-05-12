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
