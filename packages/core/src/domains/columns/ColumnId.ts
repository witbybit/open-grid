/**
 * Branded column identity (ARCHITECTURE.md §3 R5). A `ColumnId` is a string at runtime but is
 * nominally distinct from a `RowId`, `VisualRowId`, or `CellId` at the type level, so the two can
 * never be passed in the wrong position.
 *
 * The columns domain is fleshed out in Phase 6; this file exists now because the rows and cells
 * domains reference column identity.
 */
export type ColumnId = string & { readonly __brand: 'ColumnId' };

export function asColumnId(id: string): ColumnId {
	return id as ColumnId;
}
