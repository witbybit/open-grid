import { createRowCtrl, type RowCtrl } from './RowCtrl.js';

export interface RowCtrlStoreStats {
	created: number;
	reused: number;
	evicted: number;
}

/**
 * Owns RowCtrl lifecycle. NOT bounded by the render window — a row scrolled out of view keeps its
 * RowCtrl (with `attachedSlotId` cleared by the caller on detach) until the row is actually removed
 * from the row model. This is what makes vertical focus/edit row retention possible: the controller
 * for a focused/editing row survives virtualization even when its physical RowSlot doesn't, so
 * re-entering the render window re-attaches to the SAME RowCtrl rather than fabricating a fresh one
 * with no memory of edit state.
 *
 * Known scope limitation (documented, not silently skipped): there is currently no row-removal
 * event this store is wired into automatically, matching the existing codebase's own convention for
 * per-rowId maps (GridEngine.rowVersions and cellDisplaySnapshots are likewise never swept on row
 * removal today). `delete()`/`sweep()` are exposed so a caller with visibility into row removal can
 * invoke them; wiring that up automatically is left as documented follow-up work.
 */
export class RowCtrlStore<TRowData = unknown> {
	private readonly byRowId = new Map<string, RowCtrl<TRowData>>();
	public readonly stats: RowCtrlStoreStats = { created: 0, reused: 0, evicted: 0 };

	public getOrCreate(rowId: string): RowCtrl<TRowData> {
		let ctrl = this.byRowId.get(rowId);
		if (!ctrl) {
			ctrl = createRowCtrl<TRowData>(rowId);
			this.byRowId.set(rowId, ctrl);
			this.stats.created++;
		} else {
			this.stats.reused++;
		}
		return ctrl;
	}

	public get(rowId: string): RowCtrl<TRowData> | undefined {
		return this.byRowId.get(rowId);
	}

	/** Called when a row is permanently gone from the row model (deleted, filtered out) — NOT when
	 *  merely virtualized out of the render window (those stay warm; see class doc above). */
	public delete(rowId: string): boolean {
		const removed = this.byRowId.delete(rowId);
		if (removed) this.stats.evicted++;
		return removed;
	}

	/** Removes every RowCtrl whose rowId is not present in `liveRowIds`. Intended for callers that
	 *  have the authoritative current row-id set (e.g. after a bulk row-model replace) and want to
	 *  sweep everything else in one pass, rather than calling delete() per removed row. */
	public sweep(liveRowIds: ReadonlySet<string>): number {
		let evicted = 0;
		for (const rowId of this.byRowId.keys()) {
			if (!liveRowIds.has(rowId)) {
				this.byRowId.delete(rowId);
				evicted++;
			}
		}
		this.stats.evicted += evicted;
		return evicted;
	}

	public size(): number {
		return this.byRowId.size;
	}

	public clear(): void {
		this.byRowId.clear();
	}
}
