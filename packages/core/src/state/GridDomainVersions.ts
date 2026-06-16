/**
 * Formal domain version snapshot. Each counter is incremented exactly once per
 * committed logical mutation of that domain — never during reads or speculative work.
 *
 * Ownership and increment rules:
 *   columns   — incremented by ColumnModel.updateColumns() via GridStateReactionController
 *   rows      — incremented by GridStateReactionController on globalVersion / sortModel / filterModel changes
 *   geometry  — incremented by GeometryModel.updateRows() via GridStateReactionController
 *   selection — reserved for SelectionModel mutations (not yet formally wired)
 *   editing   — reserved for EditModel mutations (not yet formally wired)
 *   styling   — reserved for theme/style mutations (not yet formally wired)
 */
export interface GridDomainVersions {
	/** Incremented when column definitions, widths, or pin configuration change. */
	columns: number;
	/** Incremented when the row model refreshes — new data, sort, filter, or group change. */
	rows: number;
	/** Incremented when row heights or positions recompute (any geometry layout change). */
	geometry: number;
	/** Incremented when the active selection or focus changes. Reserved. */
	selection: number;
	/** Incremented when the active edit session starts or commits. Reserved. */
	editing: number;
	/** Incremented when theme tokens or cell styling rules change. Reserved. */
	styling: number;
}
