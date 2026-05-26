// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridStore, type GridCellPointer } from './store.js';
import { ClientRowModelController } from './rowModel.js';
import { GridContextMenuPlugin, type ContextMenuParams } from './contextMenu.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

type ContextMenuTestPlugin = {
	copySelectedRange(params: ContextMenuParams<TestRow>): void;
	clearSelection(params: ContextMenuParams<TestRow>): void;
	add100ToSelection(params: ContextMenuParams<TestRow>): void;
	apply10PercentIncrease(params: ContextMenuParams<TestRow>): void;
	activePointer: GridCellPointer | null;
	renderMenu(clientX: number, clientY: number): void;
	menuElement: HTMLDivElement | null;
};

describe('GridContextMenuPlugin', () => {
	let store: GridStore<TestRow>;
	let rowController: ClientRowModelController<TestRow>;
	let plugin: GridContextMenuPlugin<TestRow>;
	let testPlugin: ContextMenuTestPlugin;

	beforeEach(() => {
		// Mock navigator clipboard
		Object.defineProperty(globalThis, 'navigator', {
			value: {
				clipboard: {
					writeText: vi.fn().mockResolvedValue(undefined),
				},
			},
			configurable: true,
			writable: true,
		});

		store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID' },
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});

		rowController = new ClientRowModelController<TestRow>(store, {
			rows: [
				{ id: 'r1', name: 'Product A', price: 100 },
				{ id: 'r2', name: 'Product B', price: 200 },
				{ id: 'r3', name: 'Product C', price: 300 },
			],
			columns: store.getState().columns,
		});

		plugin = new GridContextMenuPlugin<TestRow>();
		store.registerPlugin(plugin);
		testPlugin = plugin as unknown as ContextMenuTestPlugin;
	});

	afterEach(() => {
		rowController.dispose();
		plugin.onDestroy();
	});

	it('should register successfully without injecting API methods', () => {
		const contextMenuPlugin = store.getPlugin<GridContextMenuPlugin<TestRow>>('contextMenu');
		expect(contextMenuPlugin).not.toBeNull();
		expect((store as unknown as Record<string, unknown>).showContextMenu).toBeUndefined();
		expect((store as unknown as Record<string, unknown>).hideContextMenu).toBeUndefined();
	});

	it('should focus and select cell on right click if not already selected', () => {
		plugin.show('r2', 'name', 100, 100);

		const state = store.getState();
		expect(state.selection.focus).toEqual({ rowId: 'r2', colField: 'name' });
		expect(state.selection.range).toEqual({
			start: { rowId: 'r2', colField: 'name' },
			end: { rowId: 'r2', colField: 'name' },
		});
	});

	it('should maintain existing multi-cell selection when right-clicking within it', () => {
		// Programmatically set multi-cell selection: r1:name to r2:price
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		// Right click on r2:name which is inside the bounds
		plugin.show('r2', 'name', 100, 100);

		const state = store.getState();
		expect(state.selection.range).toEqual({
			start: { rowId: 'r1', colField: 'name' },
			end: { rowId: 'r2', colField: 'price' },
		});
	});

	it('should copy selected range to clipboard in Excel-compatible TSV format', () => {
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			store,
			selection: state.selection,
		};

		// Call internal copy selected range directly or simulate it
		testPlugin.copySelectedRange(params);

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
			'Product A\t100\nProduct B\t200'
		);
	});

	it('should clear selection values atomically', () => {
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			store,
			selection: state.selection,
		};

		testPlugin.clearSelection(params);

		expect(store.getCellValue('r1', 'name')).toBe('');
		expect(store.getCellValue('r1', 'price')).toBe('');
		expect(store.getCellValue('r2', 'name')).toBe('');
		expect(store.getCellValue('r2', 'price')).toBe('');
	});

	it('should add 100 to selection numerical values atomically', () => {
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			store,
			selection: state.selection,
		};

		testPlugin.add100ToSelection(params);

		// Price columns are numerical, should increment
		expect(store.getCellValue('r1', 'price')).toBe(200);
		expect(store.getCellValue('r2', 'price')).toBe(300);

		// Name columns are strings, should not change
		expect(store.getCellValue('r1', 'name')).toBe('Product A');
		expect(store.getCellValue('r2', 'name')).toBe('Product B');
	});

	it('should apply 10% increase to selection numerical values atomically', () => {
		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		const state = store.getState();
		const params = {
			rowId: 'r1',
			colField: 'name',
			store,
			selection: state.selection,
		};

		testPlugin.apply10PercentIncrease(params);

		// Price columns are numerical, should multiply by 1.1
		expect(store.getCellValue('r1', 'price')).toBe(110);
		expect(store.getCellValue('r2', 'price')).toBe(220);

		// Name columns are strings, should not change
		expect(store.getCellValue('r1', 'name')).toBe('Product A');
		expect(store.getCellValue('r2', 'name')).toBe('Product B');
	});

	it('should allow excluding default menu items', () => {
		plugin.setOptions({
			excludeDefaults: ['copy', 'add100'],
		});
		testPlugin.activePointer = { rowId: 'r1', colField: 'name' };
		testPlugin.renderMenu(100, 100);

		const menuEl = testPlugin.menuElement as HTMLDivElement;
		expect(menuEl).toBeDefined();
		const items = Array.from(menuEl.querySelectorAll('.og-context-menu-item'));
		const texts = items.map(el => el.textContent);

		expect(texts).not.toContain('Copy Selected Range');
		expect(texts).not.toContain('Add 100 to Selection');
		expect(texts).toContain('Clear Selection');
		expect(texts).toContain('Apply 10% Increase');
	});

	it('should support custom items and pass rich parameters to action callbacks', () => {
		const customAction = vi.fn();
		plugin.setOptions({
			customItems: [
				{ label: 'My Custom Action', action: customAction }
			]
		});

		store.selectRange({ rowId: 'r1', colField: 'name' }, { rowId: 'r2', colField: 'price' });

		testPlugin.activePointer = { rowId: 'r1', colField: 'name' };
		testPlugin.renderMenu(100, 100);

		const menuEl = testPlugin.menuElement as HTMLDivElement;
		const customItemEl = Array.from(menuEl.querySelectorAll('.og-context-menu-item'))
			.find(el => el.textContent === 'My Custom Action') as HTMLDivElement;

		expect(customItemEl).toBeDefined();
		customItemEl.click();

		expect(customAction).toHaveBeenCalled();
		const params = customAction.mock.calls[0][0];
		expect(params.rowId).toBe('r1');
		expect(params.colField).toBe('name');
		expect(params.store).toBe(store);
		expect(params.selection.range).toEqual({
			start: { rowId: 'r1', colField: 'name' },
			end: { rowId: 'r2', colField: 'price' },
		});
		expect(params.selection.bounds).toEqual({
			minRow: 0,
			maxRow: 1,
			minCol: 1,
			maxCol: 2,
		});
	});

	it('should dispatch cellValueChanged event when setting a cell value', () => {
		const spy = vi.fn();
		store.addEventListener('cellValueChanged', spy);
		store.setCellValue('r1', 'price', 999);
		expect(spy).toHaveBeenCalled();
		const event = spy.mock.calls[0][0];
		expect(event.payload).toEqual({
			rowId: 'r1',
			colField: 'price',
			oldValue: 100,
			newValue: 999,
		});
	});
});
