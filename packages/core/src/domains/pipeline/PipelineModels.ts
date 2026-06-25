import type { ColumnId } from '../columns/ColumnId.js';

export type SortDirection = 'asc' | 'desc';

export interface SortKey {
	readonly columnId: ColumnId;
	readonly field: string;
	readonly direction: SortDirection;
}

/** Ordered list of sort keys; earlier keys take precedence. */
export type SortModel = readonly SortKey[];

/** Serializable filter operators — evaluated by FilterStage directly. */
export type FilterOperator =
	| 'contains'
	| 'notContains'
	| 'equals'
	| 'notEquals'
	| 'startsWith'
	| 'endsWith'
	| 'gt'
	| 'lt'
	| 'gte'
	| 'lte'
	| 'blank'
	| 'notBlank'
	| 'in'
	| 'notIn';

export interface ColumnFilter {
	readonly columnId: ColumnId;
	readonly field: string;
	readonly operator: FilterOperator;
	/** Comparison value. Not required for 'blank'/'notBlank'. */
	readonly value?: unknown;
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

/** Evaluate a single filter operator against a cell value. */
export function evaluateOperator(operator: FilterOperator, cellValue: unknown, filterValue: unknown): boolean {
	const cellStr = cellValue == null ? '' : String(cellValue).toLowerCase();
	const filterStr = filterValue == null ? '' : String(filterValue).toLowerCase();

	switch (operator) {
		case 'contains':    return cellStr.includes(filterStr);
		case 'notContains': return !cellStr.includes(filterStr);
		case 'equals':      return cellStr === filterStr;
		case 'notEquals':   return cellStr !== filterStr;
		case 'startsWith':  return cellStr.startsWith(filterStr);
		case 'endsWith':    return cellStr.endsWith(filterStr);
		case 'blank':       return cellValue == null || cellStr === '';
		case 'notBlank':    return cellValue != null && cellStr !== '';
		case 'gt': {
			const n = Number(cellValue); return !isNaN(n) && n > Number(filterValue);
		}
		case 'lt': {
			const n = Number(cellValue); return !isNaN(n) && n < Number(filterValue);
		}
		case 'gte': {
			const n = Number(cellValue); return !isNaN(n) && n >= Number(filterValue);
		}
		case 'lte': {
			const n = Number(cellValue); return !isNaN(n) && n <= Number(filterValue);
		}
		case 'in': {
			const arr = Array.isArray(filterValue) ? filterValue : [filterValue];
			return arr.some((v) => String(v).toLowerCase() === cellStr);
		}
		case 'notIn': {
			const arr = Array.isArray(filterValue) ? filterValue : [filterValue];
			return !arr.some((v) => String(v).toLowerCase() === cellStr);
		}
		default:
			return true;
	}
}
