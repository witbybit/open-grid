import { computeDistinctValueSummary, type DistinctValueComputationOptions } from './distinctValues.js';

// V2 discriminated-union filter model.

export type TextFilterOperator = 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'blank' | 'notBlank';

export type NumberFilterOperator = 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'inRange' | 'blank' | 'notBlank';

export type DateFilterOperator = 'equals' | 'before' | 'after' | 'inRange' | 'blank' | 'notBlank';

export interface TextFilterCondition {
	type: 'text';
	operator: TextFilterOperator;
	value: string;
}

export interface NumberFilterCondition {
	type: 'number';
	operator: NumberFilterOperator;
	/** Primary filter value. Ignored for blank/notBlank. */
	value: number;
	/** Upper bound for inRange operator. */
	valueTo?: number;
}

export interface DateFilterCondition {
	type: 'date';
	operator: DateFilterOperator;
	/** ISO 8601 date string (e.g. "2024-01-15"). */
	dateFrom: string;
	/** Upper bound for inRange operator (ISO 8601). */
	dateTo?: string;
}

export interface SetFilterCondition {
	type: 'set';
	/**
	 * Values to include. null matches blank/empty cells.
	 * An empty array matches no rows.
	 */
	values: (string | number | null)[];
}

/**
 * Used by all new select filter types (multi-select, single-select, async-*, infinite-*).
 * Supersedes SetFilterCondition for new filter definitions while remaining backwards-compatible.
 */
export interface SelectFilterCondition {
	type: 'select';
	/** Selected option values. Length 1 for single-select, N for multi-select. */
	values: (string | number | null)[];
	/**
	 * Display labels parallel to values — stored so chip bar can show readable text
	 * without re-fetching option lists on every render.
	 */
	labels?: string[];
	/**
	 * 'any' (default): row matches if cell value equals ANY selected value (OR logic).
	 * 'all': row matches only if cell value equals ALL selected values (unusual — useful
	 *         for array-valued cells or tag matching).
	 */
	matchMode?: 'any' | 'all';
}

export type FilterCondition = TextFilterCondition | NumberFilterCondition | DateFilterCondition | SetFilterCondition | SelectFilterCondition;

export interface CompoundFilterCondition {
	type: 'compound';
	operator: 'AND' | 'OR';
	/** Exactly two leaf conditions. */
	conditions: [FilterCondition, FilterCondition];
}

export type ColumnFilter = FilterCondition | CompoundFilterCondition;

export type FilterModel = Record<string, ColumnFilter>;

/**
 * A single search string matched (case-insensitively, via substring containment) against
 * multiple columns at once — the "search box" pattern, as distinct from FilterModel's
 * per-column conditions. A row passes if ANY targeted column's display value contains the
 * search text; combined with any active FilterModel/GridQueryModel entries via AND.
 */
export interface QuickFilterModel {
	/** Search text. Empty/whitespace-only text matches every row. */
	text: string;
	/** Column fields to search. Omit or leave empty to search every displayed column. */
	columnIds?: string[];
}

/**
 * Compute distinct cell values from an array of row nodes for a given column field.
 * Used by getColumnDistinctValues on GridEngine. Extracted here to keep GridEngine lean.
 */
export function computeDistinctValues(
	nodes: Array<{ getCellValue(field: string, getter: (d: unknown) => unknown): unknown }>,
	colField: string,
	options?: DistinctValueComputationOptions
): (string | number | null)[] {
	return [...computeDistinctValueSummary(nodes as never, colField, options).values];
}
