import type { RowId, VisualRowId } from '../rows/RowId.js';
import { asVisualRowId } from '../rows/RowId.js';
import type { RowNode } from '../rows/RowNode.js';
import type { VisualModelView } from './VisualModel.js';
import type { VisualRow } from './VisualRow.js';
import { dataVisualRow, loadingVisualRow } from './VisualRow.js';

/**
 * Returns the loaded node at a source index, or null when that index is not yet loaded.
 */
export type WindowedNodeAccessor<TRow> = (index: number) => RowNode<TRow> | null;

/**
 * Lazy visual model for windowed datasets (infinite/server) — ARCHITECTURE.md §3 R6, R12. Spans the
 * full `totalRowCount`; a loaded index resolves to a `data` row, a gap to a `loading` row. Nothing
 * is materialized: the renderer pulls only the visible window via `getByVisualIndex`, so a
 * million-row dataset costs nothing until painted. Loaded-row id lookups use a small index built
 * from the currently loaded nodes.
 */
export class WindowedVisualModel<TRow = unknown> implements VisualModelView<TRow> {
	readonly count: number;
	private readonly nodeAt: WindowedNodeAccessor<TRow>;
	private readonly loadedRowIndex: ReadonlyMap<RowId, number>;

	constructor(totalRowCount: number, nodeAt: WindowedNodeAccessor<TRow>, loadedRows: readonly RowNode<TRow>[]) {
		this.count = totalRowCount;
		this.nodeAt = nodeAt;
		const index = new Map<RowId, number>();
		for (const node of loadedRows) index.set(node.id, node.sourceIndex);
		this.loadedRowIndex = index;
	}

	getByVisualIndex(index: number): VisualRow<TRow> | null {
		if (index < 0 || index >= this.count) return null;
		const node = this.nodeAt(index);
		return node ? dataVisualRow(node) : loadingVisualRow(index);
	}

	indexOfRowId(rowId: RowId): number {
		return this.loadedRowIndex.get(rowId) ?? -1;
	}

	indexOfVisualRowId(visualRowId: VisualRowId): number {
		// Data rows use `v:data:<rowId>`; loading rows use `v:loading:<index>`.
		const raw = String(visualRowId);
		if (raw.startsWith('v:loading:')) {
			const idx = Number(raw.slice('v:loading:'.length));
			return Number.isInteger(idx) ? idx : -1;
		}
		if (raw.startsWith('v:data:')) {
			return this.indexOfRowId(asVisualRowId(raw.slice('v:data:'.length)) as unknown as RowId);
		}
		return -1;
	}

	isVisible(rowId: RowId): boolean {
		return this.loadedRowIndex.has(rowId);
	}

	toArray(): readonly VisualRow<TRow>[] {
		const out: VisualRow<TRow>[] = [];
		for (let i = 0; i < this.count; i++) out.push(this.getByVisualIndex(i)!);
		return out;
	}
}
