/**
 * Cell value roles (ARCHITECTURE.md §3 R8). For this reset the engine resolves `raw` and `display`;
 * parsed/computed/formatted/formula values, the dependency graph, and validation join the same
 * structure as the cell domain grows. Kept deliberately small now so later roles slot in without
 * reshaping callers.
 */
export interface CellValueParts {
	/** The stored value as it lives on the row data. */
	readonly raw: unknown;
	/** The value shown to the user (formatting/value-getter applied). Equals `raw` until those land. */
	readonly display: unknown;
}
