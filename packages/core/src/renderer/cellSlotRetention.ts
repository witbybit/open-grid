import { GridMetric, type GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import type { CellSlot } from './cellSlot.js';
import type { RowSlot } from './rowSlot.js';

/**
 * Bounds how many cell slots a single row slot's `cellsByColumnId` map may retain once columns
 * scroll out of the visible+approach-band window. Without this, `reconcileCellTopologyForScroll`
 * (which deliberately never evicts, to keep the scroll hot path free of teardown work) lets the
 * map grow to one entry per distinct column ever visited — unbounded on a wide grid.
 *
 * Not exposed publicly — internal tuning only.
 */
export const CELL_SLOT_RETENTION_CONFIG = {
	/** Safety ceiling folded into the total budget alongside the LRU tail below. Chosen well above
	 *  any realistic visible+approach-band window so it never binds in practice — it exists so a
	 *  pathologically large approach-band configuration can't silently defeat the LRU bound. */
	maxRetainedCenterCellsPerRowSlot: 64,
	/** How many additional exited-column cell slots may be kept warm beyond the always-kept set
	 *  (visible + approach-band + pinned + focused), oldest-touched evicted first. */
	maxRecentlyExitedColumnsPerRowSlot: 32,
	/** Among equally-old eviction candidates, release portal-mode cells (heavier: portal host,
	 *  possible React-owned content) before plain text/empty cells. */
	preferEvictPortalCells: true,
};

export interface CellSlotRetentionResult {
	retainedAfter: number;
	evicted: number;
}

/**
 * Enforces the retention policy on one row slot's `cellsByColumnId` map.
 *
 * `keepFields` must contain every column field this frame's render window requires to stay
 * correct right now — visible columns, horizontal approach-band columns, pinned-left/right
 * columns, and the currently focused/edited column. Every entry in `keepFields` is guaranteed to
 * survive this call unconditionally; eviction only ever touches columns outside that set.
 *
 * Deterministic and safe to call every scroll frame: it never removes a column that is still
 * needed, and evicted cells are plain CellSlot objects with no snapshot/version references left
 * dangling — recreating them on re-entry produces a fresh cell with no residual identity.
 */
export function applyCellSlotRetentionPolicy<TRowData>(
	slot: RowSlot<TRowData>,
	keepFields: ReadonlySet<string>,
	releaseFn: (cell: CellSlot<TRowData>) => void,
	instrumentation?: GridInstrumentation
): CellSlotRetentionResult {
	const cells = slot.cellsByColumnId;

	// Touch every kept field so it moves to the most-recently-used end of the map's iteration
	// order (Map preserves insertion order; delete+set re-inserts at the end). Anything left
	// un-touched ages toward the front, which is exactly the eviction candidate pool below.
	for (const field of keepFields) {
		const cell = cells.get(field);
		if (cell) {
			cells.delete(field);
			cells.set(field, cell);
		}
	}

	const totalBudget =
		Math.max(CELL_SLOT_RETENTION_CONFIG.maxRetainedCenterCellsPerRowSlot, keepFields.size) +
		CELL_SLOT_RETENTION_CONFIG.maxRecentlyExitedColumnsPerRowSlot;

	let evicted = 0;
	if (cells.size > totalBudget) {
		const overBudget = cells.size - totalBudget;
		const evictable: string[] = [];
		for (const field of cells.keys()) {
			if (!keepFields.has(field)) evictable.push(field);
		}

		const ordered = CELL_SLOT_RETENTION_CONFIG.preferEvictPortalCells ? stablePartitionPortalFirst(evictable, cells) : evictable;

		for (let i = 0; i < overBudget && i < ordered.length; i++) {
			const field = ordered[i];
			const cell = cells.get(field);
			if (!cell) continue;
			releaseFn(cell);
			if (cell.element.parentNode) cell.element.remove();
			cells.delete(field);
			instrumentation?.increment(GridMetric.CELL_VIEW_DESTROYED);
			evicted++;
		}
	}

	return { retainedAfter: cells.size, evicted };
}

/** Stable partition: portal-mode cells first (in their original relative order), then the rest. */
function stablePartitionPortalFirst<TRowData>(fields: string[], cells: ReadonlyMap<string, CellSlot<TRowData>>): string[] {
	const portalFields: string[] = [];
	const otherFields: string[] = [];
	for (const field of fields) {
		const cell = cells.get(field);
		if (cell?.lastContentMode === 'portal') portalFields.push(field);
		else otherFields.push(field);
	}
	return [...portalFields, ...otherFields];
}
