import { describe, expect, it } from 'vitest';
import { sortDirtyCellsForRepair } from './rowRenderMaintenance.js';

function makeDirtyCell(rowIndex: number, colIndex: number, cellInstanceId: string): HTMLDivElement {
	const cell = {} as HTMLDivElement & { __cellSlot: { rowIndex: number; colIndex: number; cellInstanceId: string } };
	cell.__cellSlot = { rowIndex, colIndex, cellInstanceId };
	return cell;
}

describe('sortDirtyCellsForRepair', () => {
	it('uses foveal priority and stable physical identity instead of Set insertion order', () => {
		const distant = makeDirtyCell(12, 4, 'distant');
		const sameRowLaterColumn = makeDirtyCell(4, 2, 'later-column');
		const sameRowEarlierColumn = makeDirtyCell(4, 1, 'earlier-column');
		const focused = makeDirtyCell(9, 9, 'focused');
		const cells = [distant, sameRowLaterColumn, focused, sameRowEarlierColumn];

		sortDirtyCellsForRepair(cells, (cell) => (cell === focused ? 5 : cell === distant ? 2 : 4));

		expect(cells).toEqual([focused, sameRowEarlierColumn, sameRowLaterColumn, distant]);
	});

	it('has a deterministic final tie-break when row and column identities match', () => {
		const later = makeDirtyCell(4, 1, 'slot-b');
		const earlier = makeDirtyCell(4, 1, 'slot-a');
		const cells = [later, earlier];

		sortDirtyCellsForRepair(cells, () => 4);

		expect(cells).toEqual([earlier, later]);
	});
});
