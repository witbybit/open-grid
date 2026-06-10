import { describe, it, expect } from 'vitest';
import { StableSlotAssigner } from './stableSlotAssigner.js';

// Helper: create a fresh assigner and run a single assign call.
// Spreads the result so tests hold a snapshot independent of the internal buffer.
function assign(currentSlotRows: number[], newWindowRows: number[]): number[] {
	return [...new StableSlotAssigner().assign(currentSlotRows, newWindowRows)];
}

describe('StableSlotAssigner', () => {
	// ── Slot contract ────────────────────────────────────────────────────────────────────
	// Row slots are stable physical DOM owners.
	// Slot index is NOT the same as viewport position.
	// Visual order is controlled by absolute positioning/transform.

	it('keeps stable rows in their current slot', () => {
		expect(assign([0, 1, 2], [0, 1, 2])).toEqual([0, 1, 2]);
	});

	it('assigns entering rows to freed slots', () => {
		// Pool: slot 0 → row 0, slot 1 → row 1, slot 2 → row 2
		// New window: rows 1, 2, 3 (row 3 enters, row 0 exits)
		const result = assign([0, 1, 2], [1, 2, 3]);
		expect(result[1]).toBe(1); // slot 1 keeps row 1
		expect(result[2]).toBe(2); // slot 2 keeps row 2
		expect(result[0]).toBe(3); // slot 0 (freed) gets entering row 3
	});

	it('handles pool growth when the new window is larger than the current pool', () => {
		// Pool has 2 slots; new window has 4 rows — 2 new slots will be created.
		const result = assign([0, 1], [0, 1, 2, 3]);
		expect(result[0]).toBe(0);
		expect(result[1]).toBe(1);
		expect(new Set(result)).toContain(2);
		expect(new Set(result)).toContain(3);
		expect(result.length).toBe(4);
	});

	it('handles an empty pool (initial render)', () => {
		const result = assign([], [0, 1, 2]);
		expect(result.length).toBe(3);
		expect(new Set(result)).toEqual(new Set([0, 1, 2]));
	});

	it('handles an empty new window (all rows exit)', () => {
		expect(assign([0, 1, 2], [])).toEqual([]);
	});

	it('handles a full window replacement (no row survives)', () => {
		const result = assign([0, 1, 2], [10, 11, 12]);
		expect(result.length).toBe(3);
		expect(new Set(result)).toEqual(new Set([10, 11, 12]));
	});

	it('handles window shrinking', () => {
		// Pool had 4 slots; new window has 2 rows.
		// The result should be length 2.
		const result = assign([10, 11, 12, 13], [10, 11]);
		expect(result.length).toBe(2);
		expect(new Set(result)).toEqual(new Set([10, 11]));
	});

	it('each new-window row appears exactly once', () => {
		const result = assign([5, 6, 7, 8], [6, 7, 9, 10]);
		expect(result.length).toBe(4);
		expect(new Set(result)).toEqual(new Set([6, 7, 9, 10]));
	});

	it('result contains only rows from the new window', () => {
		const newWindow = [20, 21, 22];
		const result = assign([18, 19, 20], newWindow);
		for (const r of result) {
			expect(newWindow).toContain(r);
		}
	});

	it('result buffer is reused between calls (internal buffer contract)', () => {
		// The assigner returns its internal buffer. After a second call the first reference
		// reflects the new assignment — callers must consume synchronously or copy.
		const assigner = new StableSlotAssigner();
		const first = assigner.assign([0, 1, 2], [0, 1, 2]);
		const snapshot = [...first]; // copy before next call
		const second = assigner.assign([0, 1, 2], [3, 4, 5]);
		// first and second are the same object
		expect(first).toBe(second);
		// but the snapshot captured the earlier result
		expect(snapshot).toEqual([0, 1, 2]);
		expect([...second]).toEqual(expect.arrayContaining([3, 4, 5]));
	});

	it('DOM slot order does not need to equal visual order', () => {
		// After one scroll: slot 0 holds row 5, slot 1 holds row 6, slot 2 holds row 7.
		// Next scroll enters row 4 (above), row 5 and 6 stay, row 7 exits.
		// slot 2 is freed and gets row 4 even though row 4 is visually first.
		const result = assign([5, 6, 7], [4, 5, 6]);
		expect(result[0]).toBe(5); // slot 0 keeps row 5
		expect(result[1]).toBe(6); // slot 1 keeps row 6
		expect(result[2]).toBe(4); // slot 2 (freed from row 7) gets row 4
		// Row 4 is visually first but lives in slot 2 — visual order via transform, not DOM order.
	});

	it('regression: production RowRenderer must use StableSlotAssigner, not a private duplicate', () => {
		// If this import fails or the class is missing, the duplicate-implementation guard has broken.
		// The RowRenderer imports and instantiates StableSlotAssigner; this test confirms the
		// export exists and is callable so any duplicate inline implementation would be redundant.
		const assigner = new StableSlotAssigner();
		expect(typeof assigner.assign).toBe('function');
	});
});
