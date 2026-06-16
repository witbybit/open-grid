// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

function makeStore(cols?: any[]): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: cols ?? [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'price', header: 'Price', width: 100 },
		],
		getRowId: (row) => row.id,
	});
}

function makeController(store: GridStore<TestRow>, rows?: TestRow[]): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: rows ?? [
			{ id: '1', name: 'Product A', price: 10 },
			{ id: '2', name: 'Longer Product Name', price: 20000 },
		],
		columns: store.getState().columns,
	});
}

// Each character = 7px in the mock canvas
function mockCanvas() {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		font: '',
		measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
	} as any);
}

describe('autoSizeColumn', () => {
	beforeEach(mockCanvas);
	afterEach(() => vi.restoreAllMocks());

	it('sets width to longest cell value including header', () => {
		const store = makeStore();
		const ctrl = makeController(store);

		// 'Longer Product Name' = 19 chars × 7 = 133, + 2×8 padding = 149 → ceil(149) = 149
		// header 'Name' = 4 chars × 7 = 28 — shorter
		store.autoSizeColumn('name');
		expect(store.getState().columnWidths['name']).toBe(149);

		ctrl.dispose();
		store.destroy();
	});

	it('respects minWidth', () => {
		const store = makeStore([{ field: 'id', header: 'ID', width: 50, minWidth: 200 }]);
		const ctrl = makeController(store, [{ id: '1', name: 'A', price: 1 }]);

		// 'ID' header = 2 chars × 7 = 14px, value '1' = 7px → max = 14, + 16 = 30 < minWidth 200
		store.autoSizeColumn('id');
		expect(store.getState().columnWidths['id']).toBe(200);

		ctrl.dispose();
		store.destroy();
	});

	it('respects maxWidth', () => {
		const store = makeStore([{ field: 'name', header: 'Name', width: 150, maxWidth: 50 }]);
		const ctrl = makeController(store, [{ id: '1', name: 'A Very Long Name That Exceeds Max Width', price: 1 }]);

		store.autoSizeColumn('name');
		expect(store.getState().columnWidths['name']).toBe(50);

		ctrl.dispose();
		store.destroy();
	});

	it('skips hidden columns in autoSizeAllColumns', () => {
		const store = makeStore([
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'price', header: 'Price', width: 100, hide: true },
		]);
		const ctrl = makeController(store);
		const initialPriceWidth = store.getState().columnWidths['price'];

		store.autoSizeAllColumns();

		expect(store.getState().columnWidths['name']).not.toBe(150);
		// hidden column should not be resized
		expect(store.getState().columnWidths['price']).toBe(initialPriceWidth);

		ctrl.dispose();
		store.destroy();
	});

	it('uses valueFormatter output for measurement', () => {
		const store = makeStore([
			{
				field: 'price',
				header: 'Price',
				width: 100,
				valueFormatter: ({ value }: { value: unknown }) => `$${Number(value).toLocaleString()}`,
			},
		]);
		const ctrl = makeController(store, [{ id: '1', name: 'A', price: 10000 }]);

		store.autoSizeColumn('price');

		// '$10,000' = 7 chars × 7 = 49 + 16 = 65
		// raw '10000' = 5 chars × 7 = 35 + 16 = 51
		// formatter produces wider result
		expect(store.getState().columnWidths['price']).toBe(65);

		ctrl.dispose();
		store.destroy();
	});
});
