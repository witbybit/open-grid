import { describe, expect, it } from 'vitest';
import { asVisualRowId } from '../rows/RowId.js';
import { RowSlotPool } from './SlotModel.js';

const v = (s: string) => asVisualRowId(s);

describe('RowSlotPool — slot reuse on scroll (ARCHITECTURE.md §3 R13)', () => {
	it('assigns one slot per visible row on first sync', () => {
		const pool = new RowSlotPool();
		const result = pool.sync([v('a'), v('b'), v('c')]);
		expect(result.assignments.size).toBe(3);
		expect(result.rebound).toHaveLength(3);
		expect(pool.size).toBe(3);
	});

	it('keeps slots for rows still visible and reuses freed slots for incoming rows', () => {
		const pool = new RowSlotPool();
		pool.sync([v('a'), v('b'), v('c')]);
		const slotForB = pool.sync([v('b'), v('c'), v('d')]); // a leaves, d enters

		// b and c keep their original slots (not rebound)
		expect(slotForB.rebound).toHaveLength(1); // only d is freshly bound
		expect(slotForB.released).toHaveLength(0); // a's slot was reused for d in the same sync
		// pool did not grow — d reused a's freed slot
		expect(pool.size).toBe(3);
		expect(slotForB.assignments.size).toBe(3);
	});

	it('frees slots when the window shrinks', () => {
		const pool = new RowSlotPool();
		pool.sync([v('a'), v('b'), v('c')]);
		const shrink = pool.sync([v('b')]);
		expect(shrink.released).toHaveLength(2); // a and c freed
		expect(pool.size).toBe(3); // pool retains its high-water mark
	});
});
