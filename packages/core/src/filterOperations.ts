/**
 * Centralised filter and sort metadata.
 *
 * Single source of truth for:
 *  - Operator tables (TEXT_OPS / NUMBER_OPS / DATE_OPS) with symbol, label, and chip label
 *  - Helper functions used by floatingFilterRenderer, filterChipBarRenderer, contextMenu,
 *    and headerMenuController so none of them duplicate the tables or logic.
 */

/** Minimal column shape needed by filter operations — avoids contravariant TRowData issues. */
export interface FilterableColumn {
	field: string;
	filterType?: string | null;
	filterValues?: unknown[];
}

import type { ColumnFilter, FilterModel, TextFilterOperator, NumberFilterOperator, DateFilterOperator } from './filterModel.js';

// ── Operator metadata ────────────────────────────────────────────────────────

export interface OpOption {
	/** Operator value used in the filter model (e.g. 'contains', 'gt'). */
	value: string;
	/** Full label shown in dropdowns and operator menus. */
	label: string;
	/** Compact symbol shown on the floating-filter operator button. */
	symbol: string;
	/** Short label used in filter chip text; falls back to symbol when omitted. */
	chipLabel?: string;
	/** No value input needed (blank / notBlank operators). */
	noValue?: boolean;
	/** Two value inputs needed (inRange operator). */
	range?: boolean;
}

export const TEXT_OPS: OpOption[] = [
	{ value: 'contains', label: 'Contains', symbol: '~', chipLabel: 'contains' },
	{ value: 'notContains', label: 'Not contains', symbol: '!~', chipLabel: '¬contains' },
	{ value: 'equals', label: 'Equals', symbol: '=', chipLabel: '=' },
	{ value: 'notEquals', label: 'Not equals', symbol: '≠', chipLabel: '≠' },
	{ value: 'startsWith', label: 'Starts with', symbol: '^', chipLabel: 'starts' },
	{ value: 'endsWith', label: 'Ends with', symbol: '$', chipLabel: 'ends' },
	{ value: 'blank', label: 'Is blank', symbol: '∅', chipLabel: 'is blank', noValue: true },
	{ value: 'notBlank', label: 'Not blank', symbol: '!∅', chipLabel: 'not blank', noValue: true },
];

export const NUMBER_OPS: OpOption[] = [
	{ value: 'equals', label: 'Equals', symbol: '=', chipLabel: '=' },
	{ value: 'notEquals', label: 'Not equals', symbol: '≠', chipLabel: '≠' },
	{ value: 'gt', label: 'Greater than', symbol: '>', chipLabel: '>' },
	{ value: 'gte', label: 'Greater or equal', symbol: '≥', chipLabel: '≥' },
	{ value: 'lt', label: 'Less than', symbol: '<', chipLabel: '<' },
	{ value: 'lte', label: 'Less or equal', symbol: '≤', chipLabel: '≤' },
	{ value: 'inRange', label: 'In range', symbol: '↔', chipLabel: 'in range', range: true },
	{ value: 'blank', label: 'Is blank', symbol: '∅', chipLabel: 'is blank', noValue: true },
	{ value: 'notBlank', label: 'Not blank', symbol: '!∅', chipLabel: 'not blank', noValue: true },
];

export const DATE_OPS: OpOption[] = [
	{ value: 'equals', label: 'On date', symbol: '=', chipLabel: 'on' },
	{ value: 'before', label: 'Before', symbol: '<', chipLabel: 'before' },
	{ value: 'after', label: 'After', symbol: '>', chipLabel: 'after' },
	{ value: 'inRange', label: 'In range', symbol: '↔', chipLabel: 'between', range: true },
	{ value: 'blank', label: 'Is blank', symbol: '∅', chipLabel: 'is blank', noValue: true },
	{ value: 'notBlank', label: 'Not blank', symbol: '!∅', chipLabel: 'not blank', noValue: true },
];

export function getOpsForType(filterType: string): OpOption[] {
	if (filterType === 'number') return NUMBER_OPS;
	if (filterType === 'date') return DATE_OPS;
	return TEXT_OPS;
}

export function getOpMeta(filterType: string, operator: string): OpOption {
	return getOpsForType(filterType).find((o) => o.value === operator) ?? { value: operator, label: operator, symbol: '~' };
}

export function defaultOpForType(filterType: string): string {
	if (filterType === 'number') return 'equals';
	if (filterType === 'date') return 'equals';
	return 'contains';
}

// ── Column filterability ─────────────────────────────────────────────────────

/** True when the column is set up for filtering (has a filterType other than 'none'). */
export function isFilterableColumn(col: FilterableColumn): boolean {
	const ft = col.filterType;
	return ft !== undefined && ft !== null && ft !== 'none';
}

// ── Filter model helpers ─────────────────────────────────────────────────────

/**
 * Return a new filter model with `filter` applied to `colField`.
 * Pass `null` as `filter` to clear that column.
 * Returns `null` when the resulting model would be empty.
 */
export function applyFilterToModel(colField: string, filter: ColumnFilter | null, currentModel: FilterModel | null): FilterModel | null {
	const next = { ...(currentModel ?? {}) };
	if (filter === null) {
		delete next[colField];
	} else {
		next[colField] = filter;
	}
	return Object.keys(next).length > 0 ? next : null;
}

/**
 * Build a "Filter by Value" (or "Exclude This Value") filter for a column and merge it
 * into the current model.  Used by the context-menu right-click actions.
 */
export function buildFilterByValue(col: FilterableColumn, rawValue: unknown, exclude: boolean, currentModel: FilterModel | null): FilterModel | null {
	const filterType = col.filterType as string | undefined;
	const colField = col.field;
	const next = { ...(currentModel ?? {}) };

	if (filterType === 'set') {
		const existing = next[colField]?.type === 'set' ? (next[colField] as { type: 'set'; values: (string | null)[] }).values : null;
		const strVal = rawValue === null || rawValue === undefined ? null : String(rawValue);
		if (exclude) {
			const allValues = (col.filterValues as string[] | undefined) ?? [];
			next[colField] = { type: 'set', values: allValues.filter((v) => v !== strVal) };
		} else {
			const nextVals: (string | null)[] = existing ? [...new Set([...existing, strVal])] : [strVal];
			next[colField] = { type: 'set', values: nextVals };
		}
	} else if (filterType === 'number') {
		const n = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue));
		if (isNaN(n)) return currentModel;
		next[colField] = exclude
			? { type: 'number', operator: 'notEquals' as NumberFilterOperator, value: n }
			: { type: 'number', operator: 'equals' as NumberFilterOperator, value: n };
	} else if (filterType === 'date') {
		const dateStr = rawValue instanceof Date ? rawValue.toISOString().slice(0, 10) : String(rawValue ?? '').slice(0, 10);
		if (!dateStr) return currentModel;
		next[colField] = exclude
			? { type: 'date', operator: 'after' as DateFilterOperator, dateFrom: dateStr }
			: { type: 'date', operator: 'equals' as DateFilterOperator, dateFrom: dateStr };
	} else {
		const strVal = rawValue === null || rawValue === undefined ? '' : String(rawValue);
		next[colField] = exclude
			? { type: 'text', operator: 'notEquals' as TextFilterOperator, value: strVal }
			: { type: 'text', operator: 'equals' as TextFilterOperator, value: strVal };
	}

	return Object.keys(next).length > 0 ? next : null;
}

// ── Chip bar display text ────────────────────────────────────────────────────

/**
 * Return the short text shown inside a filter chip for a single column filter.
 * Example: `contains "Atlas"`, `≥ 100`, `on 2024-01-15`.
 */
export function getFilterChipText(filter: ColumnFilter): string {
	switch (filter.type) {
		case 'text': {
			const op = getOpMeta('text', filter.operator);
			const lbl = op.chipLabel ?? op.symbol;
			if (op.noValue) return lbl;
			return `${lbl} "${filter.value}"`;
		}
		case 'number': {
			const op = getOpMeta('number', filter.operator);
			const lbl = op.chipLabel ?? op.symbol;
			if (op.noValue) return lbl;
			if (op.range) return `${filter.value} – ${filter.valueTo ?? '…'}`;
			return `${lbl} ${filter.value}`;
		}
		case 'date': {
			const op = getOpMeta('date', filter.operator);
			const lbl = op.chipLabel ?? op.symbol;
			if (op.noValue) return lbl;
			if (op.range) return `${filter.dateFrom} – ${filter.dateTo ?? '…'}`;
			return `${lbl} ${filter.dateFrom}`;
		}
		case 'set': {
			if (filter.values.length === 0) return '(none)';
			const labels = filter.values.slice(0, 3).map((v) => (v === null ? '(blank)' : String(v)));
			const extra = filter.values.length > 3 ? ` +${filter.values.length - 3} more` : '';
			return labels.join(', ') + extra;
		}
		case 'select': {
			if (filter.values.length === 0) return '(none)';
			// Use stored labels when available — avoids re-fetching async option lists.
			const displayLabels =
				filter.labels && filter.labels.length === filter.values.length
					? filter.labels
					: filter.values.map((v) => (v === null ? '(blank)' : String(v)));
			const shown = displayLabels.slice(0, 2);
			const extra = filter.values.length > 2 ? ` +${filter.values.length - 2} more` : '';
			return shown.join(', ') + extra;
		}
		case 'compound': {
			const [c1, c2] = filter.conditions;
			return `${getFilterChipText(c1)} ${filter.operator} ${getFilterChipText(c2)}`;
		}
	}
}
