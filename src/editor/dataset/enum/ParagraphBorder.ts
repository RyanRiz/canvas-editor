// MS Word `w:val` border styles. Only the visually common subset is wired up
// for v1 — art borders, wave, and 3D variants need their own rasterizer and
// are out of scope. SOLID is the default for any side that omits `style`.
export enum ParagraphBorderStyle {
  SOLID = 'solid',
  DASHED = 'dashed',
  DOTTED = 'dotted',
  DOUBLE = 'double'
}
