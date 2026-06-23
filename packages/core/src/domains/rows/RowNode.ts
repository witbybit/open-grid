import type { RowId } from './RowId.js';

/**
 * A logical data row owned by a row model (ARCHITECTURE.md §3 R5–R6). This is the structural
 * record — pure identity + source position + data. It is NOT a visual row: grouping, tree depth,
 * detail expansion, loading/placeholder status, and pinning are projections computed by the
 * pipeline into `VisualRow`. Selection and edit state live in their own domains.
 *
 * A `RowNode` is an immutable snapshot. A write produces new nodes; it does not mutate one in place.
 */
export interface RowNode<TRow = unknown> {
	readonly id: RowId;
	/** Position in the row model's source order (pre-pipeline). */
	readonly sourceIndex: number;
	readonly data: TRow;
}

export function createRowNode<TRow>(id: RowId, sourceIndex: number, data: TRow): RowNode<TRow> {
	return { id, sourceIndex, data };
}
