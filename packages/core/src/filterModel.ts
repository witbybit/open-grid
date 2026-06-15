// V2 discriminated-union filter model.
// The legacy FilterModelItem shape ({ type?: FilterOperator, filter: unknown }) is
// auto-converted at prepare time so callers that set filterModel programmatically
// with the old shape continue to work.

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

// ── Legacy shape detection + conversion ──────────────────────────────────────

const LEGACY_NUMBER_OPS = new Set(['gt', 'gte', 'lt', 'lte']);
const NEW_TYPES = new Set(['text', 'number', 'date', 'set', 'compound']);

export function isColumnFilter(value: unknown): value is ColumnFilter {
	return typeof value === 'object' && value !== null && 'type' in value && NEW_TYPES.has((value as { type: string }).type);
}

/**
 * Convert any filter model value (new ColumnFilter, legacy FilterModelItem, or raw value)
 * into a ColumnFilter. Returns null if the value is empty or cannot be interpreted.
 *
 * Detection order matters: check for the legacy `filter` key FIRST because some legacy items
 * have `type: 'text'` or `type: 'number'` which would otherwise match the new discriminants.
 */
export function legacyItemToColumnFilter(item: unknown): ColumnFilter | null {
	if (item == null) return null;

	// Legacy FilterModelItem: { type?: FilterOperator, filter: unknown }
	// Must be checked BEFORE isColumnFilter since old `type` values like 'contains' are distinct,
	// but users may also have written `type: 'text'` with a `filter` key (non-standard legacy).
	if (typeof item === 'object' && 'filter' in (item as object)) {
		const legacy = item as { type?: string; filter: unknown };
		const filter = legacy.filter;
		if (filter == null || filter === '') return null;
		const op = legacy.type ?? 'contains';
		if (LEGACY_NUMBER_OPS.has(op)) {
			const n = Number(filter);
			if (isNaN(n)) return null;
			return { type: 'number', operator: op as NumberFilterOperator, value: n };
		}
		// All other operators (including the old default 'contains') → text filter
		const textOp: TextFilterOperator =
			op === 'contains' ||
			op === 'notContains' ||
			op === 'equals' ||
			op === 'notEquals' ||
			op === 'startsWith' ||
			op === 'endsWith' ||
			op === 'blank' ||
			op === 'notBlank'
				? (op as TextFilterOperator)
				: 'contains';
		return { type: 'text', operator: textOp, value: String(filter) };
	}

	// Already a valid v2 ColumnFilter
	if (isColumnFilter(item)) return item;

	// Raw string or number used as implicit "contains" text filter
	if (typeof item === 'string') return item ? { type: 'text', operator: 'contains', value: item } : null;
	if (typeof item === 'number') return { type: 'text', operator: 'contains', value: String(item) };
	return null;
}

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

/**
 * Migrate a v1 FilterModel (Record<string, FilterModelItem | unknown>) to a v2
 * FilterModel (Record<string, ColumnFilter>). Used by schema migration in statePersistence.
 */
export function migrateFilterModelV1toV2(filterModel: Record<string, unknown>): FilterModel {
	const result: FilterModel = {};
	for (const [colId, item] of Object.entries(filterModel)) {
		const converted = legacyItemToColumnFilter(item);
		if (converted) result[colId] = converted;
	}
	return result;
}
