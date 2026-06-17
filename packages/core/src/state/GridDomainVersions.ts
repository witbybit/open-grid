/**
 * Formal domain version snapshot. Each counter is incremented exactly once per
 * committed logical mutation of that domain — never during reads or speculative work.
 *
 * Wired increment points:
 *   columns   — ColumnModel.updateColumns() via GridStateReactionController
 *   rows      — GridStateReactionController on globalVersion / sortModel / filterModel changes
 *   geometry  — GeometryModel.updateRows() via GridStateReactionController
 *   selection — GridStateReactionController on selection state key change
 *   editing   — GridStateReactionController on activeEdit state key change
 *   filtering — GridStateReactionController on filterModel state key change
 *   sorting   — GridStateReactionController on sortModel state key change
 *
 * The styling counter is present but not yet incremented. It will remain 0 until
 * the styling domain wires its increment.
 * Subscribers should treat 0 as "no mutations observed", not "domain is inactive".
 */
export interface GridDomainVersions {
	/** Incremented when column definitions, widths, or pin configuration change. */
	columns: number;
	/** Incremented when the row model refreshes — new data, sort, filter, or group change. */
	rows: number;
	/** Incremented when row heights or positions recompute (any geometry layout change). */
	geometry: number;
	/** Incremented when the selection or focus cell changes. */
	selection: number;
	/** Incremented when an edit session starts or ends. */
	editing: number;
	/** Incremented when the active filter model changes. */
	filtering: number;
	/** Incremented when the active sort model changes. */
	sorting: number;
	/** Counter for theme/style rule mutations. Always 0 until styling domain wires its increment. */
	styling: number;
}
