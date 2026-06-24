import type { ValueParser } from '../cells/ValueParser.js';
import type { ValueSetter } from '../cells/ValueSetter.js';
import type { ValueFormatter, ValueGetter } from '../cells/ValueGetter.js';

export type ColumnPin = 'left' | 'right' | null;

/**
 * The user-facing definition of a column (ARCHITECTURE.md §3 R11). Static configuration — the
 * mutable view state (resolved width, current visibility/pin/order) lives in {@link ColumnState}
 * so persistence and runtime stay separate. `valueSetter` / `valueParser` are resolved by the
 * column model and consumed by the cell value engine.
 */
export interface ColumnDef<TRow = unknown> {
	readonly id: string;
	/** Data field path this column reads/writes. Defaults to `id`. */
	readonly field?: string;
	readonly header?: string;
	readonly width?: number;
	readonly minWidth?: number;
	readonly maxWidth?: number;
	readonly hidden?: boolean;
	readonly pinned?: ColumnPin;
	readonly sortable?: boolean;
	readonly filterable?: boolean;
	readonly valueSetter?: ValueSetter<TRow>;
	readonly valueParser?: ValueParser<TRow>;
	/** Computes the raw value (overrides the field read). Makes the column computed/read-only. */
	readonly valueGetter?: ValueGetter<TRow>;
	/** Formats the value for display. */
	readonly valueFormatter?: ValueFormatter<TRow>;
}

export const DEFAULT_COLUMN_WIDTH = 150;
export const DEFAULT_COLUMN_MIN_WIDTH = 40;
