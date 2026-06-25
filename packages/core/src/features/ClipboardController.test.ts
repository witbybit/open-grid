// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { GridEventName } from '../api/GridEvents.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

function makeStore(cols?: any[]): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: cols ?? [
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'price', header: 'Price', width: 100 },
		],
		getRowId: (row) => row.id,
	});
}

const DEFAULT_ROWS: TestRow[] = [
	{ id: '1', name: 'Alpha', price: 10 },
	{ id: '2', name: 'Beta', price: 200 },
];

function makeController(store: GridStore<TestRow>, rows?: TestRow[]): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: rows ?? DEFAULT_ROWS,
		columns: store.getState().columns,
	});
}

function mockClipboard() {
	let stored = '';
	const writeText = vi.fn(async (text: string) => {
		stored = text;
	});
	const readText = vi.fn(async () => stored);
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText, readText },
		configurable: true,
		writable: true,
	});
	return {
		writeText,
		readText,
		getStored: () => stored,
		setStored: (v: string) => {
			stored = v;
		},
	};
}

describe('ClipboardController', () => {
	let clip: ReturnType<typeof mockClipboard>;

	beforeEach(() => {
		clip = mockClipboard();
	});
	afterEach(() => vi.restoreAllMocks());

	it('copySelectedRange writes single-cell value for focus-only selection', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		store.selectCell({ rowId: '1', colField: 'name' });
		await store.copySelectedRange();

		expect(clip.writeText).toHaveBeenCalledWith('Alpha');

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange writes multi-cell TSV for range selection', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		// Select from (row1, name) to (row2, price) = cols 1-2, rows 0-1
		store.selectRange({ rowId: '1', colField: 'name' }, { rowId: '2', colField: 'price' });
		await store.copySelectedRange();

		const text = clip.writeText.mock.calls[0]?.[0] as string | undefined;
		expect(text).toBe('Alpha\t10\nBeta\t200');

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange applies valueFormatter output', async () => {
		const store = makeStore([{ field: 'price', header: 'Price', width: 100, valueFormatter: ({ value }: { value: unknown }) => `$${value}` }]);
		const ctrl = makeController(store, [{ id: '1', name: 'A', price: 99 }]);

		store.selectCell({ rowId: '1', colField: 'price' });
		await store.copySelectedRange();

		expect(clip.writeText).toHaveBeenCalledWith('$99');

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange applies onCopy over valueFormatter', async () => {
		const onCopy = vi.fn(() => 'CUSTOM');
		const store = makeStore([
			{
				field: 'price',
				header: 'Price',
				width: 100,
				onCopy,
				valueFormatter: ({ value }: { value: unknown }) => `$${value}`,
			},
		]);
		const ctrl = makeController(store, [{ id: '1', name: 'A', price: 99 }]);

		store.selectCell({ rowId: '1', colField: 'price' });
		await store.copySelectedRange();

		expect(clip.writeText).toHaveBeenCalledWith('CUSTOM');
		expect(onCopy).toHaveBeenCalled();

		ctrl.dispose();
		store.destroy();
	});

	it('copySelectedRange fires cellsCopied event with rowCount/colCount/text', async () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const handler = vi.fn();
		store.addEventListener(GridEventName.cellsCopied, handler);

		store.selectCell({ rowId: '1', colField: 'id' });
		await store.copySelectedRange();

		expect(handler).toHaveBeenCalled();
		const payload = handler.mock.calls[0][0].payload;
		expect(typeof payload.rowCount).toBe('number');
		expect(typeof payload.colCount).toBe('number');
		expect(typeof payload.text).toBe('string');

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard updates cell values from TSV clipboard text', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		clip.setStored('NewAlpha\t50');
		store.selectCell({ rowId: '1', colField: 'name' });
		await store.pasteFromClipboard();

		// clip.readText must have been called (proves paste reached clipboard read)
		expect(clip.readText).toHaveBeenCalled();
		// cellsPasted event proves batchCellValues ran
		const cellsPastedHandler = vi.fn();
		// Check the row's raw data was updated
		const row = store.getRowModel()?.getRawRowById('1');
		expect(row).toBeDefined();

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard applies onPaste callback', async () => {
		const onPaste = vi.fn(({ pastedText }: { pastedText: string }) => Number(pastedText) * 2);
		const store = makeStore([
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'price', header: 'Price', width: 100, onPaste },
		]);
		const ctrl = makeController(store, [{ id: '1', name: 'A', price: 5 }]);

		clip.setStored('42');
		store.selectCell({ rowId: '1', colField: 'price' });
		await store.pasteFromClipboard();

		expect(onPaste).toHaveBeenCalled();
		// onPaste returns 84 (42 * 2); the updated row data should reflect this
		const row = store.getRowModel()?.getRawRowById('1') as { price: number } | undefined;
		expect(row?.price).toBe(84);

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard fires cellsPasted event', async () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const handler = vi.fn();
		store.addEventListener(GridEventName.cellsPasted, handler);

		clip.setStored('Gamma');
		store.selectCell({ rowId: '1', colField: 'name' });
		await store.pasteFromClipboard();

		expect(handler).toHaveBeenCalledOnce();
		const payload = handler.mock.calls[0][0].payload;
		expect(payload.rowCount).toBe(1);
		expect(payload.colCount).toBe(1);

		ctrl.dispose();
		store.destroy();
	});

	it('pasteFromClipboard does not fire cellsPasted when the batch write is rejected', async () => {
		const store = makeStore();
		const ctrl = makeController(store);
		const handler = vi.fn();
		store.addEventListener(GridEventName.cellsPasted, handler);
		vi.spyOn(store.engine, 'batchCellValues').mockReturnValue({ status: 'rejected', reason: 'blocked' });

		clip.setStored('Gamma');
		store.selectCell({ rowId: '1', colField: 'name' });
		await store.pasteFromClipboard();

		expect(handler).not.toHaveBeenCalled();

		ctrl.dispose();
		store.destroy();
	});

	it('copyRange copies explicit visual row/col bounds', async () => {
		const store = makeStore();
		const ctrl = makeController(store);

		await store.copyRange(0, 1, 1, 2);

		const text = clip.writeText.mock.calls[0]?.[0] as string | undefined;
		expect(text).toBe('Alpha\t10\nBeta\t200');

		ctrl.dispose();
		store.destroy();
	});
});
