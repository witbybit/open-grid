import type { ColumnId } from '../columns/ColumnId.js';

/**
 * Parameters handed to a {@link ValueSetter} (ARCHITECTURE.md §3 R9). A setter mutates `row` (a
 * disposable clone owned by the engine) to apply the value however the column wishes, then returns
 * whether it set anything.
 *
 * `abort()` is REAL — calling it cancels the write entirely (outcome `aborted`, nothing persisted).
 * It is not the fake `() => {}` of the old architecture.
 */
export interface ValueSetterParams<TRow> {
	/** A mutable clone of the row data. Mutate this to apply the value. */
	readonly row: TRow;
	readonly value: unknown;
	readonly oldValue: unknown;
	readonly columnId: ColumnId;
	readonly field: string;
	/** Cancel the write. After calling this, the engine persists nothing. */
	abort(): void;
}

/**
 * Synchronous value setter (ARCHITECTURE.md §3 R9). Returns `true` if it applied the value, `false`
 * to decline. NEVER returns a `Promise` — sync commit paths must be truly sync. Async editing, if
 * needed, is a separate explicit async edit transaction, not this contract.
 */
export type ValueSetter<TRow> = (params: ValueSetterParams<TRow>) => boolean;
