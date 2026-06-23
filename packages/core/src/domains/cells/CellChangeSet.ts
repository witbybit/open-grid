import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { ColumnId } from '../columns/ColumnId.js';
import type { RowId } from '../rows/RowId.js';
import type { CellId } from './CellAddress.js';

export interface CellValueChange {
	readonly oldValue: unknown;
	readonly newValue: unknown;
}

/**
 * Typed description of a cell-value write (ARCHITECTURE.md §3 R2, R8). `changedFieldsByRow` is the
 * input to the shared pipeline impact classifier; `changedValuesByCell` carries the precise
 * old→new transition for undo, validation, and AI-proposal diffing.
 */
export interface CellChangeSet extends GridChangeSet {
	readonly domain: 'cells';
	readonly changedValuesByCell: ReadonlyMap<CellId, CellValueChange>;
	readonly changedFieldsByRow: ReadonlyMap<RowId, ReadonlySet<ColumnId>>;
}
