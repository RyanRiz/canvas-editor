/**
 * Ruler module — MS-Word style horizontal + vertical ruler.
 *
 * Architectural note (mirrors the user-supplied spec):
 *  - The ruler is a *projection of formatting state*, not a drawing overlay.
 *    Markers drag in **logical document coordinates** (CSS pixels at scale=1);
 *    on commit they mutate model properties (paragraph.indent, .rightIndent,
 *    .firstLineIndent, .tabStops, table.colgroup[i].width, etc.) and the layout
 *    engine recomputes rendering.
 *  - The ruler UI layer is kept **separate from the document rendering layer**:
 *    rulers live in their own DOM canvases, siblings of `.ce-page-wrapper`, not
 *    drawn into the page base/decoration canvas.
 */

/** Unit shown in ruler labels. Internal storage is always CSS pixels at scale=1
 *  ("logical document pixels"); the unit only affects label rendering. */
export enum RulerUnit {
  IN = 'in',
  CM = 'cm',
  MM = 'mm',
  PX = 'px'
}

/** Tab-stop alignment kinds, matching Word's `<w:tab w:val="…"/>`. */
export enum TabStopType {
  /** Text expands to the right of the stop (default). */
  LEFT = 'left',
  /** Text aligns its right edge to the stop. */
  RIGHT = 'right',
  /** Text is centered on the stop. */
  CENTER = 'center',
  /** Numeric decimal points align on the stop. */
  DECIMAL = 'decimal',
  /** Vertical bar painted at the stop; no alignment effect. */
  BAR = 'bar'
}

export interface ITabStop {
  /** Horizontal position from the left margin, in CSS pixels at scale=1. */
  position: number
  type: TabStopType
}

export interface IRulerOption {
  /** Disable the ruler entirely. Default: true (opt-in). */
  disabled?: boolean
  /** Label unit. Default: 'in'. */
  unit?: RulerUnit
  /** Ruler thickness in *screen* pixels. Does NOT scale with zoom — keeps the
   *  ruler readable at low zoom and small at high zoom (Word behavior). */
  size?: number
  /** Background of the *margin* strip (the gray edge regions). */
  marginColor?: string
  /** Background of the *content* strip (the white inner region). */
  contentColor?: string
  /** Tick mark color. */
  tickColor?: string
  /** Label text color. */
  labelColor?: string
  /** Label font family. */
  labelFont?: string
  /** Label font size (in screen px, not scaled). */
  labelSize?: number
  /** Color used to fill indent markers / column boundary handles. */
  markerColor?: string
  /** Stroke color used for marker outlines. */
  markerBorderColor?: string
  /** Default tab-stop spacing, in CSS pixels at scale=1. 48 ≈ 0.5 inch. */
  defaultTabStopInterval?: number
}
