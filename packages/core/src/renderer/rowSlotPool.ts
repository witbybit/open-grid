import { RowSlot } from './rowSlot.js';

let nextSlotId = 0;

/**
 * Phase 2 (revised) — Identity-stable row slot pool.
 *
 * Key contract:
 *  - Slot DOM elements NEVER leave the rows container during steady-state scroll.
 *  - Each active (assigned) slot stays assigned to the same visual row until that
 *    row exits the rendered window.
 *  - When a row exits, its slot is returned to the free queue.
 *  - When a row enters, a slot is taken from the free queue and assigned to it.
 *  - Only growing (DOM append) or shrinking (cold-destroy) happens on pool-size change.
 *
 * This enables the O(entered_rows) "entered-only optimisation":
 *  - Stayed rows: their slots are already correctly bound — ZERO work.
 *  - Entered rows: take a free slot and do a full bind.
 *  - Exited rows: return slot to free queue.
 */
export class RowSlotPool<TRowData = unknown> {
	/** All ever-created slot objects, ordered by creation. */
	private readonly _allSlots: RowSlot<TRowData>[] = [];
	/** Unassigned slots, ready to be taken by entering rows. */
	private readonly _freeSlots: RowSlot<TRowData>[] = [];
	private readonly container: HTMLElement;

	/** Total DOM appends since last resetScrollStats(). Should be 0 during steady-state scroll. */
	public slotAppendCount = 0;
	/** Total DOM removes since last resetScrollStats(). Should be 0 during steady-state scroll. */
	public slotRemoveCount = 0;

	constructor(container: HTMLElement) {
		this.container = container;
	}

	public get count(): number {
		return this._allSlots.length;
	}

	public get freeCount(): number {
		return this._freeSlots.length;
	}

	/**
	 * Take a slot from the free queue for an entering row.
	 * Grows the pool by one if the free queue is empty.
	 */
	public acquireSlot(isScrollFrame = false): RowSlot<TRowData> {
		if (this._freeSlots.length > 0) {
			return this._freeSlots.pop()!;
		}
		// Grow
		return this._createSlot(isScrollFrame);
	}

	/**
	 * Return a slot to the free queue (called when its row exits the window).
	 * The slot's DOM element remains in the container.
	 */
	public releaseSlot(slot: RowSlot<TRowData>): void {
		this._freeSlots.push(slot);
	}

	/**
	 * Ensure the pool has at least `n` total slots (grow-only convenience).
	 * Use when viewport height grows and new rows need to be shown without
	 * a matching set of exiting rows.
	 */
	public growTo(n: number, isScrollFrame = false): void {
		while (this._allSlots.length < n) {
			const slot = this._createSlot(isScrollFrame);
			this._freeSlots.push(slot);
		}
	}

	/**
	 * Shrink the pool by destroying up to `count` free slots.
	 * Only free (unassigned) slots are ever destroyed — active slots are never touched.
	 */
	public shrinkFreeBy(count: number, isScrollFrame = false): void {
		let removed = 0;
		while (removed < count && this._freeSlots.length > 0) {
			const slot = this._freeSlots.pop()!;
			slot.destroyCold();
			if (slot.element.parentNode) slot.element.remove();
			const idx = this._allSlots.indexOf(slot);
			if (idx >= 0) this._allSlots.splice(idx, 1);
			if (isScrollFrame) this.slotRemoveCount++;
			removed++;
		}
	}

	/**
	 * @deprecated For callers that still use positional access (compat shim).
	 * Returns the slot at position `index` in creation order.
	 */
	public getSlot(index: number): RowSlot<TRowData> {
		return this._allSlots[index];
	}

	public getSlots(): readonly RowSlot<TRowData>[] {
		return this._allSlots;
	}

	public resetScrollStats(): void {
		this.slotAppendCount = 0;
		this.slotRemoveCount = 0;
	}

	/** Cold-destroy all slots and remove their DOM elements. */
	public destroy(): void {
		for (const slot of this._allSlots) {
			slot.destroyCold();
			if (slot.element.parentNode) slot.element.remove();
		}
		this._allSlots.length = 0;
		this._freeSlots.length = 0;
	}

	// ── Internal ─────────────────────────────────────────────────────────────────────

	private _createSlot(isScrollFrame: boolean): RowSlot<TRowData> {
		const el = document.createElement('div');
		this.container.appendChild(el);
		const slot = new RowSlot<TRowData>(`rsp-${nextSlotId++}`, el as HTMLDivElement);
		this._allSlots.push(slot);
		if (isScrollFrame) this.slotAppendCount++;
		return slot;
	}
}
