import { describe, it, expect } from 'vitest';
import { computeStableSlotRows } from './stableSlotAssigner.js';
import type { RowSlotPool } from './rowSlotPool.js';

function makePool(visualIndices: number[]): RowSlotPool<unknown> {
	const slots = visualIndices.map((vi) => ({ visualIndex: vi }));
	return {
		get count() {
			return slots.length;
		},
		getSlot(i: number) {
			return slots[i] as any;
		},
	} as unknown as RowSlotPool<unknown>;
}

describe('computeStableSlotRows', () => {
	it('keeps stable rows in their current slot', () => {
		// Pool has slots bound to rows 0, 1, 2. New window = same rows.
		const pool = makePool([0, 1, 2]);
		const result = computeStableSlotRows([0, 1, 2], pool);
		expect(result).toEqual([0, 1, 2]);
	});

	it('assigns entering rows to freed slots', () => {
		// Pool: slots bound to rows 0, 1, 2. New window: rows 1, 2, 3 (row 3 enters, row 0 exits).
		const pool = makePool([0, 1, 2]);
		const result = computeStableSlotRows([1, 2, 3], pool);
		// Slot 0 (was row 0) gets reassigned to row 3.
		// Slots 1 and 2 keep rows 1 and 2.
		expect(result[1]).toBe(1); // stable
		expect(result[2]).toBe(2); // stable
		expect(result[0]).toBe(3); // entering row assigned to freed slot
	});

	it('handles pool growth when new window is larger', () => {
		// Pool has 2 slots, new window has 4 rows.
		const pool = makePool([0, 1]);
		const result = computeStableSlotRows([0, 1, 2, 3], pool);
		expect(result[0]).toBe(0); // stable
		expect(result[1]).toBe(1); // stable
		// New slots get the entering rows
		expect(new Set(result)).toContain(2);
		expect(new Set(result)).toContain(3);
	});

	it('handles empty pool (initial render)', () => {
		const pool = makePool([]);
		const result = computeStableSlotRows([0, 1, 2], pool);
		expect(result.length).toBe(3);
		expect(new Set(result)).toEqual(new Set([0, 1, 2]));
	});

	it('handles empty new window (all rows exit)', () => {
		const pool = makePool([0, 1, 2]);
		const result = computeStableSlotRows([], pool);
		expect(result).toEqual([]);
	});

	it('each new-window row appears exactly once', () => {
		const pool = makePool([5, 6, 7, 8]);
		const newWindow = [6, 7, 9, 10];
		const result = computeStableSlotRows(newWindow, pool);
		expect(result.length).toBe(4);
		expect(new Set(result)).toEqual(new Set([6, 7, 9, 10]));
	});
});
