import type { RowSlotPool } from './rowSlotPool.js';

/**
 * Assign new-window rows to existing slot indices, preserving slot identity for rows that
 * remain in the window. Returns an array where result[i] is the visual row index for slot i.
 *
 * Pass 1 — slots whose current row is still in the new window stay in place.
 * Pass 2 — entering rows fill the freed slots in window order (top-to-bottom).
 *
 * Pure function: reads slot state but does not mutate the pool.
 */
export function computeStableSlotRows<T>(newWindowRows: readonly number[], rowSlotPool: RowSlotPool<T>): number[] {
	const n = newWindowRows.length;
	const result = new Array<number>(n);
	const newWindowSet = new Set(newWindowRows);
	const assignedRows = new Set<number>();
	const freeSlotIndices: number[] = [];

	const slotCount = Math.min(rowSlotPool.count, n);
	for (let i = 0; i < slotCount; i++) {
		const slot = rowSlotPool.getSlot(i);
		const vi = slot ? slot.visualIndex : -1;
		if (vi >= 0 && newWindowSet.has(vi)) {
			result[i] = vi;
			assignedRows.add(vi);
		} else {
			result[i] = -1;
			freeSlotIndices.push(i);
		}
	}
	for (let i = slotCount; i < n; i++) {
		result[i] = -1;
		freeSlotIndices.push(i);
	}

	let freeIdx = 0;
	for (const row of newWindowRows) {
		if (!assignedRows.has(row)) {
			result[freeSlotIndices[freeIdx++]] = row;
		}
	}

	return result;
}
