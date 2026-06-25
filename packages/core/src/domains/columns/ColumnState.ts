import type { ColumnPin } from './ColumnDef.js';
import type { ColumnId } from './ColumnId.js';

/**
 * Persistable per-column view state (ARCHITECTURE.md §3 R11). Serializable and self-contained —
 * this is what column persistence and view config save/restore. Kept separate from any runtime
 * concern (scroll, mounted slots).
 */
export interface ColumnState {
	readonly columnId: ColumnId;
	/** Field name from the column definition — convenience so callers don't need a separate def lookup. */
	readonly field: string;
	/** Display header from the column definition. */
	readonly header: string;
	readonly width: number;
	readonly hidden: boolean;
	readonly pinned: ColumnPin;
	/** Position in the column order. */
	readonly orderIndex: number;
}
