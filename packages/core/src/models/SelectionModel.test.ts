import { describe, expect, it } from 'vitest';

import { RowNode, type RowModel, type RowModelRefreshResult, type VisualRow } from '../store.js';
import { SelectionModel } from './SelectionModel.js';

describe('SelectionModel', () => {
	it('describes focus and range invalidation without treating full-width rows as cells', () => {
		const model = new SelectionModel();
		const rowOne = new RowNode('r1', { id: 'r1', name: 'One' });
		const visualRows: VisualRow<{ id: string; name: string }>[] = [
			{ kind: 'data', id: 'row:r1', rowId: 'r1', node: rowOne, depth: 0 },
			{ kind: 'detail', id: 'detail:r1', parentId: 'r1', depth: 0, height: 40, render: null },
		];
		const rowModel: RowModel<{ id: string; name: string }> = {
			getVisualRow: (index) => visualRows[index] ?? null,
			getVisualRowCount: () => visualRows.length,
			getVisualRowIndexById: (id) => visualRows.findIndex((row) => row.id === id || (row.kind === 'data' && row.rowId === id)),
			getVisualIndexById: (id) => visualRows.findIndex((row) => row.id === id),
			getVisualIndexByRowId: (id) => visualRows.findIndex((row) => row.kind === 'data' && row.rowId === id),
			getRowNodeById: (id) => (id === 'r1' ? rowOne : null),
			getRawRowById: (id) => (id === 'r1' ? rowOne.data : null),
			refresh: (): RowModelRefreshResult => ({ changed: false }),
		};

		const prev = {
			focus: null,
			anchor: null,
			range: null,
			bounds: null,
			source: 'program' as const,
		};
		const next = {
			focus: { rowId: 'r1', colField: 'name' },
			anchor: { rowId: 'r1', colField: 'name' },
			range: { start: { rowId: 'r1', colField: 'name' }, end: { rowId: 'r1', colField: 'name' } },
			bounds: { minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 },
			source: 'keyboard' as const,
		};

		const result = model.describeChange(prev, next, rowModel, [{ field: 'name', header: 'Name' }]);

		expect(result.invalidatedCells).toEqual([{ rowId: 'r1', colField: 'name' }]);
		expect(result.invalidatedRows).toEqual(['r1', 'detail:r1']);
		expect(result.overlayChanged).toBe(true);
	});
});
