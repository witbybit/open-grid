import { describe, expect, it } from 'vitest';
import { createCellAddress } from '../domains/cells/CellAddress.js';
import { asColumnId } from '../domains/columns/ColumnId.js';
import { asRowId } from '../domains/rows/RowId.js';
import type { SortModel } from '../domains/pipeline/PipelineModels.js';
import { createGrid } from './GridApiFacade.js';

interface Person {
	id: string;
	name: string;
	age: number;
}

const columns = [
	{ id: 'name', field: 'name', width: 120 },
	{ id: 'age', field: 'age', width: 80 },
];

const seed: Person[] = [
	{ id: 'a', name: 'Ann', age: 30 },
	{ id: 'b', name: 'Bob', age: 25 },
	{ id: 'c', name: 'Cyd', age: 40 },
];

function grid() {
	const api = createGrid<Person>({ columns, getRowId: (r) => r.id, rowHeight: 40 });
	api.rows.replace(seed);
	api.view.setViewport(0, 0, 400, 1000);
	return api;
}

describe('createGrid — public command-backed API (ARCHITECTURE.md Public API Direction)', () => {
	it('replace populates the visual model and render plan', () => {
		const api = grid();
		expect(api.rows.getRowCount()).toBe(3);
		expect(api.view.getVisualRowCount()).toBe(3);
		const plan = api.view.getRenderPlan();
		expect(plan.rows.map((r) => String(r.rowId))).toEqual(['a', 'b', 'c']);
		expect(plan.rows[0]!.cells.find((c) => String(c.columnId) === 'name')?.value).toBe('Ann');
	});

	it('cells.setValue writes through the kernel and is reflected in getValue and the plan', () => {
		const api = grid();
		const addr = createCellAddress(asRowId('a'), asColumnId('name'), 'name');
		const result = api.cells.setValue(addr, 'Anna');
		expect(result.status).toBe('applied');
		expect(api.cells.getValue(addr)).toBe('Anna');
		expect(api.view.getRenderPlan().rows[0]!.cells[0]!.value).toBe('Anna');
	});

	it('pipeline.setSortModel reorders the visual model seen via the render plan', () => {
		const api = grid();
		const ageAsc: SortModel = [{ columnId: asColumnId('age'), field: 'age', direction: 'asc' }];
		api.pipeline.setSortModel(ageAsc);
		expect(api.view.getRenderPlan().rows.map((r) => String(r.rowId))).toEqual(['b', 'a', 'c']);
	});

	it('editing flow writes through the cell engine and undo reverts it', () => {
		const api = grid();
		const addr = createCellAddress(asRowId('b'), asColumnId('name'), 'name');
		api.editing.start(addr);
		api.editing.updateDraft('Bobby');
		expect(api.editing.commit().status).toBe('applied');
		expect(api.cells.getValue(addr)).toBe('Bobby');

		expect(api.canUndo()).toBe(true);
		api.undo();
		expect(api.cells.getValue(addr)).toBe('Bob');
	});

	it('selection routes through the facade', () => {
		const api = grid();
		api.selection.selectRows([asRowId('a'), asRowId('c')]);
		expect(api.selection.getState().selectedRowIds.size).toBe(2);
		api.selection.clear();
		expect(api.selection.getState().selectedRowIds.size).toBe(0);
	});

	it('columns.resize/move route through the facade and update getState', () => {
		const api = grid();
		expect(api.columns.resize(asColumnId('name'), 200).status).toBe('applied');
		expect(api.columns.getState().find((s) => String(s.columnId) === 'name')?.width).toBe(200);
		expect(api.columns.move(asColumnId('age'), 0).status).toBe('applied');
		expect(api.columns.getState()[0]!.columnId).toBe(asColumnId('age'));
	});

	it('rowModel type is fixed and capabilities are honest', () => {
		const api = grid();
		expect(api.rowModel.getType()).toBe('client');
		expect(api.rowModel.getCapabilities().transactions).toBe(true);
	});

	it('an unsupported op on a server grid is rejected through the facade', () => {
		const api = createGrid<Person>({ rowModelType: 'server', columns, getRowId: (r) => r.id });
		const result = api.rows.applyTransaction({ add: [{ id: 'x', name: 'X', age: 1 }] });
		expect(result.status).toBe('rejected');
	});
});
