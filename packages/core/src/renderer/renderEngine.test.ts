// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import { RenderEngine } from './renderEngine.js';

describe('RenderEngine', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
	});

	it('syncs state-driven paints from the real scroll viewport position', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 60 }, (_, index) => ({
			id: `row-${index}`,
			name: `Row ${index}`,
		}));
		const controller = new ClientRowModelController(store, {
			rows,
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 0;
		store.engine.viewport.setScrollPosition(900, 0);

		renderer.fullPaint();

		expect(store.engine.viewport.scrollTop).toBe(0);
		expect(container.querySelector('[data-row-index="0"]')).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('releases out-of-range cells when columns shrink with right pinning enabled', () => {
		const wideColumns = [
			{ field: 'risk', header: 'Risk', width: 120 },
			{ field: 'filler', header: 'Filler', width: 120 },
			{ field: 'col_999', header: 'Col 999', width: 120 },
		];
		const store = new GridStore<{ id: string; risk: string; filler: string; col_999: string }>({
			columns: wideColumns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: 'row-1', risk: 'LOW', filler: 'Filler', col_999: 'Val 999' }],
			columns: wideColumns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		store.setViewportPins({ right: 1 });
		renderer.mount(container);

		expect(container.querySelector('.og-cell[data-col-field="col_999"]')).not.toBeNull();

		store.setState({ columns: [{ field: 'risk', header: 'Risk', width: 120 }] });
		renderer.fullPaint();

		expect(container.querySelector('.og-cell[data-col-field="col_999"]')).toBeNull();
		expect(container.querySelector('.og-cell[data-col-field="risk"]')?.textContent).toBe('LOW');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('marks focused and selected rows from navigation state and passes row class params', () => {
		const rowClass = vi.fn((_row: { id: string; name: string }, params: { isSelected: boolean; isFocused: boolean }) =>
			params.isFocused ? 'custom-focused-row' : params.isSelected ? 'custom-selected-row' : ''
		);
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			styleSlots: { rowClass },
		});
		const controller = new ClientRowModelController(store, {
			rows: [
				{ id: 'row-1', name: 'One' },
				{ id: 'row-2', name: 'Two' },
			],
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		store.selectCell({ rowId: 'row-2', colField: 'name' });
		renderer.fullPaint();

		const selectedRow = container.querySelector('.og-row[data-row-id="row-2"]') as HTMLElement;
		expect(selectedRow.className).toContain('og-row-selected');
		expect(selectedRow.className).toContain('og-row-focused');
		expect(selectedRow.className).toContain('custom-focused-row');
		expect(rowClass).toHaveBeenCalledWith(
			{ id: 'row-2', name: 'Two' },
			expect.objectContaining({
				rowId: 'row-2',
				rowIndex: 1,
				isFocused: true,
				isSelected: true,
			})
		);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not steal focus from custom editor descendants during focused cell paints', () => {
		const columns = [{ field: 'status', header: 'Status', width: 120, cellEditor: () => null }];
		const store = new GridStore<{ id: string; status: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: 'row-1', status: 'Active' }],
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.onMountCellContent = ({ container: portalHost }) => {
			if (!portalHost.querySelector('[data-custom-editor-root]')) {
				const customEditorRoot = document.createElement('div');
				customEditorRoot.dataset.customEditorRoot = 'true';
				customEditorRoot.tabIndex = 0;
				portalHost.appendChild(customEditorRoot);
			}
		};
		renderer.mount(container);

		store.selectCell({ rowId: 'row-1', colField: 'status' });
		store.setState({ activeEdit: { rowId: 'row-1', colField: 'status' } });
		renderer.fullPaint();

		const cell = container.querySelector('.og-cell[data-col-field="status"]') as HTMLDivElement;
		const customEditorRoot = cell.querySelector('[data-custom-editor-root]') as HTMLDivElement;
		customEditorRoot.focus();
		const focusSpy = vi.spyOn(cell, 'focus');

		renderer.fullPaint();

		expect(focusSpy).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(customEditorRoot);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('repaints dirty cells without scheduling a full viewport paint', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: 'row-1', name: 'Before' }],
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		const fullPaintSpy = vi.spyOn(renderer, 'fullPaint');

		store.setCellValue('row-1', 'name', 'After');
		store.flushCellUpdatesSync();
		await Promise.resolve();
		await Promise.resolve();

		expect(fullPaintSpy).not.toHaveBeenCalled();
		expect(container.querySelector('.og-cell[data-col-field="name"]')?.textContent).toBe('After');

		renderer.unmount();
		controller.dispose();
	});

	it('queues cell paint invalidations on selection and activeEdit changes', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [
				{ id: 'row-1', name: 'Row 1' },
				{ id: 'row-2', name: 'Row 2' },
			],
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const queueCellPaintSpy = vi.spyOn(renderer as any, 'queueCellPaint');

		store.selectCell({ rowId: 'row-1', colField: 'name' });
		store.flushCellUpdatesSync();
		await Promise.resolve();

		expect(queueCellPaintSpy).toHaveBeenCalledWith('row-1', 'name');

		queueCellPaintSpy.mockClear();

		store.setState({ activeEdit: { rowId: 'row-1', colField: 'name' } });
		store.flushCellUpdatesSync();
		await Promise.resolve();

		expect(queueCellPaintSpy).toHaveBeenCalledWith('row-1', 'name');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('repaints fast-scroll native fallbacks once scrolling velocity settles', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'status', header: 'Status', width: 120, cellRenderer: () => {} }];
		const store = new GridStore<{ id: string; status: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, status: `Status-${i}` })),
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.onMountCellContent = ({ container: portalHost, value }) => {
			if (!portalHost.querySelector('[data-rendered-status]')) {
				const rendered = document.createElement('span');
				rendered.dataset.renderedStatus = String(value);
				rendered.textContent = `Rendered ${String(value)}`;
				portalHost.appendChild(rendered);
			}
		};
		renderer.mount(container);

		const recycleViewport = (renderer as unknown as { recycleViewport(forceAll?: boolean): void }).recycleViewport.bind(renderer);
		store.engine.viewport.setScrollPosition(1, 0, 1);
		store.engine.viewport.setScrollPosition(1200, 0, 2);
		recycleViewport(false);

		const fallbackCell = container.querySelector('.og-cell[data-col-field="status"]') as HTMLDivElement;
		expect(fallbackCell.querySelector('[data-rendered-status]')).toBeNull();
		expect(fallbackCell.textContent).toContain('Status');

		store.engine.viewport.resetVelocity();
		recycleViewport(false);

		expect(container.querySelector('[data-rendered-status]')).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('focuses the overscanned target cell during keyboard navigation so native browser scroll can reveal more rows', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 120 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 40 }, (_, index) => ({
				id: `row-${index}`,
				name: `Row ${index}`,
			})),
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const targetRowId = 'row-8';
		const targetCellField = 'name';

		document.body.focus();
		store.selectCell({ rowId: targetRowId, colField: targetCellField }, 'keyboard');

		const focusedCellElement = container.querySelector(`.og-row[data-row-id="${targetRowId}"] .og-cell[data-col-field="${targetCellField}"]`) as HTMLElement;

		console.log('focusedCellElement:', focusedCellElement);
		console.log('focusedCellElement outerHTML:', focusedCellElement.outerHTML);
		console.log('document.activeElement:', document.activeElement);

		expect(focusedCellElement).not.toBeNull();
		expect(focusedCellElement.classList.contains('og-cell-focused')).toBe(true);
		expect(store.engine.viewport.scrollTop).toBe(180);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps keyboard-focused cells out from under pinned columns during horizontal navigation', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [
			{ field: 'col-0', header: 'Col 0', width: 100 },
			{ field: 'col-1', header: 'Col 1', width: 100 },
			{ field: 'col-2', header: 'Col 2', width: 100 },
			{ field: 'col-3', header: 'Col 3', width: 100 },
			{ field: 'col-4', header: 'Col 4', width: 100 },
		];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: 'row-1', name: 'Row 1' }],
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 300,
			bottom: 220,
			width: 300,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		store.engine.viewport.pinLeftColumns = 1;
		store.engine.viewport.pinRightColumns = 1;
		store.engine.viewport.setScrollPosition(0, 0);

		store.selectCell({ rowId: 'row-1', colField: 'col-2' }, 'keyboard');

		expect(store.engine.viewport.scrollLeft).toBe(100);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps dirty-cell routing aligned and focuses the correctly rebound element after flat row model updates', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 120 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const initialRows = [
			{ id: 'row-1', name: 'Row 1' },
			{ id: 'row-2', name: 'Row 2' },
			{ id: 'row-3', name: 'Row 3' },
			{ id: 'row-4', name: 'Row 4' },
		];
		const controller = new ClientRowModelController(store, {
			rows: initialRows,
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 300,
			bottom: 160,
			width: 300,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		controller.setRows([initialRows[0], initialRows[1], initialRows[3], initialRows[2], ...initialRows.slice(4)]);
		renderer.fullPaint();

		const reboundCell = container.querySelector('.og-row[data-row-id="row-3"] .og-cell[data-col-field="name"]') as HTMLDivElement;
		const focusSpy = vi.spyOn(reboundCell, 'focus');

		store.selectCell({ rowId: 'row-3', colField: 'name' }, 'keyboard');
		renderer.fullPaint();

		expect(focusSpy).toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('cleans cell focus classes and prevents visual highlights leak during row rebinding', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 120 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const initialRows = [
			{ id: 'row-1', name: 'Row 1' },
			{ id: 'row-2', name: 'Row 2' },
		];
		const controller = new ClientRowModelController(store, {
			rows: initialRows,
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 300,
			bottom: 160,
			width: 300,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		// Select row 2 cell to give it focus classes
		store.selectCell({ rowId: 'row-2', colField: 'name' }, 'keyboard');
		renderer.fullPaint();

		const cell2 = container.querySelector('.og-row[data-row-id="row-2"] .og-cell[data-col-field="name"]') as HTMLDivElement;
		expect(cell2.classList.contains('og-cell-focused')).toBe(true);

		// Rebind row 2's index to row-3 (which is not focused)
		controller.setRows([
			{ id: 'row-1', name: 'Row 1' },
			{ id: 'row-3', name: 'Row 3' },
		]);
		renderer.fullPaint();

		// The cell element at row-3 (which reuse row 2's pooled DOM row) should not have focused classes
		const cell3 = container.querySelector('.og-row[data-row-id="row-3"] .og-cell[data-col-field="name"]') as HTMLDivElement;
		expect(cell3.classList.contains('og-cell-focused')).toBe(false);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});
});

