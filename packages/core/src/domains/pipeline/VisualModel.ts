import type { RowId, VisualRowId } from '../rows/RowId.js';
import type { VisualRow } from './VisualRow.js';
import { rowIdOfVisualRow } from './VisualRow.js';

/**
 * The read surface the renderer consumes (ARCHITECTURE.md §3 R6, R12). Index-addressed so a
 * windowed (infinite/server) model can answer lazily without materializing millions of rows. The
 * renderer pulls `getByVisualIndex(i)` for the visible window only.
 */
export interface VisualModelView<TRow = unknown> {
	readonly count: number;
	getByVisualIndex(index: number): VisualRow<TRow> | null;
	/** Visual position of a data row, or -1 if not currently visible. */
	indexOfRowId(rowId: RowId): number;
	indexOfVisualRowId(visualRowId: VisualRowId): number;
	isVisible(rowId: RowId): boolean;
	/** Materialize the rows (cheap for eager models; for windowed models prefer index access). */
	toArray(): readonly VisualRow<TRow>[];
}

/**
 * Eager visual model: a fully materialized, ordered row array with O(1) index/id lookup. Used for
 * the client (full-dataset) path where the row count is in-memory-sized.
 */
export class VisualModel<TRow = unknown> implements VisualModelView<TRow> {
	readonly rows: readonly VisualRow<TRow>[];
	private readonly byRowId = new Map<RowId, number>();
	private readonly byVisualRowId = new Map<VisualRowId, number>();

	constructor(rows: readonly VisualRow<TRow>[]) {
		this.rows = rows;
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i]!;
			this.byVisualRowId.set(row.visualRowId, i);
			const rowId = rowIdOfVisualRow(row);
			if (rowId != null) this.byRowId.set(rowId, i);
		}
	}

	get count(): number {
		return this.rows.length;
	}

	getByVisualIndex(index: number): VisualRow<TRow> | null {
		return this.rows[index] ?? null;
	}

	/** Visual position of a data row, or -1 if it is not currently visible. */
	indexOfRowId(rowId: RowId): number {
		return this.byRowId.get(rowId) ?? -1;
	}

	indexOfVisualRowId(visualRowId: VisualRowId): number {
		return this.byVisualRowId.get(visualRowId) ?? -1;
	}

	isVisible(rowId: RowId): boolean {
		return this.byRowId.has(rowId);
	}

	toArray(): readonly VisualRow<TRow>[] {
		return this.rows;
	}
}

export const EMPTY_VISUAL_MODEL = new VisualModel<unknown>([]);
