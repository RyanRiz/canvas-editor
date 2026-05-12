/**
 * MS Word style section break flavours.
 *
 * Section breaks divide the document into independently formatted regions.
 * Unlike a plain page break (which only forces pagination) a section break
 * also opens a new layout context (margins / columns / orientation /
 * headers-footers / numbering). We model that container as a sibling of
 * PAGE_BREAK / COLUMN_BREAK and let the pagination pass enforce the
 * page-parity rule encoded in `SectionBreakType`.
 */
export enum SectionBreakType {
  /** Finish current page, start a new page, start a new section. */
  NEXT_PAGE = 'nextPage',
  /** Same page, new section formatting context (allows mid-page layout switch). */
  CONTINUOUS = 'continuous',
  /** Advance to the next even-numbered page (insert blank if needed). */
  EVEN_PAGE = 'evenPage',
  /** Advance to the next odd-numbered page (insert blank if needed). */
  ODD_PAGE = 'oddPage'
}
