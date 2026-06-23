/**
 * Branded row identity (ARCHITECTURE.md §3 R5). Row identity is sacred. A data row's `RowId` and
 * a rendered row's `VisualRowId` are distinct types so a loading/group/detail visual row can
 * never be mistaken for a data row in selection, editing, formulas, copy/paste, server reloads,
 * or virtualization.
 */
export type RowId = string & { readonly __brand: 'RowId' };

/** Identity of a row as the user sees it — see {@link VisualRow}. Distinct from {@link RowId}. */
export type VisualRowId = string & { readonly __brand: 'VisualRowId' };

export function asRowId(id: string): RowId {
	return id as RowId;
}

export function asVisualRowId(id: string): VisualRowId {
	return id as VisualRowId;
}
