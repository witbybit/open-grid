import { describe, expect, it } from 'vitest';
import { asColumnId } from '../domains/columns/ColumnId.js';
import { asRowId } from '../domains/rows/RowId.js';
import { GridCore } from './GridCore.js';

interface Person {
	id: string;
	name: string;
	age: number;
}

const columns = [
	{ id: 'name', field: 'name', width: 120, header: 'Name' },
	{ id: 'age', field: 'age', width: 80, header: 'Age' },
];

const seed: Person[] = [
	{ id: 'a', name: 'Ann', age: 30 },
	{ id: 'b', name: 'Bob', age: 25 },
	{ id: 'c', name: 'Cyd', age: 40 },
];

function core() {
	const c = new GridCore<Person>({ columns, getRowId: (r) => r.id, rowHeight: 40 });
	c.kernel.dispatch({ type: 'rows.replace', payload: { rows: seed } });
	c.viewport.setScroll(0, 0);
	c.viewport.setSize(400, 1000);
	return c;
}

describe('GridCore.getRendererView — clean renderer contract (ARCHITECTURE.md §3 R12)', () => {
	it('exposes structure: visual row count + rows by index', () => {
		const view = core().getRendererView();
		expect(view.getVisualRowCount()).toBe(3);
		const row = view.getVisualRow(0)!;
		expect(row.kind).toBe('data');
		expect(row.kind === 'data' && String(row.rowId)).toBe('a');
	});

	it('exposes geometry: row tops/heights, column lanes, totals', () => {
		const geo = core().getRendererView().getGeometry();
		expect(geo.rowCount).toBe(3);
		expect(geo.getRowTop(2)).toBe(80);
		expect(geo.getRowHeight(0)).toBe(40);
		expect(geo.totalWidth).toBe(200);
		expect(geo.columns.entries.map((e) => String(e.columnId))).toEqual(['name', 'age']);
	});

	it('exposes columns with header text + live sort direction', () => {
		const c = core();
		const view = c.getRendererView();
		expect(view.getColumns().map((col) => col.header)).toEqual(['Name', 'Age']);
		expect(view.getColumns()[0]!.sortDirection).toBeNull();
		c.kernel.dispatch({ type: 'pipeline.setSortModel', payload: { model: [{ columnId: asColumnId('name'), field: 'name', direction: 'asc' }] } });
		expect(view.getColumns().find((col) => String(col.columnId) === 'name')!.sortDirection).toBe('asc');
	});

	it('exposes viewport + visible window + display values + selection read', () => {
		const c = core();
		const view = c.getRendererView();
		expect(view.getViewport()).toMatchObject({ width: 400, height: 1000 });
		expect(view.getVisibleWindow().firstIndex).toBe(0);
		expect(view.getCellDisplayValue(asRowId('b'), 'name')).toBe('Bob');
		expect(view.isRowSelected(asRowId('b'))).toBe(false);
		c.kernel.dispatch({ type: 'selection.selectRows', payload: { rowIds: [asRowId('b')] } });
		expect(view.isRowSelected(asRowId('b'))).toBe(true);
	});

	it('exposes a change signal: subscribe fires on commits, versions advance', () => {
		const c = core();
		const view = c.getRendererView();
		let events = 0;
		const off = view.subscribe(() => events++);
		const before = view.getVersion('pipeline');
		c.kernel.dispatch({ type: 'pipeline.setFilterModel', payload: { model: [{ columnId: asColumnId('age'), field: 'age', predicate: (v) => Number(v) >= 30 }] } });
		expect(events).toBeGreaterThan(0);
		expect(view.getVersion('pipeline')).toBeGreaterThan(before);
		expect(view.getVisualRowCount()).toBe(2); // Bob (25) filtered out
		off();
	});
});
