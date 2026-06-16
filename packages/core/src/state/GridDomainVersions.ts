/**
 * Formal domain version snapshot. Each counter is incremented exactly once per
 * committed logical mutation of that domain — never during reads or speculative work.
 *
 * Wired increment points:
 *   columns   — ColumnModel.updateColumns() via GridStateReactionController
 *   rows      — GridStateReactionController on globalVersion / sortModel / filterModel changes
 *   geometry  — GeometryModel.updateRows() via GridStateReactionController
 *
 * Counters for selection, editing, and styling are present in the snapshot but not yet
 * incremented by their respective domains. They will remain 0 until formally wired.
 * Subscribers should treat 0 as "no mutations observed", not "domain is inactive".
 */
export interface GridDomainVersions {
	/** Incremented when column definitions, widths, or pin configuration change. */
	columns: number;
	/** Incremented when the row model refreshes — new data, sort, filter, or group change. */
	rows: number;
	/** Incremented when row heights or positions recompute (any geometry layout change). */
	geometry: number;
	/** Counter for selection/focus mutations. Always 0 until SelectionModel wires its increment. */
	selection: number;
	/** Counter for edit-session lifecycle events. Always 0 until EditModel wires its increment. */
	editing: number;
	/** Counter for theme/style rule mutations. Always 0 until styling domain wires its increment. */
	styling: number;
}
