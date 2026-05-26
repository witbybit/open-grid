import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridStore } from './store.js';
import { ClientRowModelController } from './rowModel.js';
import { GridContextMenuPlugin } from './contextMenu.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

describe('GridContextMenuPlugin', () => {
	let store: GridStore<TestRow>;
	let rowController: ClientRowModelController<TestRow>;
	let plugin: GridContextMenuPlugin<TestRow>;

	beforeEach(() => {
		// Mock browser globals for safe running during tests
		if (typeof window === 'undefined') {
			globalThis.window = {
				innerWidth: 1024,
				innerHeight: 768,
				addEventListener: () => {},
				removeEventListener: () => {},
			} as any;
		}

		if (typeof document === 'undefined') {
			const createMockElement = (tagName: string) => {
				const children: any[] = [];
				const listeners: Record<string, Function[]> = {};
				const el = {
					tagName: tagName.toUpperCase(),
					style: {},
					classList: {
						classes: new Set<string>(),
						add(cls: string) { this.classes.add(cls); },
						remove(cls: string) { this.classes.delete(cls); },
						contains(cls: string) { return this.classes.has(cls); },
					},
					get className() {
						return Array.from(this.classList.classes).join(' ');
					},
					set className(val: string) {
						this.classList.classes.clear();
						val.split(' ').forEach(cls => {
							if (cls.trim()) this.classList.classes.add(cls.trim());
						});
					},
					children,
					appendChild(child: any) {
						child.parentNode = el;
						children.push(child);
						return child;
					},
					remove() {
						if (el.parentNode && el.parentNode.children) {
							const idx = el.parentNode.children.indexOf(el);
							if (idx !== -1) el.parentNode.children.splice(idx, 1);
						}
					},
					addEventListener(event: string, cb: Function) {
						if (!listeners[event]) listeners[event] = [];
						listeners[event].push(cb);
					},
					removeEventListener(event: string, cb: Function) {
						if (listeners[event]) {
							const idx = listeners[event].indexOf(cb);
							if (idx !== -1) listeners[event].splice(idx, 1);
						}
					},
					click() {
						if (listeners['click']) {
							listeners['click'].forEach(cb => cb({ stopPropagation: () => {} }));
						}
					},
					get textContent() {
						return el._textContent || '';
					},
					set textContent(val: string) {
						el._textContent = val;
					},
					_textContent: '',
					parentNode: null as any,
					querySelectorAll(selector: string) {
						if (selector.startsWith('.')) {
							const cls = selector.substring(1);
							const matches: any[] = [];
							const traverse = (node: any) => {
								if (node.classList && node.classList.contains(cls)) {
									matches.push(node);
								}
								if (node.children) {
									node.children.forEach(traverse);
								}
							};
							traverse(el);
							return matches;
						}
						return [];
					}
				};
				return el;
			};

			globalThis.document = {
				createElement: (tagName: string) => createMockElement(tagName),
				body: createMockElement('body'),
				addEventListener: () => {},
				removeEventListener: () => {},
			} as any;
		}

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
	});

	afterEach(() => {
		rowController.dispose();
		plugin.onDestroy();
	});

	it('should register successfully and expose API methods', () => {
		const contextMenuPlugin = store.getPlugin<GridContextMenuPlugin<TestRow>>('contextMenu');
		expect(contextMenuPlugin).not.toBeNull();
		
		expect((store as any).showContextMenu).toBeDefined();
		expect((store as any).hideContextMenu).toBeDefined();
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
		(plugin as any).copySelectedRange(params);

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

		(plugin as any).clearSelection(params);

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

		(plugin as any).add100ToSelection(params);

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

		(plugin as any).apply10PercentIncrease(params);

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
		(plugin as any).activePointer = { rowId: 'r1', colField: 'name' };
		(plugin as any).renderMenu(100, 100);

		const menuEl = (plugin as any).menuElement as HTMLDivElement;
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

		(plugin as any).activePointer = { rowId: 'r1', colField: 'name' };
		(plugin as any).renderMenu(100, 100);

		const menuEl = (plugin as any).menuElement as HTMLDivElement;
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
