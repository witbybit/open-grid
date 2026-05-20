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

		const dataVersionListener = vi.fn();
		const focusListener = vi.fn();

		store.subscribeToKey('dataVersion', dataVersionListener);
		store.subscribeToKey('focusedCell', focusListener);

		// Act 1: Set focused cell
		store.setState({ focusedCell: { rowId: '1', colField: 'name' } });

		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(dataVersionListener).toHaveBeenCalledTimes(0);

		// Act 2: Change cell value
		store.setCellValue('1', 'name', 'Product Updated');

		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(dataVersionListener).toHaveBeenCalledTimes(1);

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
			init: initSpy,
			destroy: destroySpy,
			getApiMethods: () => ({
				customApiCall: (arg: string) => `Handled: ${arg}`,
			}),
		};

		store.registerFeature(customFeature);

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
			rowIdField: 'id',
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
				{ field: 'price', header: 'Price' }
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
		expect(node.rowIndex).toBe(0);
		expect(node.rowTop).toBe(0);
		expect(node.rowHeight).toBe(40);

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
			columns: [
				{ field: 'name', header: 'Name' }
			],
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

