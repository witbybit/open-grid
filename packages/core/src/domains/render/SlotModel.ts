import type { VisualRowId } from '../rows/RowId.js';

export interface RowSlot {
	readonly slotId: number;
	boundVisualRowId: VisualRowId | null;
}

export interface SlotSyncResult {
	/** Visual row → the slot now bound to it. */
	readonly assignments: ReadonlyMap<VisualRowId, number>;
	/** Slots that changed their bound row this sync (must be re-rendered, not remounted). */
	readonly rebound: readonly number[];
	/** Slots freed this sync (their row scrolled out). */
	readonly released: readonly number[];
}

/**
 * A reusable pool of row slots (ARCHITECTURE.md §3 R13). Slot virtualization is first-class: as the
 * window scrolls, slots whose row is still visible keep their binding, slots whose row left are
 * freed and re-bound to incoming rows. The renderer re-renders a rebound slot's content rather than
 * unmounting and remounting an element — React reconciliation never churns thousands of rows.
 */
export class RowSlotPool {
	private readonly slots: RowSlot[] = [];
	private readonly bound = new Map<VisualRowId, number>();
	private readonly free: number[] = [];
	private nextSlotId = 0;

	/** Number of physical slots ever allocated (the pool never shrinks below its high-water mark). */
	get size(): number {
		return this.slots.length;
	}

	/** Rebind the pool to exactly the given visible rows (in order). */
	sync(visibleRowIds: readonly VisualRowId[]): SlotSyncResult {
		const visible = new Set(visibleRowIds);

		// 1. free slots whose row is no longer visible
		const freedThisSync: number[] = [];
		for (const [visualRowId, slotId] of this.bound) {
			if (!visible.has(visualRowId)) {
				this.bound.delete(visualRowId);
				this.slots[slotId]!.boundVisualRowId = null;
				this.free.push(slotId);
				freedThisSync.push(slotId);
			}
		}

		// 2. assign slots to newly visible rows (reuse freed slots, then grow)
		const assignments = new Map<VisualRowId, number>();
		const rebound: number[] = [];
		for (const visualRowId of visibleRowIds) {
			const existing = this.bound.get(visualRowId);
			if (existing !== undefined) {
				assignments.set(visualRowId, existing);
				continue;
			}
			const slotId = this.free.pop() ?? this.allocate();
			this.slots[slotId]!.boundVisualRowId = visualRowId;
			this.bound.set(visualRowId, slotId);
			assignments.set(visualRowId, slotId);
			rebound.push(slotId);
		}

		// `released` is the NET freed set: slots freed this sync that were not reused for an incoming
		// row. A freed-then-reused slot is a rebind, not a release.
		const released = freedThisSync.filter((slotId) => this.slots[slotId]!.boundVisualRowId === null);
		return { assignments, rebound, released };
	}

	getSlot(slotId: number): RowSlot | null {
		return this.slots[slotId] ?? null;
	}

	private allocate(): number {
		const slotId = this.nextSlotId++;
		this.slots[slotId] = { slotId, boundVisualRowId: null };
		return slotId;
	}
}
