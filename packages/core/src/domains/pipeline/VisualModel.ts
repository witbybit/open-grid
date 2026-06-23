import type { RowId, VisualRowId } from '../rows/RowId.js';
import type { VisualRow } from './VisualRow.js';
import { rowIdOfVisualRow } from './VisualRow.js';

/**
 * The ordered set of rows the renderer paints (ARCHITECTURE.md §3 R6). A snapshot — produced by the
 * pipeline, consumed downstream. Carries indexes for O(1) lookup by visual position, data `RowId`,
 * and `VisualRowId`.
 */
export class VisualModel<TRow = unknown> {
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
}

export const EMPTY_VISUAL_MODEL = new VisualModel<unknown>([]);
