import type { ColumnId } from '../columns/ColumnId.js';

export interface ValueParserParams<TRow> {
	/** The raw text the user entered. */
	readonly text: string;
	readonly row: TRow;
	readonly columnId: ColumnId;
	readonly field: string;
}

/**
 * Parses user-entered text into a typed value (ARCHITECTURE.md §3 R8). Synchronous. Optional — when
 * absent the engine writes the value as-is.
 */
export type ValueParser<TRow> = (params: ValueParserParams<TRow>) => unknown;
