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

export type FilterCondition = TextFilterCondition | NumberFilterCondition | DateFilterCondition | SetFilterCondition;

export interface CompoundFilterCondition {
	type: 'compound';
	operator: 'AND' | 'OR';
	/** Exactly two leaf conditions. */
	conditions: [FilterCondition, FilterCondition];
}

export type ColumnFilter = FilterCondition | CompoundFilterCondition;

export type FilterModel = Record<string, ColumnFilter>;

/**
 * Compute distinct cell values from an array of row nodes for a given column field.
 * Used by getColumnDistinctValues on GridEngine. Extracted here to keep GridEngine lean.
 */
export function computeDistinctValues(
	nodes: Array<{ getCellValue(field: string, getter: (d: unknown) => unknown): unknown }>,
	colField: string
): (string | number | null)[] {
	const seen = new Set<string>();
	const result: (string | number | null)[] = [];
	for (const node of nodes) {
		const raw = node.getCellValue(colField, (d: unknown) => (d as Record<string, unknown>)[colField]);
		if (raw == null || raw === '') {
			if (!seen.has('\0null')) {
				seen.add('\0null');
				result.push(null);
			}
		} else {
			const key = String(raw);
			if (!seen.has(key)) {
				seen.add(key);
				result.push(typeof raw === 'number' ? raw : key);
			}
		}
	}
	return result.sort((a, b) => {
		if (a === null) return -1;
		if (b === null) return 1;
		if (typeof a === 'number' && typeof b === 'number') return a - b;
		return String(a).localeCompare(String(b));
	});
}
