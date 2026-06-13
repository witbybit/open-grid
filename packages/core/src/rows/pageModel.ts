/**
 * Client pagination page-window model (Plan 041).
 *
 * Pure math: given a total visual-row count, a page size, and a requested page, compute
 * the slice bounds. The row pipeline applies this AFTER the final flatten (so the total
 * is the post-group/post-filter, user-visible count) and BEFORE building the index maps,
 * so every downstream structure (maps, geometry, sticky/group meta) is page-consistent.
 *
 * Cross-page semantics (v1, see Plan 041 §C):
 *  - Pagination slices the flattened visual rows. Groups/tree/detail that span a page
 *    boundary simply continue on the next page (no whole-group-per-page packing).
 *  - Selection is by rowId and persists across pages; rows on other pages aren't rendered.
 */

export interface PageWindow {
	/** Clamped current page (0-based). */
	page: number;
	pageSize: number;
	/** First visual-row index included (inclusive). */
	startIndex: number;
	/** One past the last visual-row index included (exclusive) — i.e. slice(start, end). */
	endIndex: number;
	/** Number of pages; always >= 1 (an empty grid is "page 1 of 1"). */
	pageCount: number;
	/** Total visual rows before slicing — the denominator the bar displays. */
	totalRows: number;
}

/**
 * Compute the slice bounds for `page` over `totalRows` items at `pageSize` per page.
 * `pageSize` floors at 1; `page` is clamped into `[0, pageCount - 1]`.
 */
export function computePageWindow(totalRows: number, pageSize: number, page: number): PageWindow {
	const size = Math.max(1, Math.floor(pageSize));
	const total = Math.max(0, Math.floor(totalRows));
	const pageCount = Math.max(1, Math.ceil(total / size));
	const clampedPage = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
	const startIndex = clampedPage * size;
	const endIndex = Math.min(total, startIndex + size);
	return { page: clampedPage, pageSize: size, startIndex, endIndex, pageCount, totalRows: total };
}
