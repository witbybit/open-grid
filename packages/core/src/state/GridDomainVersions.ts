/**
 * Formal domain version snapshot. Each counter is incremented exactly once per
 * committed logical mutation of that domain — never during reads or speculative work.
 *
 * Wired increment points:
 *   columns   — declared on commit records and published by GridCommitKernel
 *   rows      — declared on row-model and data mutations, then published by GridCommitKernel
 *   geometry  — declared on geometry-affecting commits and published after projection
 *   selection — declared on selection commits
 *   editing   — declared on editing lifecycle commits
 *   filtering — declared on filter/query commits
 *   sorting   — declared on sort commits
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
