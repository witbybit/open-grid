import { RowSlot } from './rowSlot.js';

let nextSlotId = 0;

export interface SlotCountChange {
	previousCount: number;
	nextCount: number;
	created: number;
	destroyed: number;
}

/**
 * Fixed viewport slot pool — stable physical DOM owners.
 *
 * Key contract:
 *  - Row slots are stable physical DOM owners. A slot may keep ownership of the same
 *    visual row across many scroll frames while that row remains visible.
 *  - Slot index is NOT the same as viewport position. Visual order is determined by
 *    absolute positioning/transform applied to each slot element; DOM order must not
 *    be treated as visual row order.
 *  - slot DOM elements NEVER leave the rows container during steady-state scroll.
 *  - When the rendered row count changes, ensureSlotCount() grows or shrinks the array.
 *  - Growth: createElement, append once, push to slots[].
 *  - Shrink: pop from slots[], call destroyCold(), remove element.
 *  - During normal scroll (same rendered-row count): slot count is unchanged, zero DOM
 *    append/remove operations occur.
 *
 * Callers look up slots by physical pool index, not by visual row index:
 *   slot = rowSlotPool.getSlot(slotIndex)          // always O(1)
 */
export class RowSlotPool<TRowData = unknown> {
	/** All active slots in physical pool order. Slot index ≠ viewport position. */
	private readonly _slots: RowSlot<TRowData>[] = [];
	private readonly container: HTMLElement;

	/** DOM appends since last resetScrollStats(). 0 during steady-state scroll. */
	public slotAppendCount = 0;
	/** DOM removes since last resetScrollStats(). 0 during steady-state scroll. */
	public slotRemoveCount = 0;

	constructor(container: HTMLElement) {
		this.container = container;
	}

	public get count(): number {
		return this._slots.length;
	}

	/**
	 * Grow or shrink the pool to exactly `count` slots.
	 * Growth: create new slot, append DOM element once.
	 * Shrink: pop last slot, destroy cold, remove DOM element.
	 *
	 * Callers MUST evacuate portals from excess slots BEFORE calling this when shrinking.
	 */
	public ensureSlotCount(count: number, isScrollFrame = false): SlotCountChange {
		const previousCount = this._slots.length;
		let created = 0;
		let destroyed = 0;

		while (this._slots.length < count) {
			this._createSlot(isScrollFrame);
			created++;
		}

		while (this._slots.length > count) {
			const slot = this._slots.pop()!;
			slot.destroyCold();
			if (slot.element.parentNode) slot.element.remove();
			if (isScrollFrame) this.slotRemoveCount++;
			destroyed++;
		}

		return { previousCount, nextCount: this._slots.length, created, destroyed };
	}

	/**
	 * Return the slot at viewport position `index`.
	 * Always O(1). index must be in [0, count).
	 */
	public getSlot(index: number): RowSlot<TRowData> {
		return this._slots[index];
	}

	public getSlots(): readonly RowSlot<TRowData>[] {
		return this._slots;
	}

	public resetScrollStats(): void {
		this.slotAppendCount = 0;
		this.slotRemoveCount = 0;
	}

	/** Cold-destroy all slots and remove their DOM elements. */
	public destroy(): void {
		for (const slot of this._slots) {
			slot.destroyCold();
			if (slot.element.parentNode) slot.element.remove();
		}
		this._slots.length = 0;
	}

	// ── Internal ─────────────────────────────────────────────────────────────────────

	private _createSlot(isScrollFrame: boolean): RowSlot<TRowData> {
		const el = document.createElement('div');
		this.container.appendChild(el);
		const slot = new RowSlot<TRowData>(`rsp-${nextSlotId++}`, el as HTMLDivElement);
		this._slots.push(slot);
		if (isScrollFrame) this.slotAppendCount++;
		return slot;
	}
}
