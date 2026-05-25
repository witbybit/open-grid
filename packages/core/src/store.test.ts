import { describe, it, expect, vi } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController } from './rowModel.js';
import { ServerRowModelController, IGridDatasource } from './serverRowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

describe('GridStore generic row-store functionality', () => {
	it('should initialize with standard default states', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const state = store.getState();
		const rowModel = store.getRowModel()!;

		expect(rowModel.getRowCount()).toBe(2);
		expect(state.columns).toHaveLength(2);
		expect(state.focusedCell).toBeNull();
		expect(state.selectedRange).toBeNull();

		controller.dispose();
	});

	it('should notify targeted key-subscribers only when that specific key is mutated', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const cellValueListener = vi.fn();
		const focusListener = vi.fn();

		store.registerCellSubscription({ rowId: '1', colField: 'name', onStoreChange: cellValueListener });
		store.subscribeToKey('focusedCell', focusListener);

		// Act 1: Set focused cell
		store.setState({ focusedCell: { rowId: '1', colField: 'name' } });

		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(cellValueListener).toHaveBeenCalledTimes(1);

		// Act 2: Change cell value
		store.setCellValue('1', 'name', 'Product Updated');
		store.flushCellUpdatesSync();

		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(cellValueListener).toHaveBeenCalledTimes(2);

		controller.dispose();
	});

	it('should precompute selection range bounds reactively inside selectedRangeBounds', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(store.getState().selectedRangeBounds).toBeNull();

		// Act 1: Select range from row 1, col 'id' to row 2, col 'name'
		store.setSelectedRange({ rowId: '1', colField: 'id' }, { rowId: '2', colField: 'name' });

		const bounds = store.getState().selectedRangeBounds;
		expect(bounds).not.toBeNull();
		expect(bounds?.minRow).toBe(0);
		expect(bounds?.maxRow).toBe(1);
		expect(bounds?.minCol).toBe(0);
		expect(bounds?.maxCol).toBe(1);

		controller.dispose();
	});

	it('should support valueGetter dynamically', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'price', header: 'Price', width: 100 },
				{
					field: 'price_display',
					header: 'Price Tag',
					width: 100,
					valueGetter: ({ row }) => `$${row.price}.00`,
				},
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Keyboard', price: 45 }],
			columns: store.getState().columns,
		});

		// 1. Initial dynamic check
		const val1 = store.getCellValue('1', 'price_display');
		expect(val1).toBe('$45.00');

		// 2. Reactive check after setting underlying cell value
		store.setCellValue('1', 'price', 90);
		const val2 = store.getCellValue('1', 'price_display');
		expect(val2).toBe('$90.00');

		controller.dispose();
	});

	it('should support stopEditing and setCellValue commits and cancellations', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Keyboard', price: 45 }],
			columns: store.getState().columns,
		});

		// 1. Enter edit state
		store.setState({
			activeEdit: {
				rowId: '1',
				colField: 'name',
			},
		});

		// Cancel edit (just call stopEditing without setCellValue)
		store.stopEditing();
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Keyboard');

		// 2. Commit edit (set value then call stopEditing)
		store.setState({
			activeEdit: {
				rowId: '1',
				colField: 'name',
			},
		});

		store.setCellValue('1', 'name', 'Premium Keyboard');
		store.stopEditing();
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Premium Keyboard');

		controller.dispose();
	});

	it('should support plug-and-play feature registration and API injection', () => {
		const store = new GridStore<TestRow>();

		const initSpy = vi.fn();
		const destroySpy = vi.fn();

		const customFeature = {
			name: 'customService',
			onInit: initSpy,
			onDestroy: destroySpy,
			getApiMethods: () => ({
				customApiCall: (arg: string) => `Handled: ${arg}`,
			}),
		};

		store.registerPlugin(customFeature);

		// 1. Check feature is initialized
		expect(initSpy).toHaveBeenCalledWith(store);

		interface CustomStore {
			customService: unknown;
			customApiCall: (arg: string) => string;
		}

		// 2. Check property binding (AG Grid style)
		expect((store as unknown as CustomStore).customService).toBe(customFeature);

		// 3. Check dynamic API method injection
		expect(typeof (store as unknown as CustomStore).customApiCall).toBe('function');
		expect((store as unknown as CustomStore).customApiCall('test')).toBe('Handled: test');

		// 4. Check clean destruction
		store.destroy();
		expect(destroySpy).toHaveBeenCalled();
	});

	it('should handle column resizing', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const resizeListener = vi.fn();
		store.addEventListener('columnResized', resizeListener);

		store.setColumnWidth('name', 250);

		expect(store.getState().columnWidths['name']).toBe(250);
		expect(resizeListener).toHaveBeenCalledTimes(1);
		expect(resizeListener).toHaveBeenCalledWith({
			type: 'columnResized',
			payload: { colField: 'name', width: 250 },
		});
	});

	it('should support column reordering through the public store API', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});

		const reorderListener = vi.fn();
		store.addEventListener('columnOrderChanged', reorderListener);

		store.moveColumn('price', 0);

		expect(store.getState().columns.map((column) => column.field)).toEqual(['price', 'id', 'name']);
		expect(store.getColumnIndex('price')).toBe(0);
		expect(reorderListener).toHaveBeenCalledWith({
			type: 'columnOrderChanged',
			payload: {
				columns: store.getState().columns,
				columnFields: ['price', 'id', 'name'],
			},
		});

		store.setColumnOrder(['name', 'price']);

		expect(store.getState().columns.map((column) => column.field)).toEqual(['name', 'price', 'id']);
		expect(store.getColumnIndex('id')).toBe(2);
	});

	it('should toggle column reorder state through the public store API', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const toggleListener = vi.fn();
		store.addEventListener('columnReorderToggled', toggleListener);

		expect(store.getState().enableColumnReorder).toBe(true);

		store.setColumnReorderEnabled(false);

		expect(store.getState().enableColumnReorder).toBe(false);
		expect(toggleListener).toHaveBeenCalledWith({
			type: 'columnReorderToggled',
			payload: { enabled: false },
		});
	});
});

describe('ClientRowModelController sorting and filtering', () => {
	it('should apply client sort and filter correctly', () => {
		const store = new GridStore<TestRow>();
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: 'c', name: 'Cherry', price: 5 },
				{ id: 'a', name: 'Apple', price: 15 },
				{ id: 'b', name: 'Banana', price: 10 },
			],
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 100 },
			],
		});

		const rowModel = store.getRowModel()!;

		// Check initial rows load
		expect(rowModel.getRowCount()).toBe(3);

		// Apply sort by name Ascending
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		expect(rowModel.getRow(0)?.name).toBe('Apple');
		expect(rowModel.getRow(1)?.name).toBe('Banana');
		expect(rowModel.getRow(2)?.name).toBe('Cherry');

		// Apply sorting descending
		store.setSortModel([{ colId: 'name', sort: 'desc' }]);
		expect(rowModel.getRow(0)?.name).toBe('Cherry');

		// Apply filter by name contains 'an'
		store.setFilterModel({ name: { type: 'contains', filter: 'an' } });
		expect(rowModel.getRowCount()).toBe(1);
		expect(rowModel.getRow(0)?.name).toBe('Banana');

		controller.dispose();
	});

	it('should support benchmark sorting and selection maps in O(1) time', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
		});
		const largeRows = Array.from({ length: 1000000 }, (_, i) => ({
			id: String(i),
			name: `Product ${i}`,
			price: i,
		}));
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: largeRows,
			columns: store.getState().columns,
		});

		const rowModel = store.getRowModel()!;
		const t0 = performance.now();
		const idx = rowModel.getRowIndexById('999999');
		const t1 = performance.now();

		expect(idx).toBe(999999);
		expect(t1 - t0).toBeLessThan(5.0); // Under 5ms (typically <0.1ms) demonstrating O(1) hash map speed!

		controller.dispose();
	});
});

describe('ServerRowModelController paginated lazily populated row-patching', () => {
	it('should fetch rows block on demand', async () => {
		const store = new GridStore<TestRow>();
		const mockDatasource: IGridDatasource = {
			getRows: async (params) => {
				return {
					rows: [
						{ id: '10', name: 'Server A', price: 100 },
						{ id: '11', name: 'Server B', price: 200 },
					],
					totalCount: 100,
				};
			},
		};

		const controller = new ServerRowModelController<TestRow>(store, {
			datasource: mockDatasource,
			blockSize: 2,
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 100 },
			],
		});

		// Access row at index 0, should return null initially and trigger fetching
		const initial = controller.getRow(0);
		expect(initial).toBeNull();

		// Wait for mock datasource promise to resolve and state to update
		await vi.waitFor(() => {
			return controller.getRow(0) !== null;
		});

		const loaded = controller.getRow(0);
		expect(loaded?.name).toBe('Server A');

		controller.dispose();
	});
});

describe('RowNode, Path Getter Pre-Compilation, Caching, and Batch Transactions', () => {
	it('should support RowNode properties and cellular caching', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const rowModel = store.getRowModel()!;
		const node = rowModel.getRowNode!(0)!;

		expect(node).toBeDefined();
		expect(node.id).toBe('1');
		expect(node.data.name).toBe('Product A');

		// Cell caching test
		let callCount = 0;
		const customGetter = (data: TestRow) => {
			callCount++;
			return data.name.toUpperCase();
		};

		const val1 = node.getCellValue('name', customGetter);
		expect(val1).toBe('PRODUCT A');
		expect(callCount).toBe(1);

		// Subsequent call must fetch from cache
		const val2 = node.getCellValue('name', customGetter);
		expect(val2).toBe('PRODUCT A');
		expect(callCount).toBe(1); // Call count remains 1 due to cache!

		// Clear value cache
		node.clearValueCache();
		const val3 = node.getCellValue('name', customGetter);
		expect(val3).toBe('PRODUCT A');
		expect(callCount).toBe(2); // Invalidation works!

		controller.dispose();
	});

	it('should support batch transactions in GridStore', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name' }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const listener = vi.fn();
		store.subscribe(listener);

		store.startTransaction();
		store.setState({ focusedCell: { rowId: '1', colField: 'name' } });
		store.setState({ defaultRowHeight: 50 });
		store.setState({ defaultColWidth: 120 });

		// Listeners must not be notified during a transaction
		expect(listener).toHaveBeenCalledTimes(0);
		expect(store.getState().focusedCell?.rowId).toBe('1');
		expect(store.getState().defaultRowHeight).toBe(50);
		expect(store.getState().defaultColWidth).toBe(120);

		// End transaction
		store.endTransaction();
		// Listeners notified exactly once at the end!
		expect(listener).toHaveBeenCalledTimes(1);

		controller.dispose();
	});
});

describe('Phase 2 Engine Scalability Subsystems', () => {
	it('should correctly schedule tasks across Interactive, Render, and Stream Priority Lanes', async () => {
		const { TransactionScheduler, PriorityLane } = await import('./scheduler.js');
		const scheduler = new TransactionScheduler();

		const tracking: string[] = [];

		scheduler.schedule(PriorityLane.Stream, () => tracking.push('stream-1'));
		scheduler.schedule(PriorityLane.Render, () => tracking.push('render-1'));
		scheduler.schedule(PriorityLane.Interactive, () => tracking.push('interactive-1'));

		// Interactive lane must execute synchronously and immediately
		expect(tracking).toContain('interactive-1');
		expect(tracking).not.toContain('render-1');
		expect(tracking).not.toContain('stream-1');

		// Sync flush of other lanes
		scheduler.flushAllSync();
		expect(tracking).toEqual(['interactive-1', 'render-1', 'stream-1']);
	});

	it('should cache cumulative geometry and map offsets using binary search in O(log N) time', async () => {
		const { ViewportGeometry } = await import('./viewportGeometry.js');
		const geometry = new ViewportGeometry();

		const widths = [100, 150, 200, 80]; // Cumulative offsets: 0, 100, 250, 450
		geometry.updateColumns(widths, 100);

		expect(geometry.colLefts[0]).toBe(0);
		expect(geometry.colLefts[1]).toBe(100);
		expect(geometry.colLefts[2]).toBe(250);
		expect(geometry.colLefts[3]).toBe(450);

		// Binary search index mappings at offsets
		expect(geometry.getIndexAtOffset(50, geometry.colLefts)).toBe(0);
		expect(geometry.getIndexAtOffset(150, geometry.colLefts)).toBe(1);
		expect(geometry.getIndexAtOffset(300, geometry.colLefts)).toBe(2);
		expect(geometry.getIndexAtOffset(500, geometry.colLefts)).toBe(3);
	});

	it('should pool and dispatch cell subscriptions using packed 32-bit composite binary keys with stable numeric IDs', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: 'row-a', name: 'Product A', price: 10 },
				{ id: 'row-b', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		const valueListener = vi.fn();
		const focusListener = vi.fn();

		// Subscribe using standard cell key pattern
		store.registerCellSubscription({ rowId: 'row-a', colField: 'name', onStoreChange: valueListener });
		store.registerCellSubscription({ rowId: 'row-b', colField: 'name', onStoreChange: focusListener });

		// Act 1: Focus row-b:name
		store.setFocusedCell('row-b', 'name');
		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(valueListener).toHaveBeenCalledTimes(0);

		// Act 2: Mutate row-a:name value
		store.setCellValue('row-a', 'name', 'Product Custom');
		store.flushCellUpdatesSync();
		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(valueListener).toHaveBeenCalledTimes(1);

		controller.dispose();
	});
});

describe('GridStore Scoped Batch Transactions and Properties', () => {
	it('should support scoped batch transactions and execute them exactly once', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const listener = vi.fn();
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: listener });

		store.batch(() => {
			store.setCellValue('1', 'price', 15);
			store.setCellValue('1', 'price', 20);
			// Listener shouldn't be notified immediately
			expect(listener).toHaveBeenCalledTimes(0);
		});

		// Listener should be notified exactly once (batch() always flushes sync on exit)
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getCellValue('1', 'price')).toBe(20);

		controller.dispose();
	});

	it('should support batchedUpdates property getter and setter', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const listener = vi.fn();
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: listener });

		// batchedUpdates is true by default (library manages batching internally)
		expect(store.batchedUpdates).toBe(true);

		store.setCellValue('1', 'price', 15);
		store.setCellValue('1', 'price', 20);
		expect(listener).toHaveBeenCalledTimes(0);

		// Disabling batchedUpdates should trigger flush
		store.batchedUpdates = false;
		expect(store.batchedUpdates).toBe(false);
		expect(listener).toHaveBeenCalledTimes(1);

		// Re-enabling should work
		store.batchedUpdates = true;
		expect(store.batchedUpdates).toBe(true);

		controller.dispose();
	});

	it('should correctly flush even if callback throws an error', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const listener = vi.fn();
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: listener });

		expect(() => {
			store.batch(() => {
				store.setCellValue('1', 'price', 15);
				throw new Error('Test Error');
			});
		}).toThrow('Test Error');

		// The update should still have been flushed (batch() flushes sync in finally)
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getCellValue('1', 'price')).toBe(15);

		controller.dispose();
	});

	it('should only notify subscribers of edited and dependent cells, not all columns on the row', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const nameListener = vi.fn();
		const priceListener = vi.fn();

		store.registerCellSubscription({ rowId: '1', colField: 'name', onStoreChange: nameListener });
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: priceListener });

		// Trigger cell value change on price
		store.batch(() => {
			store.setCellValue('1', 'price', 15);
		});

		// The price cell listener should be notified exactly once
		expect(priceListener).toHaveBeenCalledTimes(1);
		// The name cell listener should NOT be notified at all since it has no dependency on price
		expect(nameListener).toHaveBeenCalledTimes(0);

		controller.dispose();
	});

	it('should bound selection cell notifications to the visible viewport', () => {
		const columns = Array.from({ length: 50 }, (_, i) => ({ field: `c${i}`, header: `C${i}` }));
		const rows = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, price: i }));
		const store = new GridStore<any>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
		});
		const controller = new ClientRowModelController<any>(store, {
			rows,
			columns,
		});

		store.viewportController.setViewportSize(300, 160);
		store.viewportController.setScrollPosition(0, 0);
		store.viewportController.updateVisibleRanges();

		const visibleListener = vi.fn();
		const offscreenListener = vi.fn();
		store.registerCellSubscription({ rowId: 'r0', colField: 'c0', onStoreChange: visibleListener });
		store.registerCellSubscription({ rowId: 'r400', colField: 'c40', onStoreChange: offscreenListener });

		store.setSelectedRange({ rowId: 'r0', colField: 'c0' }, { rowId: 'r499', colField: 'c49' });

		expect(visibleListener).toHaveBeenCalledTimes(1);
		expect(offscreenListener).toHaveBeenCalledTimes(0);

		controller.dispose();
	});
});

describe('GridStore Command Bus and Undo/Redo functionality', () => {
	it('should support undo and redo for cell value modifications', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		expect(store.canUndo()).toBe(false);
		expect(store.canRedo()).toBe(false);

		// Act 1: Set value
		store.setCellValue('1', 'price', 25);
		expect(store.getCellValue('1', 'price')).toBe(25);
		expect(store.canUndo()).toBe(true);
		expect(store.canRedo()).toBe(false);

		// Act 2: Undo
		store.undo();
		expect(store.getCellValue('1', 'price')).toBe(10);
		expect(store.canUndo()).toBe(false);
		expect(store.canRedo()).toBe(true);

		// Act 3: Redo
		store.redo();
		expect(store.getCellValue('1', 'price')).toBe(25);
		expect(store.canUndo()).toBe(true);
		expect(store.canRedo()).toBe(false);

		controller.dispose();
	});

	it('should support undo and redo for column width and row height resizing', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		// 1. Column Width Undo/Redo
		store.setColumnWidth('name', 200);
		expect(store.getState().columnWidths['name']).toBe(200);
		expect(store.canUndo()).toBe(true);

		store.undo();
		expect(store.getState().columnWidths['name']).toBe(100);

		store.redo();
		expect(store.getState().columnWidths['name']).toBe(200);

		// 2. Row Height Undo/Redo
		store.setRowHeight('1', 80);
		expect(store.getState().rowHeights['1']).toBe(80);

		store.undo();
		expect(store.getState().rowHeights['1']).toBe(40);

		store.redo();
		expect(store.getState().rowHeights['1']).toBe(80);

		controller.dispose();
	});

	it('should support undo and redo for sort and filter models', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name' }],
		});
		const controller = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: '1', name: 'Banana', price: 10 },
				{ id: '2', name: 'Apple', price: 20 },
			],
			columns: store.getState().columns,
		});

		// 1. Sort Model Undo/Redo
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);

		store.undo();
		expect(store.getState().sortModel).toBeNull();

		store.redo();
		expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);

		// 2. Filter Model Undo/Redo
		store.setFilterModel({ name: { type: 'contains', filter: 'App' } });
		expect(store.getState().filterModel).toEqual({ name: { type: 'contains', filter: 'App' } });

		store.undo();
		expect(store.getState().filterModel).toBeNull();

		store.redo();
		expect(store.getState().filterModel).toEqual({ name: { type: 'contains', filter: 'App' } });

		controller.dispose();
	});

	it('should enforce the history capacity limit (max 100 entries)', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		// We resize the column 105 times (widths 101 to 205)
		// The original width is 100.
		// The 1st action sets it to 101 (reverts to 100).
		// The 5th action sets it to 105 (reverts to 104).
		// The 6th action sets it to 106 (reverts to 105).
		// If capacity is 100, the first 5 actions (which resize to 101, 102, 103, 104, 105) will be evicted from the undo stack.
		// The oldest remaining entry in the undo stack is the 6th action (resize to 106, undo should revert to 105).
		// Therefore, if we undo all the way (100 times), the width should end up at 105, NOT 100.
		for (let i = 1; i <= 105; i++) {
			store.setColumnWidth('name', 100 + i);
		}

		expect(store.getState().columnWidths['name']).toBe(205);

		// Undo all the way
		while (store.canUndo()) {
			store.undo();
		}

		// The width should be 105 because the oldest undoable action was setting it to 106 (which reverted to 105)
		expect(store.getState().columnWidths['name']).toBe(105);
	});
});
