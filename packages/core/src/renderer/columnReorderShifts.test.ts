import { describe, it, expect } from 'vitest';
import { computeColumnReorderShifts } from './columnInteractionController.js';

/**
 * Plan 047 — live column-reorder preview. The shift for each column must equal the
 * delta between its current left and its left AFTER the move, so the previewed
 * position is exactly the post-`moveColumn` position (seamless drop, no FLIP).
 */
describe('computeColumnReorderShifts', () => {
	const widths = [100, 100, 100, 100, 100];

	it('moves a column right: displaced columns slide left by the dragged width', () => {
		// drag col 0 to gap 3 → toIndex 2; new order [1,2,0,3,4]
		expect(computeColumnReorderShifts(widths, 0, 3, 0, 0)).toEqual([200, -100, -100, 0, 0]);
	});

	it('moves a column left: displaced columns slide right by the dragged width', () => {
		// drag col 4 to gap 1 → toIndex 1; new order [0,4,1,2,3]
		expect(computeColumnReorderShifts(widths, 4, 1, 0, 0)).toEqual([0, 100, 100, 100, -300]);
	});

	it('returns all-zero shifts for a no-op drop (gap maps to the same index)', () => {
		expect(computeColumnReorderShifts(widths, 2, 2, 0, 0)).toEqual([0, 0, 0, 0, 0]);
		expect(computeColumnReorderShifts(widths, 2, 3, 0, 0)).toEqual([0, 0, 0, 0, 0]);
	});

	it('handles uneven column widths via prefix sums', () => {
		const uneven = [50, 200, 80];
		// drag col 0 to gap 3 → toIndex 2; new order [1,2,0]
		// col0: 0 → (200+80)=280 → +280; col1: 50 → 0 → -50; col2: 250 → 200 → -50
		expect(computeColumnReorderShifts(uneven, 0, 3, 0, 0)).toEqual([280, -50, -50]);
	});

	it('previews only within the center lane (pinned columns never shift)', () => {
		// pinLeft 1, pinRight 1 → center is [1,2,3]; drag col 1 to gap 3 → toIndex 2
		expect(computeColumnReorderShifts(widths, 1, 3, 1, 1)).toEqual([0, 100, -100, 0, 0]);
	});

	it('returns all-zero shifts when the dragged column is pinned', () => {
		expect(computeColumnReorderShifts(widths, 0, 3, 1, 1)).toEqual([0, 0, 0, 0, 0]);
	});

	it('clamps the insertion gap into the center lane', () => {
		// drag center col 1, gap past the right pin (5) clamps to centerEnd (4) → toIndex 3
		// new center order [2,3,1]; col1: 0→200 (+200), col2: 100→0 (-100), col3: 200→100 (-100)
		expect(computeColumnReorderShifts(widths, 1, 5, 1, 1)).toEqual([0, 200, -100, -100, 0]);
	});

	it('returns an all-zero array of the right length for empty / single-column grids', () => {
		expect(computeColumnReorderShifts([], 0, 0, 0, 0)).toEqual([]);
		expect(computeColumnReorderShifts([100], 0, 1, 0, 0)).toEqual([0]);
	});
});
