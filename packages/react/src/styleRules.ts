import { useEffect } from 'react';
import type { GridApi } from '@open-grid/core';
import type { ColumnDef, GridStyleSlots } from '@open-grid/core';

// Derive the params types from the GridStyleSlots callbacks so we don't depend on
// unexported param types from @open-grid/core.
type RowClassParams<TRowData> = NonNullable<GridStyleSlots<TRowData>['rowClass']> extends (row: TRowData, params: infer P) => string ? P : never;
type CellClassParams<TRowData> =
	NonNullable<GridStyleSlots<TRowData>['cellClass']> extends (col: ColumnDef<TRowData>, row: TRowData, params: infer P) => string ? P : never;

// ─── Rule types ───────────────────────────────────────────────────────────────

/** Applies classes to an entire row when `when` returns true. */
export interface RowStyleRule<TRowData = unknown> {
	kind: 'row';
	when: (row: TRowData, params: RowClassParams<TRowData>) => boolean;
	rowClass: string;
}

/** Applies classes to a cell when `when` returns true. Optionally scoped to a single `field`. */
export interface CellStyleRule<TRowData = unknown> {
	kind: 'cell';
	/** When set, this rule only applies to cells in this column. Omit to apply to all columns. */
	field?: string;
	when: (row: TRowData, col: ColumnDef<TRowData>, params: CellClassParams<TRowData>) => boolean;
	cellClass: string;
}

/** Applies classes to a header cell when `when` returns true. Optionally scoped to a single `field`. */
export interface HeaderCellStyleRule<TRowData = unknown> {
	kind: 'headerCell';
	/** When set, this rule only applies to the header for this column. Omit to apply to all header cells. */
	field?: string;
	when: (col: ColumnDef<TRowData>) => boolean;
	headerCellClass: string;
}

export type StyleRule<TRowData = unknown> = RowStyleRule<TRowData> | CellStyleRule<TRowData> | HeaderCellStyleRule<TRowData>;

// ─── Compiler (internal) ──────────────────────────────────────────────────────

export function compileStyleRules<TRowData>(rules: StyleRule<TRowData>[]): GridStyleSlots<TRowData> {
	if (rules.length === 0) return {};

	const rowRules = rules.filter((r): r is RowStyleRule<TRowData> => r.kind === 'row');
	const cellRules = rules.filter((r): r is CellStyleRule<TRowData> => r.kind === 'cell');
	const headerRules = rules.filter((r): r is HeaderCellStyleRule<TRowData> => r.kind === 'headerCell');

	const styleSlots: GridStyleSlots<TRowData> = {};

	if (rowRules.length > 0) {
		styleSlots.rowClass = (row, params) => {
			const classes: string[] = [];
			for (const rule of rowRules) {
				if (rule.when(row, params)) classes.push(rule.rowClass);
			}
			return classes.join(' ');
		};
	}

	if (cellRules.length > 0) {
		styleSlots.cellClass = (col, row, params) => {
			const classes: string[] = [];
			for (const rule of cellRules) {
				if (rule.field !== undefined && rule.field !== col.field) continue;
				if (rule.when(row, col, params)) classes.push(rule.cellClass);
			}
			return classes.join(' ');
		};
	}

	if (headerRules.length > 0) {
		styleSlots.headerCellClass = (col) => {
			const classes: string[] = [];
			for (const rule of headerRules) {
				if (rule.field !== undefined && rule.field !== col.field) continue;
				if (rule.when(col)) classes.push(rule.headerCellClass);
			}
			return classes.join(' ');
		};
	}

	return styleSlots;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Applies declarative style rules to a grid API instance.
 * Use this when you receive `api` as a prop rather than owning it via `useClientGrid`.
 *
 * Memoize the `rules` array with `useMemo` to avoid unnecessary re-applications.
 *
 * @example
 * ```ts
 * const styleRules = useMemo<StyleRule<Row>[]>(() => [
 *   { kind: 'row', when: (row) => row.status === 'error', rowClass: 'bg-red-950/20' },
 * ], []);
 * useStyleRules(api, styleRules);
 * ```
 */
export function useStyleRules<TRowData>(api: GridApi<TRowData>, rules: StyleRule<TRowData>[]): void {
	useEffect(() => {
		if (!rules || rules.length === 0) {
			api.setStyleSlots(undefined);
			return;
		}
		api.setStyleSlots(compileStyleRules(rules));
	}, [api, rules]);
}
