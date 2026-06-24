import type { ColumnId } from '../columns/ColumnId.js';

export interface ValueGetterParams<TRow> {
	readonly row: TRow;
	readonly field: string;
	readonly columnId: ColumnId;
}

/**
 * Computes a cell's raw value, overriding the plain field read (ARCHITECTURE.md §3 R8). Synchronous.
 * A computed column (value getter, no backing field) is read-only by nature.
 */
export type ValueGetter<TRow> = (params: ValueGetterParams<TRow>) => unknown;

export interface ValueFormatterParams<TRow> {
	readonly value: unknown;
	readonly row: TRow;
	readonly field: string;
	readonly columnId: ColumnId;
}

/**
 * Formats a cell's value for display (ARCHITECTURE.md §3 R8). Synchronous; returns the display
 * string. When absent, the raw value is shown as-is.
 */
export type ValueFormatter<TRow> = (params: ValueFormatterParams<TRow>) => string;
