import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	extractPersistedState,
	applyPersistedState,
	createLocalStorageAdapter,
	createPersistenceSubscription,
	areRowHeightsEqual,
	applyPersistedStateToApi,
	validateSchemaVersion,
	GRID_STATE_SCHEMA_VERSION,
	type PersistedGridState,
} from './statePersistence.js';
import type { GridState, ColumnDef } from '../store.js';

describe('statePersistence', () => {
	describe('schema versioning', () => {
		it('GRID_STATE_SCHEMA_VERSION is a positive integer', () => {
			expect(GRID_STATE_SCHEMA_VERSION).toBeGreaterThan(0);
			expect(Number.isInteger(GRID_STATE_SCHEMA_VERSION)).toBe(true);
		});

		it('validateSchemaVersion returns null for correct version', () => {
			expect(validateSchemaVersion({ v: GRID_STATE_SCHEMA_VERSION })).toBeNull();
		});

		it('validateSchemaVersion returns null for missing version (legacy blob) with a warning', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			expect(validateSchemaVersion({})).toBeNull();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no schema version'));
			warnSpy.mockRestore();
		});

		it('validateSchemaVersion returns error string for wrong version', () => {
			const result = validateSchemaVersion({ v: 999 });
			expect(result).not.toBeNull();
			expect(result).toContain('version mismatch');
		});

		it('extractPersistedState stamps the current schema version', () => {
			const state = {
				columns: [{ field: 'id' }],
				columnWidths: {},
				pinnedColumns: { left: 0, right: 0 },
			} as any;
			const persisted = extractPersistedState(state);
			expect(persisted.v).toBe(GRID_STATE_SCHEMA_VERSION);
		});

		it('applyPersistedState returns null for version-mismatched blob', () => {
			const columns = [{ field: 'id' }] as any[];
			const result = applyPersistedState({ v: 999, columnWidths: { id: 100 } }, {}, columns);
			expect(result).toBeNull();
		});

		it('applyPersistedState returns state object for correct version', () => {
			const columns = [{ field: 'id' }] as any[];
			const result = applyPersistedState({ v: GRID_STATE_SCHEMA_VERSION }, {}, columns);
			expect(result).not.toBeNull();
		});

		it('applyPersistedState accepts legacy blob (no v) with console.warn', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const columns = [{ field: 'id' }] as any[];
			const result = applyPersistedState({}, {}, columns);
			expect(result).not.toBeNull();
			expect(warnSpy).toHaveBeenCalled();
			warnSpy.mockRestore();
		});

		it('applyPersistedStateToApi returns false for version-mismatched blob', () => {
			const mockApi = {
				getState: vi.fn(() => ({ columns: [{ field: 'id' }] })),
				setColumnOrder: vi.fn(),
				setColumnsVisible: vi.fn(),
				setColumnWidth: vi.fn(),
				setSortModel: vi.fn(),
				setFilterModel: vi.fn(),
				switchTheme: vi.fn(),
				setGroupBy: vi.fn(),
				setShowGroupFooter: vi.fn(),
				setStickyGroupRows: vi.fn(),
				setPinnedColumns: vi.fn(),
			};
			expect(applyPersistedStateToApi(mockApi, { v: 999 })).toBe(false);
			expect(mockApi.setColumnOrder).not.toHaveBeenCalled();
		});

		it('applyPersistedStateToApi returns true for correct version', () => {
			const mockApi = {
				getState: vi.fn(() => ({ columns: [{ field: 'id' }] })),
				setColumnOrder: vi.fn(),
				setColumnsVisible: vi.fn(),
				setColumnWidth: vi.fn(),
				setSortModel: vi.fn(),
				setFilterModel: vi.fn(),
				switchTheme: vi.fn(),
				setGroupBy: vi.fn(),
				setShowGroupFooter: vi.fn(),
				setStickyGroupRows: vi.fn(),
				setPinnedColumns: vi.fn(),
			};
			expect(applyPersistedStateToApi(mockApi, { v: GRID_STATE_SCHEMA_VERSION })).toBe(true);
		});

		it('round-trip: extractPersistedState → applyPersistedState succeeds', () => {
			const gridState = {
				columns: [{ field: 'id', width: 100 }],
				columnWidths: { id: 100 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				pinnedColumns: { left: 0, right: 0 },
			} as any;
			const persisted = extractPersistedState(gridState);
			expect(persisted.v).toBe(GRID_STATE_SCHEMA_VERSION);
			const result = applyPersistedState(persisted, {}, gridState.columns);
			expect(result).not.toBeNull();
			expect((result as any).columnWidths?.id).toBe(100);
		});
	});

	describe('extractPersistedState', () => {
		it('should extract correct subset of GridState for persistence', () => {
			const dummyState = {
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{ field: 'name', header: 'Name', width: 100, hide: true },
					{ field: 'age', header: 'Age', width: 80 },
				] as ColumnDef<any>[],
				columnWidths: { id: 50, name: 100, age: 85 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				filterModel: { age: { type: 'number', operator: 'gt', value: 18 } },
				themeName: 'light',
				groupBy: ['age'],
				showGroupFooter: true,
				enableStickyGroupRows: false,
				pinnedColumns: { left: 1, right: 0 },
				// Excluded properties:
				selection: null,
				selectedRowIds: ['123'],
				rowHeights: { '1': 45 },
			} as unknown as GridState;

			const result = extractPersistedState(dummyState);

			expect(result).toEqual({
				v: GRID_STATE_SCHEMA_VERSION,
				columnOrder: ['id', 'name', 'age'],
				columnVisibility: { name: false },
				columnWidths: { id: 50, name: 100, age: 85 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				filterModel: { age: { type: 'number', operator: 'gt', value: 18 } },
				themeName: 'light',
				groupBy: ['age'],
				showGroupFooter: true,
				enableStickyGroupRows: false,
				pinnedColumns: { left: 1, right: 0 },
			});
		});

		it('should omit undefined/default properties when they are not present/empty', () => {
			const dummyState = {
				columns: [{ field: 'id', header: 'ID', width: 50 }] as ColumnDef<any>[],
				columnWidths: {},
				pinnedColumns: { left: 0, right: 0 },
			} as unknown as GridState;

			const result = extractPersistedState(dummyState);

			expect(result.columnWidths).toBeUndefined();
			expect(result.columnVisibility).toBeUndefined();
			expect(result.pinnedColumns).toBeUndefined();
		});
	});

	describe('applyPersistedState', () => {
		const defaultColumns = [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 100 },
			{ field: 'age', header: 'Age', width: 80, hide: true },
		] as ColumnDef<any>[];

		it('should merge valid column widths', () => {
			const saved: PersistedGridState = {
				columnWidths: { id: 60, name: 120, unknownCol: 200 },
			};
			const initial: Partial<GridState> = {
				columnWidths: { age: 90 },
			};

			const result = applyPersistedState(saved, initial, defaultColumns);

			expect(result.columnWidths).toEqual({
				age: 90,
				id: 60,
				name: 120,
			});
		});

		it('should apply column order if saved order is fully valid and complete', () => {
			const saved: PersistedGridState = {
				columnOrder: ['age', 'id', 'name'],
			};
			const initial: Partial<GridState> = {};

			const result = applyPersistedState(saved, initial, defaultColumns);

			expect(result.columns?.map((c) => c.field)).toEqual(['age', 'id', 'name']);
		});

		it('should reject column order if saved order has length mismatch or invalid fields', () => {
			const saved: PersistedGridState = {
				columnOrder: ['age', 'id'], // incomplete
			};
			const initial: Partial<GridState> = {};

			const result = applyPersistedState(saved, initial, defaultColumns);

			expect(result.columns).toBeUndefined();
		});

		it('should apply column visibility using hidden rules', () => {
			const saved: PersistedGridState = {
				columnVisibility: { name: false, age: true },
			};
			const initial: Partial<GridState> = {};

			const result = applyPersistedState(saved, initial, defaultColumns);

			expect(result.columns?.[0].hide).toBeUndefined(); // id
			expect(result.columns?.[1].hide).toBe(true); // name (mapped false to hide: true)
			expect(result.columns?.[2].hide).toBe(false); // age (was default hide: true, overridden to false)
		});

		it('should validate and apply sortModel, filterModel, themeName, groupBy, and other settings', () => {
			const saved: PersistedGridState = {
				sortModel: [{ colId: 'id', sort: 'desc' }],
				filterModel: { name: { type: 'text', operator: 'contains', value: 'Alice' } },
				themeName: 'light',
				groupBy: ['age', 'invalidCol'],
				showGroupFooter: true,
				enableStickyGroupRows: true,
				pinnedColumns: { left: 2, right: 1 },
			};
			const initial: Partial<GridState> = {};

			const result = applyPersistedState(saved, initial, defaultColumns);

			expect(result.sortModel).toEqual([{ colId: 'id', sort: 'desc' }]);
			expect(result.filterModel).toBeDefined();
			expect(result.themeName).toBe('light');
			expect(result.groupBy).toEqual(['age']);
			expect(result.showGroupFooter).toBe(true);
			expect(result.enableStickyGroupRows).toBe(true);
			expect(result.pinnedColumns).toEqual({ left: 2, right: 1 });
		});

		it('should reject invalid theme names', () => {
			const saved: PersistedGridState = {
				themeName: 'invalid-theme' as any,
			};
			const initial: Partial<GridState> = {};

			const result = applyPersistedState(saved, initial, defaultColumns);

			expect(result.themeName).toBeUndefined();
		});
	});

	describe('createLocalStorageAdapter', () => {
		const mockLocalStorage: Record<string, string> = {};

		beforeEach(() => {
			vi.stubGlobal('localStorage', {
				getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
				setItem: vi.fn((key: string, val: string) => {
					mockLocalStorage[key] = val;
				}),
				removeItem: vi.fn((key: string) => {
					delete mockLocalStorage[key];
				}),
			});
		});

		afterEach(() => {
			vi.unstubAllGlobals();
			for (const key of Object.keys(mockLocalStorage)) {
				delete mockLocalStorage[key];
			}
		});

		it('should load null if no key exists', () => {
			const adapter = createLocalStorageAdapter('test-key');
			expect(adapter.load()).toBeNull();
		});

		it('should save and load state', () => {
			const adapter = createLocalStorageAdapter('test-key');
			const testState: PersistedGridState = { v: GRID_STATE_SCHEMA_VERSION, themeName: 'light', showGroupFooter: true };
			adapter.save(testState);

			expect(localStorage.setItem).toHaveBeenCalledWith('test-key', JSON.stringify(testState));
			expect(adapter.load()).toEqual(testState);
		});

		it('should clear stored state', () => {
			const adapter = createLocalStorageAdapter('test-key');
			adapter.save({ themeName: 'dark' });
			adapter.clear?.();

			expect(localStorage.removeItem).toHaveBeenCalledWith('test-key');
			expect(adapter.load()).toBeNull();
		});

		it('should catch parsing errors and return null', () => {
			mockLocalStorage['test-key'] = '{invalid-json';
			const adapter = createLocalStorageAdapter('test-key');
			expect(adapter.load()).toBeNull();
		});
	});

	describe('createPersistenceSubscription', () => {
		let mockAdapter: any;
		let subscribeMock: any;
		let getGridStateMock: any;

		beforeEach(() => {
			vi.useFakeTimers();
			mockAdapter = {
				load: vi.fn(),
				save: vi.fn(),
				clear: vi.fn(),
			};
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				return () => {}; // unsubscribe mock
			});
			getGridStateMock = vi.fn(() => ({
				themeName: 'light',
			}));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should subscribe to relevant persistence keys', () => {
			createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock);

			expect(subscribeMock).toHaveBeenCalledWith('columns', expect.any(Function));
			expect(subscribeMock).toHaveBeenCalledWith('columnWidths', expect.any(Function));
			expect(subscribeMock).toHaveBeenCalledWith('themeName', expect.any(Function));
		});

		it('should debounce save calls', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);

			expect(trigger).toBeDefined();

			trigger!();
			trigger!();

			expect(mockAdapter.save).not.toHaveBeenCalled();

			vi.advanceTimersByTime(100);

			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
			expect(controller.getStatus().status).toBe('saved');
		});

		it('should support disabling auto-save', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);
			controller.setAutoSave(false);

			expect(controller.isAutoSaveEnabled()).toBe(false);

			trigger!();
			vi.advanceTimersByTime(100);

			expect(mockAdapter.save).not.toHaveBeenCalled();
		});

		it('should immediately save on saveNow()', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);

			trigger!();
			controller.saveNow();

			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
			expect(controller.getStatus().status).toBe('saved');

			// Check that debounced execution doesn't run again
			vi.advanceTimersByTime(100);
			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
		});

		it('should update status on async save resolve/reject', async () => {
			let resolvePromise: any;
			let rejectPromise: any;

			mockAdapter.save = vi.fn().mockImplementation(() => {
				return new Promise((res, rej) => {
					resolvePromise = res;
					rejectPromise = rej;
				});
			});

			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);

			trigger!();
			vi.advanceTimersByTime(100);

			expect(controller.getStatus().status).toBe('saving');

			resolvePromise();
			await vi.runAllTimersAsync();

			expect(controller.getStatus().status).toBe('saved');

			// Test error handling
			trigger!();
			vi.advanceTimersByTime(100);
			expect(controller.getStatus().status).toBe('saving');

			rejectPromise(new Error('network error'));
			await vi.runAllTimersAsync();

			expect(controller.getStatus().status).toBe('error');
			expect(controller.getStatus().error).toBeDefined();
		});

		it('should call status listeners on status change', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);
			const listener = vi.fn();
			const unsub = controller.onStatusChange(listener);

			trigger!();
			vi.advanceTimersByTime(100);

			expect(listener).toHaveBeenCalled();

			unsub();
		});

		it('should flush pending save on destroy', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);
			trigger!();
			controller.destroy();

			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
		});
	});

	describe('areRowHeightsEqual', () => {
		it('should return true for identical objects', () => {
			expect(areRowHeightsEqual({ '1': 40, '2': 50 }, { '1': 40, '2': 50 })).toBe(true);
		});

		it('should return false if keys mismatch', () => {
			expect(areRowHeightsEqual({ '1': 40 }, { '1': 40, '2': 50 })).toBe(false);
		});

		it('should return false if values mismatch', () => {
			expect(areRowHeightsEqual({ '1': 40 }, { '1': 42 })).toBe(false);
		});
	});

	describe('applyPersistedStateToApi', () => {
		it('should invoke API methods for valid saved keys', () => {
			const mockApi = {
				getState: vi.fn(() => ({
					columns: [{ field: 'id' }, { field: 'name' }],
				})),
				setColumnOrder: vi.fn(),
				setColumnsVisible: vi.fn(),
				setColumnWidth: vi.fn(),
				setSortModel: vi.fn(),
				setFilterModel: vi.fn(),
				switchTheme: vi.fn(),
				setGroupBy: vi.fn(),
				setShowGroupFooter: vi.fn(),
				setStickyGroupRows: vi.fn(),
				setPinnedColumns: vi.fn(),
			};

			const saved: PersistedGridState = {
				v: GRID_STATE_SCHEMA_VERSION,
				columnOrder: ['name', 'id'],
				columnVisibility: { name: true, id: false },
				columnWidths: { id: 50 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				filterModel: { id: { type: 'text', operator: 'equals', value: '1' } },
				themeName: 'light',
				groupBy: ['name'],
				showGroupFooter: true,
				enableStickyGroupRows: false,
				pinnedColumns: { left: 1, right: 0 },
			};

			applyPersistedStateToApi(mockApi, saved);

			expect(mockApi.setColumnOrder).toHaveBeenCalledWith(['name', 'id']);
			expect(mockApi.setColumnsVisible).toHaveBeenCalledWith(['id'], false);
			expect(mockApi.setColumnsVisible).toHaveBeenCalledWith(['name'], true);
			expect(mockApi.setColumnWidth).toHaveBeenCalledWith('id', 50);
			expect(mockApi.setSortModel).toHaveBeenCalledWith([{ colId: 'id', sort: 'asc' }]);
			expect(mockApi.setFilterModel).toHaveBeenCalledWith(saved.filterModel);
			expect(mockApi.switchTheme).toHaveBeenCalledWith('light');
			expect(mockApi.setGroupBy).toHaveBeenCalledWith(['name']);
			expect(mockApi.setShowGroupFooter).toHaveBeenCalledWith(true);
			expect(mockApi.setStickyGroupRows).toHaveBeenCalledWith(false);
			expect(mockApi.setPinnedColumns).toHaveBeenCalledWith({ left: 1, right: 0 });
		});

		it('rolls back to the pre-restore snapshot if a setter throws mid-apply', () => {
			const mockApi = {
				getState: vi.fn(() => ({
					columns: [{ field: 'id' }, { field: 'name' }],
					columnWidths: { id: 75 },
					sortModel: [{ colId: 'name', sort: 'desc' }],
					filterModel: null,
					themeName: 'dark',
					groupBy: [],
					showGroupFooter: false,
					enableStickyGroupRows: true,
					pinnedColumns: { left: 0, right: 0 },
				})),
				setColumnOrder: vi.fn(),
				setColumnsVisible: vi.fn(),
				setColumnWidth: vi
					.fn()
					.mockImplementationOnce(() => undefined)
					.mockImplementationOnce(() => {
						throw new Error('boom');
					})
					.mockImplementation(() => undefined),
				setSortModel: vi.fn(),
				setFilterModel: vi.fn(),
				switchTheme: vi.fn(),
				setGroupBy: vi.fn(),
				setShowGroupFooter: vi.fn(),
				setStickyGroupRows: vi.fn(),
				setPinnedColumns: vi.fn(),
			};

			const result = applyPersistedStateToApi(mockApi, {
				v: GRID_STATE_SCHEMA_VERSION,
				columnWidths: { id: 120, name: 180 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				themeName: 'light',
			});

			expect(result).toBe(false);
			expect(mockApi.setColumnWidth).toHaveBeenNthCalledWith(1, 'id', 120);
			expect(mockApi.setColumnWidth).toHaveBeenNthCalledWith(3, 'id', 75);
			expect(mockApi.setSortModel).not.toHaveBeenCalledWith([{ colId: 'id', sort: 'asc' }]);
			expect(mockApi.setSortModel).toHaveBeenCalledWith([{ colId: 'name', sort: 'desc' }]);
			expect(mockApi.switchTheme).toHaveBeenCalledWith('dark');
		});
	});
});
