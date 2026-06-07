// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type RowModel, type VisualRow, type RowModelRefreshResult } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { ServerRowModelController } from '../serverRowModel.js';

describe('RenderEngine', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
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

	it('positions right-pinned body cells with scroll-adjusted absolute offsets', () => {
		const columns = [
			{ field: 'a', header: 'A', width: 100 },
			{ field: 'b', header: 'B', width: 110 },
			{ field: 'c', header: 'C', width: 120 },
			{ field: 'd', header: 'D', width: 130 },
			{ field: 'e', header: 'E', width: 140 },
		];
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: 'row-1', a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' }],
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
		store.setViewportPins({ right: 2 });
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollLeft = 100;
		renderer.fullPaint();

		const row = container.querySelector('.og-row[data-row-id="row:row-1"]') as HTMLDivElement;
		const dCell = row.querySelector('.og-cell[data-col-field="d"]') as HTMLDivElement;
		const eCell = row.querySelector('.og-cell[data-col-field="e"]') as HTMLDivElement;
		const rightHeaderLayer = container.querySelector('.og-layer-header-right') as HTMLDivElement;
		const eHeader = container.querySelector('.og-header-cell[data-col-field="e"]') as HTMLDivElement;

		expect(row.querySelector('.og-row-pin-right')).toBeNull();
		expect(dCell.parentElement).toBe(row);
		expect(eCell.parentElement).toBe(row);
		expect(dCell.className).toContain('og-cell-pinned-right');
		expect(eCell.className).toContain('og-cell-pinned-right');
		expect(dCell.style.position).toBe('');
		expect(eCell.style.position).toBe('');
		expect(dCell.style.left).toBe('330px');
		expect(eCell.style.left).toBe('460px');
		expect(dCell.style.right).toBe('');
		expect(eCell.style.right).toBe('');
		expect(rightHeaderLayer.style.left).toBe('330px');
		expect(rightHeaderLayer.style.width).toBe('270px');
		expect(eHeader.parentElement).toBe(rightHeaderLayer);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not render hidden columns in headers or cells', () => {
		const columns = [
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'name', header: 'Name', width: 120, hide: true },
			{ field: 'price', header: 'Price', width: 120 },
		];
		const store = new GridStore<{ id: string; name: string; price: number }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: 'row-1', name: 'Hidden Name', price: 42 }],
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

		expect(container.querySelector('.og-cell[data-col-field="name"]')).toBeNull();
		expect(container.querySelector('.og-header-cell[data-col-field="name"]')).toBeNull();
		expect(container.querySelector('.og-cell[data-col-field="price"]')?.textContent).toBe('42');

		store.setColumnVisible('name', true);
		renderer.fullPaint();

		expect(container.querySelector('.og-cell[data-col-field="name"]')?.textContent).toBe('Hidden Name');
		expect(container.querySelector('.og-header-cell[data-col-field="name"]')?.textContent).toContain('Name');

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

		const selectedRow = container.querySelector('.og-row[data-row-id="row:row-2"]') as HTMLElement;
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
		store.destroy();
	});

	it('repaints invalidated cells for row ids containing colons', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string; status: string }>({
			columns: [
				{ field: 'name', header: 'Name', width: 120 },
				{ field: 'status', header: 'Status', width: 120 },
			],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [
				{ id: 'row:0', name: 'Before', status: 'Open' },
				{ id: 'row:1', name: 'Other', status: 'Closed' },
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
		renderer.resetRenderStats();

		store.setCellValue('row:0', 'name', 'After');
		store.flushCellUpdatesSync();
		await Promise.resolve();
		await Promise.resolve();

		const visibleNames = Array.from(container.querySelectorAll<HTMLDivElement>('.og-cell[data-col-field="name"]')).map((cell) => ({
			rowId: (cell.closest('.og-row') as HTMLElement | null)?.dataset.rowId,
			text: cell.textContent,
		}));
		expect(visibleNames).toContainEqual({ rowId: 'row:row%3A0', text: 'After' });
		expect(visibleNames).toContainEqual({ rowId: 'row:row%3A1', text: 'Other' });
		expect(renderer.getRenderStats().cellPaints).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('renders loading visual rows as skeleton cells without fake data rows', () => {
		const columns = [{ field: 'name', header: 'Name', width: 120 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const loadingRow: VisualRow<{ id: string; name: string }> = {
			kind: 'loading',
			id: 'loading:0',
			rowIndex: 0,
			editable: false,
		};
		const rowModel: RowModel<{ id: string; name: string }> = {
			getVisualRow: (index) => (index === 0 ? loadingRow : null),
			getVisualRowCount: () => 1,
			getVisualRowIndexById: (id) => (id === loadingRow.id ? 0 : -1),
			getVisualIndexById: (id) => (id === loadingRow.id ? 0 : -1),
			getVisualIndexByRowId: () => -1,
			getRowNodeById: () => null,
			getRawRowById: () => null,
			refresh: (): RowModelRefreshResult => ({ changed: false }),
		};

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
		store.registerRowModel(rowModel);
		renderer.mount(container);

		const row = container.querySelector('.og-row[data-row-id="loading:0"]') as HTMLDivElement;
		const cell = container.querySelector('.og-cell[data-col-field="name"]') as HTMLDivElement;

		expect(row.className).toContain('og-row-loading');
		expect(cell.className).toContain('og-cell-loading');
		expect(cell.dataset.contentMode).toBe('loading');
		expect(cell.querySelector('.og-cell-loading-skeleton')).toBeNull();

		renderer.unmount();
		store.destroy();
	});

	it('records granular invalidation stats for cell edit and focus movement', async () => {
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

		const before = renderer.getRenderStats();
		store.setCellValue('row-1', 'name', 'After');
		store.flushCellUpdatesSync();
		await Promise.resolve();
		await Promise.resolve();

		const afterEdit = renderer.getRenderStats();
		expect(afterEdit.fullPaints - before.fullPaints).toBe(0);
		expect(afterEdit.cellPaints - before.cellPaints).toBe(1);

		store.selectCell({ rowId: 'row-1', colField: 'name' });
		await Promise.resolve();
		await Promise.resolve();
		const afterFirstFocus = renderer.getRenderStats();
		store.selectCell({ rowId: 'row-2', colField: 'name' });
		await Promise.resolve();
		await Promise.resolve();

		const afterFocusMove = renderer.getRenderStats();
		expect(afterFocusMove.fullPaints - afterFirstFocus.fullPaints).toBe(0);
		expect(afterFocusMove.cellPaints - afterFirstFocus.cellPaints).toBe(2);
		expect(afterFocusMove.overlayPaints).toBeGreaterThan(afterFirstFocus.overlayPaints);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('automatically scrolls cell into view when focus changes from non-pointer source', async () => {
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
			rows: Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 240,
			width: 500,
			height: 240,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		expect(scrollViewport.scrollTop).toBe(0);

		// Focus row-15 (index 15), which is far below the viewport (only 5 rows fit)
		// Selection source is 'keyboard'
		store.selectCell({ rowId: 'row-15', colField: 'name' }, 'keyboard');
		await Promise.resolve();
		await Promise.resolve();

		console.log('FOCUS STATE:', store.getState().selection.focus);
		console.log('ROW HEIGHTS:', store.engine.geometry.rowHeights.slice(0, 20));
		console.log('ROW TOPS:', store.engine.geometry.rowTops.slice(0, 20));
		console.log('VIEWPORT HEIGHT:', store.engine.viewport.viewportHeight);

		expect(store.getState().selection.focus).toEqual({ rowId: 'row-15', colField: 'name' });
		expect(store.engine.viewport.scrollTop).toBe(440);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not duplicate cell invalidation through the render event listener', async () => {
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
			rows: [{ id: 'row-1', name: 'One' }],
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
		const invalidateCell = vi.spyOn(store.engine.invalidation, 'invalidateCell');
		const invalidateRow = vi.spyOn(store.engine.invalidation, 'invalidateRow');

		store.engine.notifyCellChange('row-1', 'name');
		await Promise.resolve();
		await Promise.resolve();

		expect(invalidateCell).toHaveBeenCalledTimes(1);
		expect(invalidateCell).toHaveBeenCalledWith('row-1', 'name', 'cell');
		expect(invalidateRow).toHaveBeenCalledTimes(1);
		expect(invalidateRow).toHaveBeenCalledWith('row-1', 'cell');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('records geometry invalidation without forcing a full paint for row and column resizing', async () => {
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
			rows: [{ id: 'row-1', name: 'One' }],
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

		const beforeColumn = renderer.getRenderStats();
		store.setColumnWidth('name', 180);
		await Promise.resolve();
		await Promise.resolve();
		const afterColumn = renderer.getRenderStats();
		expect(afterColumn.fullPaints - beforeColumn.fullPaints).toBe(0);
		expect(afterColumn.geometryRecomputes - beforeColumn.geometryRecomputes).toBe(1);
		expect(afterColumn.headerPaints - beforeColumn.headerPaints).toBeGreaterThan(0);

		store.setRowHeight('row:row-1', 52);
		await Promise.resolve();
		await Promise.resolve();
		const afterRow = renderer.getRenderStats();
		expect(afterRow.fullPaints - afterColumn.fullPaints).toBe(0);
		expect(afterRow.geometryRecomputes - afterColumn.geometryRecomputes).toBe(1);
		expect(afterRow.rowPaints - afterColumn.rowPaints).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('supports explicit paint scheduling without falling back to full paint', async () => {
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
			rows: [{ id: 'row-1', name: 'One' }],
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
		renderer.resetRenderStats();

		renderer.scheduleHeaderPaint('test header');
		await Promise.resolve();
		await Promise.resolve();
		const afterHeader = renderer.getRenderStats();
		expect(afterHeader.fullPaints).toBe(0);
		expect(afterHeader.headerPaints).toBe(1);

		renderer.scheduleOverlayPaint('test overlay');
		await Promise.resolve();
		await Promise.resolve();
		const afterOverlay = renderer.getRenderStats();
		expect(afterOverlay.fullPaints).toBe(0);
		expect(afterOverlay.overlayPaints).toBe(1);

		renderer.scheduleViewportPaint('test viewport');
		await Promise.resolve();
		await Promise.resolve();
		const afterViewport = renderer.getRenderStats();
		expect(afterViewport.fullPaints).toBe(0);
		expect(afterViewport.viewportPaints).toBe(1);
		expect(afterViewport.headerPaints).toBe(afterOverlay.headerPaints);
		expect(afterViewport.overlayPaints).toBe(afterOverlay.overlayPaints);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not full paint or recompute geometry for server block data updates during viewport recycling', async () => {
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
		const controller = new ServerRowModelController(store, {
			columns: store.getState().columns,
			blockSize: 50,
			datasource: {
				getRows: async ({ startRow, endRow }) => ({
					rows: Array.from({ length: endRow - startRow }, (_, index) => ({
						id: `row-${startRow + index}`,
						name: `Row ${startRow + index}`,
					})),
					totalCount: 100000,
				}),
			},
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
		await vi.waitFor(() => expect(store.getVisualRowCount()).toBe(100000));
		renderer.fullPaint();
		const before = renderer.getRenderStats();

		store.setState((state) => ({ dataVersion: state.dataVersion + 1 }));
		await Promise.resolve();
		await Promise.resolve();
		const afterData = renderer.getRenderStats();
		expect(afterData.fullPaints - before.fullPaints).toBe(0);
		expect(afterData.geometryRecomputes - before.geometryRecomputes).toBe(0);
		expect(afterData.viewportPaints - before.viewportPaints).toBe(1);
		expect(afterData.headerPaints - before.headerPaints).toBe(0);
		expect(afterData.overlayPaints - before.overlayPaints).toBe(0);

		store.setState({ visibleRowRange: { startIdx: 50, endIdx: 75 } });
		await Promise.resolve();
		await Promise.resolve();
		const afterViewport = renderer.getRenderStats();
		expect(afterViewport.fullPaints - afterData.fullPaints).toBe(0);
		expect(afterViewport.viewportPaints - afterData.viewportPaints).toBe(1);
		expect(afterViewport.headerPaints - afterData.headerPaints).toBe(0);
		expect(afterViewport.overlayPaints - afterData.overlayPaints).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('uses a viewport-only vertical scroll fast path', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [
			{ field: 'a', header: 'A', width: 120 },
			{ field: 'b', header: 'B', width: 120 },
		];
		const store = new GridStore<{ id: string; a: string; b: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 150 }, (_, index) => ({ id: `row-${index}`, a: `A${index}`, b: `B${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = renderer.getRenderStats();
		expect(stats.scrollFrames).toBe(1);
		expect(stats.viewportRecycles).toBe(1);
		expect(stats.fullPaints).toBe(0);
		expect(stats.headerPaintsDuringScroll).toBe(0);
		expect(stats.overlayPaintsDuringScroll).toBe(0);
		expect(stats.portalFlushesDuringScroll).toBe(0);
		expect(stats.hotDomReleases).toBeGreaterThan(0);
		expect(stats.rowsRecycledPerScrollFrame[0]).toBeGreaterThan(0);
		expect(stats.cellsPatchedPerScrollFrame[0]).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('coalesces repeated scroll events into one scroll animation frame', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		callbacks.length = 0;
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));
		scrollViewport.scrollTop = 1200;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// callbacks[0] is the scroll frame; scroll-end RAF ticks are also queued but don't matter here
		expect(renderer.getRenderStats().scrollFrames).toBe(0);
		callbacks[0](0);
		expect(renderer.getRenderStats().scrollFrames).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('ignores scroll callbacks when the DOM scroll position has not changed', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(renderer.getRenderStats().scrollFrames).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not rebuild headers on horizontal scroll', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = Array.from({ length: 80 }, (_, index) => ({ field: `col_${index}`, header: `Col ${index}`, width: 100 }));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 20 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 520,
			bottom: 180,
			width: 520,
			height: 180,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollLeft = 3000;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = renderer.getRenderStats();
		expect(stats.scrollFrames).toBe(1);
		expect(stats.fullPaints).toBe(0);
		expect(stats.headerPaints).toBe(0);
		expect(stats.headerPaintsDuringScroll).toBe(0);
		expect(stats.headerRangeSyncsDuringScroll).toBe(1);
		const visibleHeaderLabels = Array.from(container.querySelectorAll<HTMLDivElement>('.og-header-cell'))
			.map((cell) => cell.textContent ?? '')
			.filter(Boolean);
		expect(visibleHeaderLabels).toContain('Col 30');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not rebuild headers or call focus during vertical scroll frames', () => {
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
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		store.selectCell({ rowId: 'row-20', colField: 'name' });
		const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		focusSpy.mockClear();
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const statsDuringScroll = renderer.getRenderStats();
		expect(statsDuringScroll.scrollFrames).toBe(1);
		expect(statsDuringScroll.headerPaintsDuringScroll).toBe(0);
		expect(statsDuringScroll.headerRangeSyncsDuringScroll).toBe(0);
		expect(statsDuringScroll.overlayCheapSyncsDuringScroll).toBe(1);
		// With RAF-based scroll-end, finishScrolling runs after 4 RAF ticks (synchronously with
		// immediately-firing RAF stub). Focus is called in finishScrolling after isScrolling=false,
		// so it is not counted as a during-scroll focus call.
		expect(focusSpy).toHaveBeenCalledTimes(1);
		expect(statsDuringScroll.focusCallsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('defers portal unmounts when vertically recycling rows with custom renderers', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [
			{ field: 'a', header: 'A', width: 120, cellRenderer: () => null },
			{ field: 'b', header: 'B', width: 120, cellRenderer: () => null },
			{ field: 'c', header: 'C', width: 120, cellRenderer: () => null },
		];
		const store = new GridStore<{ id: string; a: string; b: string; c: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({
				id: `row-${index}`,
				a: `A${index}`,
				b: `B${index}`,
				c: `C${index}`,
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
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		const flushPortalContent = vi.fn();
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.portalMountManager.onFlushCellContent = flushPortalContent;
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		await Promise.resolve();
		await Promise.resolve();

		const unmountCount = (renderer.portalMountManager.onUnmountCellContent as ReturnType<typeof vi.fn>).mock.calls.length;
		const stats = renderer.getRenderStats();
		expect(unmountCount).toBe(0);
		expect(flushPortalContent).not.toHaveBeenCalled();
		expect(stats.portalReleasesDuringScroll).toBe(0);
		expect(stats.portalFlushesDuringScroll).toBe(0);
		expect(stats.portalMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('evacuates custom renderer DOM from recycled cells while keeping portal hosts intact', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'name', header: 'Name', width: 120, cellRenderer: () => null }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.onMountCellContent = ({ cellKey, container: portalHost }) => {
			if (!portalHost.querySelector('[data-portal-child]')) {
				const child = document.createElement('div');
				child.dataset.portalChild = cellKey;
				child.textContent = `portal:${cellKey}`;
				portalHost.appendChild(child);
			}
		};
		renderer.mount(container);
		const originalPortalChild = container.querySelector('[data-portal-child]') as HTMLDivElement;
		expect(originalPortalChild).not.toBeNull();
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));
		callbacks[0](0); // run the scroll frame; scroll-end chain stays deferred

		expect(originalPortalChild.isConnected).toBe(true);
		expect(originalPortalChild.closest('.og-cell')).toBeNull();
		expect(container.querySelector('.og-cell-portal-host')).not.toBeNull();
		expect(renderer.getRenderStats().rootTextContentWritesOnPortalCells).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('uses styled pending placeholders for recycled custom cells by default during scroll', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'name', header: 'Name', width: 120, cellRenderer: () => null }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.onMountCellContent = ({ cellKey, container: portalHost }) => {
			const child = document.createElement('div');
			child.dataset.portalChild = cellKey;
			child.textContent = `portal:${cellKey}`;
			portalHost.replaceChildren(child);
		};
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));
		callbacks[0](0); // run the scroll frame; scroll-end chain stays deferred

		const pendingCell = container.querySelector<HTMLDivElement>('.og-cell[data-content-mode="pending"]');
		expect(pendingCell).not.toBeNull();
		expect(pendingCell?.querySelector('.og-cell-content')?.textContent).toBe('');
		expect(pendingCell?.querySelector('.og-cell-portal-host')).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not synchronously unmount scrolled-out custom renderers on scroll idle', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [
			{ field: 'a', header: 'A', width: 120, cellRenderer: () => null },
			{ field: 'b', header: 'B', width: 120, cellRenderer: () => null },
		];
		const store = new GridStore<{ id: string; a: string; b: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}`, b: `B${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(renderer.portalMountManager.onUnmountCellContent).not.toHaveBeenCalled();
		vi.advanceTimersByTime(80);
		expect(renderer.portalMountManager.onUnmountCellContent).not.toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('mounts custom cell portals after scroll idle for cells skipped during the scroll frame', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [
			{ field: 'a', header: 'A', width: 120, cellRenderer: () => null },
			{ field: 'b', header: 'B', width: 120, cellRenderer: () => null },
		];
		const store = new GridStore<{ id: string; a: string; b: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}`, b: `B${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();
		store.getCellValue('row-40', 'defer');

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — portals must not be mounted yet
		callbacks[0](0);
		expect(renderer.portalMountManager.onMountCellContent).not.toHaveBeenCalled();

		// Flush scroll-end chain (4 ticks → finishScrolling) and post-scroll portal flush
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		// Run any additional frames scheduled by post-scroll work
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		expect(renderer.portalMountManager.onMountCellContent).toHaveBeenCalled();
		expect((renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mock.calls[0][0].phase).toBe('scroll-idle');
		expect((renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mock.calls[0][0].isScrolling).toBe(false);
		expect(renderer.getRenderStats().portalMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('defers newly recycled live custom renderers during the scroll frame', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [
			{
				field: 'a',
				header: 'A',
				width: 120,
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollBehavior: 'live' as const, estimatedCost: 'cheap' as const, supportsRebind: true },
			},
		];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();
		store.getCellValue('row-60', 'a');

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — portals must not be mounted yet
		callbacks[0](0);
		expect(renderer.portalMountManager.onMountCellContent).not.toHaveBeenCalled();
		const cellNode = container.querySelector('[data-row-id="row:row-60"]') as HTMLDivElement;
		expect(cellNode).not.toBeNull();
		const cellA = cellNode.querySelector('[data-col-field="a"]') as HTMLDivElement;
		expect(cellA.dataset.contentMode).toBe('pending');
		expect(renderer.getRenderStats().portalMountsDuringScroll).toBe(0);
		expect(renderer.getRenderStats().customRendererMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps custom cell classes during scroll and defers heavier cell hooks until idle', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const cellClass = vi.fn(() => 'custom-cell');
		const beforeCellRender = vi.fn();
		const afterCellRender = vi.fn();
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			styleSlots: {
				cellClass,
				beforeCellRender,
				afterCellRender,
			},
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		cellClass.mockClear();
		beforeCellRender.mockClear();
		afterCellRender.mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — cell hooks must not fire yet
		callbacks[0](0);
		expect(cellClass).not.toHaveBeenCalled();
		expect(beforeCellRender).not.toHaveBeenCalled();
		expect(afterCellRender).not.toHaveBeenCalled();
		const statsDuringScroll = renderer.getRenderStats();
		expect(statsDuringScroll.cellAccessReadsDuringScroll).toBe(0);
		expect(statsDuringScroll.cellClassComputesDuringScroll).toBe(0);
		expect(statsDuringScroll.dirtyCellsMarkedDuringScroll).toBeGreaterThan(0);

		// Flush scroll-end chain (4 RAF ticks → finishScrolling) and post-scroll decoration
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		expect(cellClass).toHaveBeenCalled();
		expect(beforeCellRender).toHaveBeenCalled();
		expect(afterCellRender).toHaveBeenCalled();
		expect(renderer.getRenderStats().postScrollDirtyCellsDecorated).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps custom row classes during scroll', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const rowClass = vi.fn(() => 'custom-row');
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			styleSlots: { rowClass },
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		rowClass.mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — rowClass must not fire yet
		callbacks[0](0);
		expect(rowClass).not.toHaveBeenCalled();

		// Flush scroll-end chain (4 RAF ticks → finishScrolling) and post-scroll decoration
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		expect(rowClass).toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('defers loading skeleton DOM queries until after scroll idle', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `__loading_${index}`, a: `A${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		const querySelectorSpy = vi.spyOn(Element.prototype, 'querySelector');
		querySelectorSpy.mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		querySelectorSpy.mockClear();
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(querySelectorSpy).not.toHaveBeenCalledWith('.og-cell-loading-skeleton');

		vi.advanceTimersByTime(80);
		await Promise.resolve();
		await Promise.resolve();

		expect(querySelectorSpy).not.toHaveBeenCalledWith('.og-cell-loading-skeleton');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('defers row portal work for detail rows during active scroll', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			masterDetailEnabled: true,
			detailRowHeight: 40,
			expansion: {
				groups: {},
				treeRows: {},
				details: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`row-${index}`, true])),
			},
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.portalMountManager.onMountRowContent = vi.fn();
		renderer.portalMountManager.onUnmountRowContent = vi.fn();
		renderer.mount(container);
		renderer.resetRenderStats();
		(renderer.portalMountManager.onMountRowContent as ReturnType<typeof vi.fn>).mockClear();
		(renderer.portalMountManager.onUnmountRowContent as ReturnType<typeof vi.fn>).mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — row portal callbacks must not fire yet
		callbacks[0](0);
		const stats = renderer.getRenderStats();
		expect(stats.scrollFrames).toBe(1);
		expect(stats.portalMountsDuringScroll + stats.portalReleasesDuringScroll).toBeGreaterThan(0);
		expect(renderer.portalMountManager.onMountRowContent).not.toHaveBeenCalled();
		expect(renderer.portalMountManager.onUnmountRowContent).not.toHaveBeenCalled();

		// Flush scroll-end chain (4 RAF ticks → finishScrolling) and post-scroll portal work
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		expect(
			(renderer.portalMountManager.onMountRowContent as ReturnType<typeof vi.fn>).mock.calls.length +
				(renderer.portalMountManager.onUnmountRowContent as ReturnType<typeof vi.fn>).mock.calls.length
		).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not clear React-owned detail portal DOM before deferred unmount runs', () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			masterDetailEnabled: true,
			detailRowHeight: 40,
			expansion: {
				groups: {},
				treeRows: {},
				details: { 'row-0': true },
			},
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 120,
			width: 500,
			height: 120,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		let portalChild: HTMLDivElement | null = null;
		renderer.portalMountManager.onMountRowContent = ({ container: portalHost }) => {
			portalChild = document.createElement('div');
			portalChild.dataset.detailPortalChild = 'true';
			portalHost.appendChild(portalChild);
		};
		renderer.portalMountManager.onUnmountRowContent = ({ container: portalHost }) => {
			if (portalChild) {
				portalHost?.removeChild(portalChild);
				portalChild = null;
			}
		};
		renderer.mount(container);
		expect((portalChild as any)?.parentElement?.classList.contains('og-row-portal-host')).toBe(true);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1200;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(() => vi.advanceTimersByTime(80)).not.toThrow();
		expect(portalChild).toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps custom detail row classes during scroll', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const detailRowClass = vi.fn(() => 'custom-detail-row');
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			masterDetailEnabled: true,
			detailRowHeight: 40,
			styleSlots: { detailRowClass },
			expansion: {
				groups: {},
				treeRows: {},
				details: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`row-${index}`, true])),
			},
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		detailRowClass.mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(detailRowClass).toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not remount already-bound detail row portals during viewport paints', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			masterDetailEnabled: true,
			detailRowHeight: 40,
			expansion: {
				groups: {},
				treeRows: {},
				details: {
					'row-0': true,
					'row-1': true,
				},
			},
		});
		const controller = new ClientRowModelController(store, {
			rows: [
				{ id: 'row-0', name: 'Zero' },
				{ id: 'row-1', name: 'One' },
			],
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
		renderer.portalMountManager.onMountRowContent = vi.fn();
		renderer.mount(container);
		expect(renderer.portalMountManager.onMountRowContent).toHaveBeenCalled();
		(renderer.portalMountManager.onMountRowContent as ReturnType<typeof vi.fn>).mockClear();

		renderer.scheduleViewportPaint('stable detail rows');
		await Promise.resolve();
		await Promise.resolve();

		expect(renderer.portalMountManager.onMountRowContent).not.toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('defers portal unmounts when horizontally recycling many custom-renderer columns', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = Array.from({ length: 1000 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
			cellRenderer: () => null,
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 12 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) {
					row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				}
				return row;
			}),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 520,
			bottom: 180,
			width: 520,
			height: 180,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		const flushPortalContent = vi.fn();
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.portalMountManager.onFlushCellContent = flushPortalContent;
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollLeft = 60000;
		scrollViewport.dispatchEvent(new Event('scroll'));
		// Run scroll frame only — scroll-end chain stays deferred
		callbacks[0](0);
		await Promise.resolve();
		await Promise.resolve();

		const unmountCount = (renderer.portalMountManager.onUnmountCellContent as ReturnType<typeof vi.fn>).mock.calls.length;
		const stats = renderer.getRenderStats();
		expect(unmountCount).toBe(0);
		expect(flushPortalContent).not.toHaveBeenCalled();
		expect(stats.portalReleasesDuringScroll).toBe(0);
		expect(stats.portalFlushesDuringScroll).toBe(0);
		expect(stats.portalMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('updates cell widths immediately on column resize', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: 'row-0', a: 'A0' }],
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 200,
			width: 500,
			height: 200,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const cell = container.querySelector('.og-cell') as HTMLDivElement;
		expect(cell.style.width).toBe('120px');

		// Trigger column resize
		store.setColumnWidth('a', 200);

		// Wait for render scheduler frame
		await Promise.resolve();
		await Promise.resolve();

		expect(cell.style.width).toBe('200px');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('replaces loading skeletons with data rows immediately when loading state and dataVersion update', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			loading: true,
		});
		const controller = new ClientRowModelController(store, {
			rows: [],
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 200,
			width: 500,
			height: 200,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		// Cell should be in loading mode initially
		let cell = container.querySelector('.og-cell') as HTMLDivElement;
		expect(cell.className).toContain('og-cell-loading');

		// Transition loading to false and supply rows
		store.setRows([{ id: 'row-0', a: 'A0' }]);
		store.setState({ loading: false });

		// Wait for render scheduler frame
		await Promise.resolve();
		await Promise.resolve();

		cell = container.querySelector('.og-cell') as HTMLDivElement;
		expect(cell.className).not.toContain('og-cell-loading');
		expect(cell.querySelector('.og-cell-content')?.textContent).toBe('A0');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('mounts detail row portal immediately when master row is expanded', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			masterDetailEnabled: true,
			detailRowHeight: 40,
		});
		const controller = new ClientRowModelController(store, {
			rows: [{ id: 'row-0', name: 'Row 0' }],
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
		const onMountRow = vi.fn(({ container: host }) => {
			const detail = document.createElement('div');
			detail.className = 'my-detail-content';
			host.appendChild(detail);
		});
		renderer.portalMountManager.onMountRowContent = onMountRow;
		renderer.mount(container);

		expect(onMountRow).not.toHaveBeenCalled();

		// Expand the row
		store.toggleDetailExpanded('row-0');

		// Wait for render scheduler frame
		await Promise.resolve();
		await Promise.resolve();

		expect(onMountRow).toHaveBeenCalledTimes(1);
		expect(container.querySelector('.my-detail-content')).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('renders valueGetter column values correctly during scroll', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [
			{ field: 'name', header: 'Name', width: 120 },
			{ field: 'computed', header: 'Computed', width: 120, valueGetter: ({ row }) => `${row.name}!` },
		];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			rowBuffer: 2,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 50 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		// Scroll to row 10
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run the scroll animation frame
		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		// Inspect the cells rendered at the scrolled position - during scroll it shows loading placeholder
		const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
		expect(row10).not.toBeNull();
		const computedCell = row10.querySelector('[data-col-field="computed"]') as HTMLDivElement;
		expect(computedCell).not.toBeNull();
		expect(computedCell.textContent).toBe('...');

		// Flush scroll-end chain (4 RAF ticks → finishScrolling) and post-scroll decoration
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		// Now it should be resolved to the computed value
		expect(computedCell.textContent).toBe('Row 10!');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('uses column renderer capabilities during scroll and skeletons uncategorized renderers', () => {
		vi.useFakeTimers();
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});

		const columns = [
			{ field: 'col1', header: 'Col 1', width: 100, cellRenderer: () => 'Col1Rendered' },
			{
				field: 'col2',
				header: 'Col 2',
				width: 100,
				cellRenderer: () => 'Col2Rendered',
				cellRendererCapabilities: { scrollBehavior: 'live' as const },
			},
			{
				field: 'col3',
				header: 'Col 3',
				width: 100,
				cellRenderer: () => 'Col3Rendered',
				cellRendererCapabilities: { scrollBehavior: 'fallback' as const },
			},
		];

		const store = new GridStore<{ id: string; col1: string; col2: string; col3: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});

		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 100 }, (_, index) => ({
				id: `row-${index}`,
				col1: `Val 1-${index}`,
				col2: `Val 2-${index}`,
				col3: `Val 3-${index}`,
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
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		const row40 = container.querySelector('[data-row-id="row:row-40"]') as HTMLDivElement;
		expect(row40).not.toBeNull();

		const cell1 = row40.querySelector('[data-col-field="col1"]') as HTMLDivElement;
		const cell2 = row40.querySelector('[data-col-field="col2"]') as HTMLDivElement;
		const cell3 = row40.querySelector('[data-col-field="col3"]') as HTMLDivElement;

		expect(cell1.dataset.contentMode).toBe('pending');
		expect(cell2.dataset.contentMode).toBe('pending');
		expect(cell3.dataset.contentMode).toBe('fallback');
		expect(renderer.portalMountManager.onMountCellContent).not.toHaveBeenCalled();
		expect(renderer.getRenderStats().customRendererMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.useRealTimers();
	});

	it('cellRendererCapabilities choose safe scroll behavior when no scroll mode override is set', () => {
		vi.useFakeTimers();
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});

		const columns = [
			{
				field: 'live',
				header: 'Live',
				width: 100,
				cellRenderer: () => 'LiveRendered',
				cellRendererCapabilities: { scrollBehavior: 'live' as const, estimatedCost: 'cheap' as const },
			},
			{
				field: 'defer',
				header: 'Defer',
				width: 100,
				cellRenderer: () => 'DeferRendered',
				cellRendererCapabilities: { scrollBehavior: 'defer' as const, interactive: true, deferFallback: 'snapshot' as const },
				valueGetterDependencies: ['defer'],
				valueGetter: ({ row }: any) => `Snapshot ${row.defer}`,
			},
			{
				field: 'fallback',
				header: 'Fallback',
				width: 100,
				cellRenderer: () => 'FallbackRendered',
				cellRendererCapabilities: { scrollBehavior: 'fallback' as const, estimatedCost: 'expensive' as const },
			},
		];

		const store = new GridStore<{ id: string; live: string; defer: string; fallback: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});

		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 100 }, (_, index) => ({
				id: `row-${index}`,
				live: `Live ${index}`,
				defer: `Defer ${index}`,
				fallback: `Fallback ${index}`,
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
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();
		expect(store.getCellValue('row-40', 'defer')).toBe('Snapshot Defer 40');
		expect(store.getCachedDisplayValue('row-40', 'defer')).toBe('Snapshot Defer 40');

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		const row40 = container.querySelector('[data-row-id="row:row-40"]') as HTMLDivElement;
		expect(row40).not.toBeNull();
		expect((row40.querySelector('[data-col-field="live"]') as HTMLDivElement).dataset.contentMode).toBe('pending');
		const deferCell = row40.querySelector('[data-col-field="defer"]') as HTMLDivElement;
		expect(deferCell.dataset.contentMode).toBe('fallback');
		expect(deferCell.querySelector('.og-cell-content')?.textContent).toBe('Snapshot Defer 40');
		expect((row40.querySelector('[data-col-field="fallback"]') as HTMLDivElement).dataset.contentMode).toBe('fallback');
		expect(renderer.portalMountManager.onMountCellContent).not.toHaveBeenCalled();
		expect(renderer.getRenderStats().customRendererMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.useRealTimers();
	});

	it('deferred custom renderers use pending when snapshot fallback is not enabled', () => {
		vi.useFakeTimers();
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});

		const columns = [
			{
				field: 'defer',
				header: 'Defer',
				width: 120,
				cellRenderer: () => 'DeferRendered',
				cellRendererCapabilities: { scrollBehavior: 'defer' as const, interactive: true },
			},
		];

		const store = new GridStore<{ id: string; defer: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});

		const controller = new ClientRowModelController(store, {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, defer: `Defer ${index}` })),
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		const row40 = container.querySelector('[data-row-id="row:row-40"]') as HTMLDivElement;
		const deferCell = row40.querySelector('[data-col-field="defer"]') as HTMLDivElement;
		expect(deferCell.dataset.contentMode).toBe('pending');
		expect(deferCell.querySelector('.og-cell-content')?.textContent).toBe('');

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.useRealTimers();
	});
});
