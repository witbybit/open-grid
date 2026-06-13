// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController } from './rowModel.js';

interface Row {
	id: string;
	name: string;
}

function rows(n: number): Row[] {
	return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
}

/**
 * End-to-end consistency guard (Plan 041): because the pipeline slices BEFORE building
 * the visual-row view, `getVisualRowCount()`/`getVisualRow()` return the page view — and
 * geometry, the render window, sticky groups, and selection all read exactly those, so
 * they are page-consistent without any slicing of their own.
 */
describe('client pagination — row model integration', () => {
	it('exposes only the current page through the visual-row view', () => {
		const store = new GridStore<Row>({
			getRowId: (r) => r.id,
			columns: [{ field: 'name', header: 'Name' }],
			defaultRowHeight: 40,
			pagination: { pageSize: 5 },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: rows(23), columns: store.getState().columns });

		expect(ctrl.getVisualRowCount()).toBe(5);
		expect(ctrl.getVisualRow(0)?.kind === 'data' && (ctrl.getVisualRow(0) as { rowId: string }).rowId).toBe('r0');
		expect(ctrl.getPageWindow?.()).toMatchObject({ page: 0, pageCount: 5, totalRows: 23 });

		ctrl.dispose();
		store.destroy();
	});

	it('re-slices to the requested page on refresh', () => {
		const store = new GridStore<Row>({
			getRowId: (r) => r.id,
			columns: [{ field: 'name', header: 'Name' }],
			defaultRowHeight: 40,
			pagination: { pageSize: 5 },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: rows(23), columns: store.getState().columns });

		store.setState({ pagination: { pageSize: 5, page: 2 } });
		ctrl.refresh('flatten');

		expect(ctrl.getVisualRowCount()).toBe(5);
		expect((ctrl.getVisualRow(0) as { rowId: string }).rowId).toBe('r10');
		expect(ctrl.getPageWindow?.()).toMatchObject({ page: 2, startIndex: 10, endIndex: 15 });

		ctrl.dispose();
		store.destroy();
	});

	it('shows the full list (no page window) when pagination is not configured', () => {
		const store = new GridStore<Row>({
			getRowId: (r) => r.id,
			columns: [{ field: 'name', header: 'Name' }],
			defaultRowHeight: 40,
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: rows(23), columns: store.getState().columns });

		expect(ctrl.getVisualRowCount()).toBe(23);
		expect(ctrl.getPageWindow?.()).toBeNull();

		ctrl.dispose();
		store.destroy();
	});

	it('clamps the page and the visible slice when the last page is partial', () => {
		const store = new GridStore<Row>({
			getRowId: (r) => r.id,
			columns: [{ field: 'name', header: 'Name' }],
			defaultRowHeight: 40,
			pagination: { pageSize: 5 },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), { rows: rows(23), columns: store.getState().columns });

		store.setState({ pagination: { pageSize: 5, page: 4 } }); // last page: rows 20..22 (3 rows)
		ctrl.refresh('flatten');

		expect(ctrl.getVisualRowCount()).toBe(3);
		expect((ctrl.getVisualRow(0) as { rowId: string }).rowId).toBe('r20');

		ctrl.dispose();
		store.destroy();
	});
});
