import type { ColumnId } from '../columns/ColumnId.js';

export type SortDirection = 'asc' | 'desc';

export interface SortKey {
	readonly columnId: ColumnId;
	readonly field: string;
	readonly direction: SortDirection;
}

/** Ordered list of sort keys; earlier keys take precedence. */
export type SortModel = readonly SortKey[];

export interface ColumnFilter {
	readonly columnId: ColumnId;
	readonly field: string;
	/** Returns true to KEEP the row. */
	readonly predicate: (value: unknown, row: unknown) => boolean;
}

/** A row is kept only if it passes every column filter (AND semantics). */
export type FilterModel = readonly ColumnFilter[];

export const EMPTY_SORT_MODEL: SortModel = [];
export const EMPTY_FILTER_MODEL: FilterModel = [];

export function sortColumnIds(model: SortModel): Set<ColumnId> {
	return new Set(model.map((k) => k.columnId));
}

export function filterColumnIds(model: FilterModel): Set<ColumnId> {
	return new Set(model.map((f) => f.columnId));
}
