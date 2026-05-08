/**
 * Layered-canvas option (PERF-PLAN — Strategy B).
 *
 * Each page is rendered as two stacked `<canvas>` elements wrapped in a
 * `<div class="ce-page-wrapper">`:
 *   - **base** canvas — page background, watermark, margins, area, controls,
 *     line numbers, page borders / numbers, header / footer, text / images /
 *     tables, underline / strikeout, group annotations. Painted on every
 *     "real" render (text or layout changed).
 *   - **decoration** canvas — selection rects, search-match highlights,
 *     table cross-row range. Painted on every render that touches selection /
 *     search / range — including the fast `isDecorationOnly` path that skips
 *     the base layer entirely. `pointer-events: none`.
 *
 * Rationale: selection drag, search-next, range style changes etc. previously
 * triggered a full base repaint (the dominant cost). Splitting decoration off
 * lets those high-frequency interactions skip the elementList walk entirely.
 *
 * The flag is opt-out (default-on). When `enable: false`, `_createPage`
 * builds the legacy single-canvas structure and the decoration ctx aliases
 * the base ctx — the old code paths run unchanged.
 */
export interface IPageLayeredOption {
  /** Master switch. Default: true. */
  enable?: boolean
}
