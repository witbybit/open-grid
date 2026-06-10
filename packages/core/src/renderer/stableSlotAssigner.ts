/**
 * Row slots are stable physical DOM owners.
 * A physical slot may keep ownership of the same visual row while that row remains visible.
 * Slot index is NOT the same thing as viewport position.
 * Visual order is determined by absolute positioning/transform; DOM order must not be
 * treated as visual row order.
 *
 * Algorithm — two-pass stable assignment:
 *   Pass 1: slots whose current visual row is still in the new window stay in place.
 *   Pass 2: entering rows fill freed slots in new-window order (top-to-bottom).
 */
export class StableSlotAssigner {
	private readonly _result: number[] = [];
	private readonly _newWindowSet = new Set<number>();
	private readonly _assignedRows = new Set<number>();
	private readonly _freeSlotIndices: number[] = [];

	/**
	 * Assign newWindowRows to slot indices given the visual row each slot currently holds.
	 *
	 * @param currentSlotRows  Visual row index currently bound to each slot, or -1 if the slot
	 *                         is unbound. Length may be less than newWindowRows if the pool is
	 *                         growing, or greater if it is shrinking.
	 * @param newWindowRows    Sorted list of visual row indices to display next.
	 * @returns A reference to an internal result buffer that is valid only until the next
	 *          assign() call. Callers must consume it synchronously.
	 */
	assign(currentSlotRows: readonly number[], newWindowRows: readonly number[]): readonly number[] {
		const n = newWindowRows.length;
		const result = this._result;
		result.length = n;

		const newWindowSet = this._newWindowSet;
		newWindowSet.clear();
		for (let i = 0; i < n; i++) newWindowSet.add(newWindowRows[i]);

		const assignedRows = this._assignedRows;
		assignedRows.clear();

		const freeSlotIndices = this._freeSlotIndices;
		freeSlotIndices.length = 0;

		// Pass 1 — keep staying rows in their current slot.
		// Only consider existing slots up to the new window size (shrinking slots are pre-evacuated
		// by the caller before ensureSlotCount reduces the pool).
		const slotCount = Math.min(currentSlotRows.length, n);
		for (let i = 0; i < slotCount; i++) {
			const vi = currentSlotRows[i];
			if (vi >= 0 && newWindowSet.has(vi)) {
				result[i] = vi;
				assignedRows.add(vi);
			} else {
				result[i] = -1;
				freeSlotIndices.push(i);
			}
		}
		// Slots beyond the current pool count are new (not yet created) — all free.
		for (let i = slotCount; i < n; i++) {
			result[i] = -1;
			freeSlotIndices.push(i);
		}

		// Pass 2 — assign entering rows to freed slots in window order.
		let freeIdx = 0;
		for (let i = 0; i < n; i++) {
			const row = newWindowRows[i];
			if (!assignedRows.has(row)) {
				result[freeSlotIndices[freeIdx++]] = row;
			}
		}

		return result;
	}
}
