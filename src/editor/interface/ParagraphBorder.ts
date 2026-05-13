import { IPadding } from './Common'
import { ParagraphBorderStyle } from '../dataset/enum/ParagraphBorder'

/**
 * One side of a paragraph border. Mirrors Word's `w:top` / `w:bottom` /
 * `w:left` / `w:right` / `w:between` / `w:bar` child of `<w:pBdr>`.
 *
 * All fields are optional. A side that is `undefined` (i.e. the whole object
 * missing from the parent `IParagraphBorder`) is not painted at all — Word's
 * `val="nil"` behavior. Providing an empty object `{}` paints the side using
 * the renderer defaults (solid, 1px, #000000).
 */
export interface IParagraphBorderSide {
  // Stroke color. Defaults to '#000000'.
  color?: string
  // Stroke width in editor pixels (unscaled). Defaults to 1. Word stores this
  // as eighths of a point — callers translating from DOCX should pre-convert.
  width?: number
  // Stroke style. Defaults to SOLID. DOUBLE renders as two parallel solid
  // strokes with the gap equal to one `width`, matching Word's default
  // `w:val="double"` rasterization for typical widths.
  style?: ParagraphBorderStyle
}

/**
 * MS Word paragraph border (`<w:pBdr>`). Stamped on the paragraph's ZERO
 * delimiter element so the renderer can resolve it from any row of the
 * paragraph (same pattern as `paragraphShading`).
 *
 * Border geometry wraps the paragraph fragment — i.e. the run of rows of
 * this paragraph that share a page/column. When a paragraph splits across a
 * page break the top edge paints only on the first fragment, the bottom edge
 * only on the last fragment, and left/right edges paint on every fragment.
 *
 * `between` is special: it paints the horizontal separator that appears
 * between two adjacent paragraphs which both carry the same border styling.
 * The implementation collapses adjacent-paragraph borders into a single
 * stroke at the shared boundary instead of doubling them, matching Word's
 * `<w:between>` semantics.
 *
 * `padding` is the "distance from text" — extra space inserted between the
 * paragraph's content box and the border rectangle. Values are in unscaled
 * editor pixels and follow the `IPadding` convention `[top, right, bottom,
 * left]`. When omitted the border hugs the content the same way paragraph
 * shading does.
 */
export interface IParagraphBorder {
  top?: IParagraphBorderSide
  bottom?: IParagraphBorderSide
  left?: IParagraphBorderSide
  right?: IParagraphBorderSide
  between?: IParagraphBorderSide
  padding?: IPadding
}
