/**
 * Stable physical-slot assignment for row virtualization (ARCHITECTURE.md §3 R13). Lifted from the
 * old renderer verbatim — it is fully engine-agnostic (plain number arrays), the kind of leaf
 * algorithm the new renderer reuses while its data/layout brain is rebuilt on the engine view.
 *
 * Row slots are stable physical DOM owners: a slot keeps ownership of the same visual row while
 * that row stays visible (slot index ≠ viewport position; visual order is set by transform, not DOM
 * order). Two-pass stable assignment: (1) staying rows keep their slot; (2) entering rows fill freed
 * slots in window order.
 */
export class StableSlotAssigner {
	private readonly _result: number[] = [];
	private readonly _newWindowSet = new Set<number>();
	private readonly _assignedRows = new Set<number>();
	private readonly _freeSlotIndices: number[] = [];

	/**
	 * @param currentSlotRows Visual row index bound to each slot, or -1 if unbound. May be shorter
	 *                        (pool growing) or longer (shrinking) than `newWindowRows`.
	 * @param newWindowRows   Sorted visual row indices to display next.
	 * @returns Internal buffer (slotIndex → visual row index) valid until the next `assign()`.
	 */
	assign(currentSlotRows: readonly number[], newWindowRows: readonly number[]): readonly number[] {
		const n = newWindowRows.length;
		const result = this._result;
		result.length = n;

		const newWindowSet = this._newWindowSet;
		newWindowSet.clear();
		for (let i = 0; i < n; i++) newWindowSet.add(newWindowRows[i]!);

		const assignedRows = this._assignedRows;
		assignedRows.clear();

		const freeSlotIndices = this._freeSlotIndices;
		freeSlotIndices.length = 0;

		// Pass 1 — keep staying rows in their current slot.
		const slotCount = Math.min(currentSlotRows.length, n);
		for (let i = 0; i < slotCount; i++) {
			const vi = currentSlotRows[i]!;
			if (vi >= 0 && newWindowSet.has(vi)) {
				result[i] = vi;
				assignedRows.add(vi);
			} else {
				result[i] = -1;
				freeSlotIndices.push(i);
			}
		}
		// Slots beyond the current pool are new — all free.
		for (let i = slotCount; i < n; i++) {
			result[i] = -1;
			freeSlotIndices.push(i);
		}

		// Pass 2 — assign entering rows to freed slots in window order.
		let freeIdx = 0;
		for (let i = 0; i < n; i++) {
			const row = newWindowRows[i]!;
			if (!assignedRows.has(row)) {
				result[freeSlotIndices[freeIdx++]!] = row;
			}
		}

		return result;
	}
}
