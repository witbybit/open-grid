import { describe, expect, it } from 'vitest';

import { RowNode, type VisualRow } from '../store.js';
import { SelectionModel } from './SelectionModel.js';
import { createMinimalRowModel } from '../testUtils/createMinimalRowModel.js';

describe('SelectionModel', () => {
	it('describes focus and range invalidation without treating full-width rows as cells', () => {
		const model = new SelectionModel();
		const rowOne = new RowNode('r1', { id: 'r1', name: 'One' });
		const visualRows: VisualRow<{ id: string; name: string }>[] = [
			{ kind: 'data', id: 'row:r1', rowId: 'r1', node: rowOne, depth: 0 },
			{ kind: 'detail', id: 'detail:r1', parentId: 'r1', depth: 0, height: 40, render: null },
		];
		const rowModel = createMinimalRowModel({
			visualRows,
			getRowNodeById: (id) => (id === 'r1' ? rowOne : null),
			getRawRowById: (id) => (id === 'r1' ? rowOne.data : null),
		});

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

	it('keeps duplicate-field invalidated cells distinct by columnInstanceId', () => {
		const model = new SelectionModel();
		const prev = {
			focus: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
			anchor: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
			range: {
				start: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
				end: { rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
			},
			bounds: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
			source: 'keyboard' as const,
			focusOrigin: 'keyboard' as const,
			version: 1,
		};
		const next = {
			focus: { rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' },
			anchor: { rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' },
			range: {
				start: { rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' },
				end: { rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' },
			},
			bounds: { minRow: 0, maxRow: 0, minCol: 1, maxCol: 1 },
			source: 'keyboard' as const,
			focusOrigin: 'keyboard' as const,
			version: 2,
		};

		const result = model.describeChange(prev, next, null, []);

		expect(result.invalidatedCells).toEqual([
			{ rowId: 'r1', colField: 'name', colId: 'name-a', columnInstanceId: 'name-a' },
			{ rowId: 'r1', colField: 'name', colId: 'name-b', columnInstanceId: 'name-b' },
		]);
		expect(result.invalidatedRows).toEqual(['r1']);
		expect(result.overlayChanged).toBe(true);
	});
});
