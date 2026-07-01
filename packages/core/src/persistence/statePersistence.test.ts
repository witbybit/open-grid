import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	GRID_STATE_SCHEMA_VERSION,
	applyPersistedState,
	areRowHeightsEqual,
	createLocalStorageAdapter,
	createPersistenceSubscription,
	extractPersistedState,
	preparePersistedGridStateRestore,
	type PersistedGridState,
	type SerializedGridState,
	validateSchemaVersion,
} from './statePersistence.js';
import type { ColumnDef } from '../store.js';
import type { GridInitialState, InternalGridState } from '../state/GridState.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';

function wrapState(state: SerializedGridState): PersistedGridState {
	return { v: GRID_STATE_SCHEMA_VERSION, state };
}

const QUERY_MODEL: GridQueryModel = {
	version: 1,
	root: {
		kind: 'group',
		id: 'root',
		operator: 'and',
		children: [{ kind: 'condition', id: 'q1', columnId: 'name', operator: 'contains', value: 'Alice' }],
	},
};

describe('statePersistence', () => {
	describe('schema versioning', () => {
		it('GRID_STATE_SCHEMA_VERSION is a positive integer', () => {
			expect(GRID_STATE_SCHEMA_VERSION).toBeGreaterThan(0);
			expect(Number.isInteger(GRID_STATE_SCHEMA_VERSION)).toBe(true);
		});

		it('validateSchemaVersion returns null for correct version', () => {
			expect(validateSchemaVersion({ v: GRID_STATE_SCHEMA_VERSION })).toBeNull();
		});

		it('validateSchemaVersion rejects missing version', () => {
			expect(validateSchemaVersion({})).toContain('missing required schema version');
		});

		it('validateSchemaVersion rejects wrong version', () => {
			expect(validateSchemaVersion({ v: 999 })).toContain('schema version mismatch');
		});
	});

	describe('extractPersistedState', () => {
		it('extracts the serializable subset under the versioned state envelope', () => {
			const dummyState = {
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{ field: 'name', header: 'Name', width: 100, hide: true },
					{ field: 'age', header: 'Age', width: 80 },
				] as ColumnDef<any>[],
				columnWidths: { id: 50, name: 100, age: 85 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				filterModel: { age: { type: 'number', operator: 'gt', value: 18 } },
				queryModel: QUERY_MODEL,
				themeName: 'light',
				groupBy: ['age'],
				showGroupFooter: true,
				enableStickyGroupRows: false,
				pinnedColumns: { left: 1, right: 0 },
				selection: null,
				selectedRowIds: ['123'],
				rowHeights: { '1': 45 },
			} as unknown as InternalGridState;

			expect(extractPersistedState(dummyState)).toEqual({
				v: GRID_STATE_SCHEMA_VERSION,
				state: {
					columnOrder: ['id', 'name', 'age'],
					columnVisibility: { name: false },
					columnWidths: { id: 50, name: 100, age: 85 },
					sortModel: [{ colId: 'id', sort: 'asc' }],
					filterModel: { age: { type: 'number', operator: 'gt', value: 18 } },
					queryModel: QUERY_MODEL,
					themeName: 'light',
					groupBy: ['age'],
					showGroupFooter: true,
					enableStickyGroupRows: false,
					pinnedColumns: { left: 1, right: 0 },
				},
			});
		});

		it('omits empty/default persisted fields', () => {
			const dummyState = {
				columns: [{ field: 'id', header: 'ID', width: 50 }] as ColumnDef<any>[],
				columnWidths: {},
				pinnedColumns: { left: 0, right: 0 },
			} as unknown as InternalGridState;

			expect(extractPersistedState(dummyState)).toEqual({
				v: GRID_STATE_SCHEMA_VERSION,
				state: {
					columnOrder: ['id'],
				},
			});
		});
	});

	describe('applyPersistedState', () => {
		const defaultColumns = [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 100 },
			{ field: 'age', header: 'Age', width: 80, hide: true },
		] as ColumnDef<any>[];

		it('rejects malformed or unsupported blobs before applying anything', () => {
			expect(applyPersistedState({} as PersistedGridState, {}, defaultColumns)).toBeNull();
			expect(
				applyPersistedState(
					{ v: GRID_STATE_SCHEMA_VERSION, state: { runtimeOnly: true } as unknown as SerializedGridState },
					{},
					defaultColumns
				)
			).toBeNull();
		});

		it('applies valid persisted fields from the nested state payload', () => {
			const saved = wrapState({
				columnWidths: { id: 60, name: 120, unknownCol: 200 },
				columnOrder: ['age', 'id', 'name'],
				columnVisibility: { name: false, age: true },
				sortModel: [{ colId: 'id', sort: 'desc' }],
				filterModel: { name: { type: 'text', operator: 'contains', value: 'Alice' } },
				queryModel: QUERY_MODEL,
				themeName: 'light',
				groupBy: ['age', 'invalidCol'],
				showGroupFooter: true,
				enableStickyGroupRows: true,
				pinnedColumns: { left: 2, right: 1 },
			});
			const initial: Partial<GridInitialState> = {
				columnWidths: { age: 90 },
			};

			const result = applyPersistedState(saved, initial, defaultColumns)!;

			expect(result.columnWidths).toEqual({ age: 90, id: 60, name: 120 });
			expect(result.columns?.map((column) => column.field)).toEqual(['age', 'id', 'name']);
			expect(result.columns?.[2].hide).toBe(true);
			expect(result.columns?.[0].hide).toBe(false);
			expect(result.sortModel).toEqual([{ colId: 'id', sort: 'desc' }]);
			expect(result.filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'Alice' } });
			expect(result.queryModel).toEqual(QUERY_MODEL);
			expect(result.themeName).toBe('light');
			expect(result.groupBy).toEqual(['age']);
			expect(result.showGroupFooter).toBe(true);
			expect(result.enableStickyGroupRows).toBe(true);
			expect(result.pinnedColumns).toEqual({ left: 2, right: 1 });
		});

		it('round-trips extracted state back into an initial-state merge', () => {
			const gridState = {
				columns: [{ field: 'id', width: 100 }],
				columnWidths: { id: 100 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				pinnedColumns: { left: 0, right: 0 },
			} as any;

			const persisted = extractPersistedState(gridState);
			const result = applyPersistedState(persisted, {}, gridState.columns);

			expect(result).not.toBeNull();
			expect((result as any).columnWidths?.id).toBe(100);
		});
	});

	describe('createLocalStorageAdapter', () => {
		const mockLocalStorage: Record<string, string> = {};

		beforeEach(() => {
			vi.stubGlobal('localStorage', {
				getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
				setItem: vi.fn((key: string, value: string) => {
					mockLocalStorage[key] = value;
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

		it('saves and loads the versioned persisted envelope', () => {
			const adapter = createLocalStorageAdapter('test-key');
			const testState = wrapState({ themeName: 'light', showGroupFooter: true });

			adapter.save(testState);

			expect(localStorage.setItem).toHaveBeenCalledWith('test-key', JSON.stringify(testState));
			expect(adapter.load()).toEqual(testState);
		});

		it('clears stored state and swallows parse errors', () => {
			const adapter = createLocalStorageAdapter('test-key');
			adapter.save(wrapState({ themeName: 'dark' }));
			adapter.clear?.();

			expect(localStorage.removeItem).toHaveBeenCalledWith('test-key');
			expect(adapter.load()).toBeNull();

			mockLocalStorage['test-key'] = '{invalid-json';
			expect(adapter.load()).toBeNull();
		});
	});

	describe('createPersistenceSubscription', () => {
		let mockAdapter: {
			load: ReturnType<typeof vi.fn>;
			save: ReturnType<typeof vi.fn>;
			clear: ReturnType<typeof vi.fn>;
		};
		let subscribeMock: ReturnType<typeof vi.fn>;
		let getGridStateMock: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			vi.useFakeTimers();
			mockAdapter = {
				load: vi.fn(),
				save: vi.fn(),
				clear: vi.fn(),
			};
			subscribeMock = vi.fn((_key: string, listener: () => void) => () => {});
			getGridStateMock = vi.fn(() => wrapState({ themeName: 'light' }));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('subscribes to relevant persistence keys', () => {
			createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock);

			expect(subscribeMock).toHaveBeenCalledWith('columns', expect.any(Function));
			expect(subscribeMock).toHaveBeenCalledWith('columnWidths', expect.any(Function));
			expect(subscribeMock).toHaveBeenCalledWith('themeName', expect.any(Function));
		});

		it('debounces saves and reports saved status', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);

			trigger!();
			trigger!();
			expect(mockAdapter.save).not.toHaveBeenCalled();

			vi.advanceTimersByTime(100);

			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
			expect(controller.getStatus().status).toBe('saved');
		});

		it('suppresses autosave inside suspendAutoSave', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);

			controller.suspendAutoSave(() => {
				trigger!();
				vi.advanceTimersByTime(100);
			});

			expect(mockAdapter.save).not.toHaveBeenCalled();
		});

		it('supports disabling auto-save and saveNow', () => {
			let trigger: (() => void) | null = null;
			subscribeMock = vi.fn((key: string, listener: () => void) => {
				if (key === 'themeName') trigger = listener;
				return () => {};
			});

			const controller = createPersistenceSubscription(mockAdapter, subscribeMock, getGridStateMock, 100);
			controller.setAutoSave(false);
			trigger!();
			vi.advanceTimersByTime(100);
			expect(mockAdapter.save).not.toHaveBeenCalled();

			controller.setAutoSave(true);
			controller.saveNow();
			expect(mockAdapter.save).toHaveBeenCalledTimes(1);
		});

		it('updates status on async save resolve/reject', async () => {
			let resolvePromise: (() => void) | undefined;
			let rejectPromise: ((reason?: unknown) => void) | undefined;

			mockAdapter.save = vi.fn().mockImplementation(() => {
				return new Promise<void>((resolve, reject) => {
					resolvePromise = resolve;
					rejectPromise = reject;
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

			resolvePromise?.();
			await vi.runAllTimersAsync();
			expect(controller.getStatus().status).toBe('saved');

			trigger!();
			vi.advanceTimersByTime(100);
			rejectPromise?.(new Error('network error'));
			await vi.runAllTimersAsync();
			expect(controller.getStatus().status).toBe('error');
			expect(controller.getStatus().error).toBeDefined();
		});

		it('flushes pending save on destroy', () => {
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

	describe('preparePersistedGridStateRestore', () => {
		const makeCurrent = (partial?: Partial<InternalGridState>): InternalGridState =>
			({
				columns: [
					{ field: 'id', header: 'ID', width: 100 },
					{ field: 'name', header: 'Name', width: 150 },
				],
				columnWidths: {},
				sortModel: null,
				filterModel: null,
				groupBy: [],
				showGroupFooter: false,
				enableStickyGroupRows: false,
				pinnedColumns: { left: 0, right: 0 },
				...partial,
			}) as InternalGridState;

		it('rejects malformed payloads and returns ok: false', () => {
			const result = preparePersistedGridStateRestore({ v: GRID_STATE_SCHEMA_VERSION } as PersistedGridState, makeCurrent());
			expect(result.ok).toBe(false);
		});

		it('returns ok: true with stateMutation containing all valid persisted fields', () => {
			const saved = wrapState({
				columnOrder: ['name', 'id'],
				columnVisibility: { name: true, id: false },
				columnWidths: { id: 50 },
				sortModel: [{ colId: 'id', sort: 'asc' }],
				filterModel: { id: { type: 'text', operator: 'equals', value: '1' } },
				queryModel: QUERY_MODEL,
				themeName: 'light',
				groupBy: ['name'],
				showGroupFooter: true,
				enableStickyGroupRows: false,
				pinnedColumns: { left: 1, right: 0 },
			});

			const result = preparePersistedGridStateRestore(saved, makeCurrent());

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const { stateMutation } = result.restore;
			expect(stateMutation.columns?.map((c) => c.field)).toEqual(['name', 'id']);
			expect(stateMutation.columns?.find((c) => c.field === 'id')?.hide).toBe(true);
			expect(stateMutation.columnWidths?.['id']).toBe(50);
			expect(stateMutation.sortModel).toEqual([{ colId: 'id', sort: 'asc' }]);
			expect(stateMutation.queryModel).toEqual(QUERY_MODEL);
			expect(stateMutation.themeName).toBe('light');
			expect(stateMutation.groupBy).toContain('name');
			expect(stateMutation.showGroupFooter).toBe(true);
			expect(stateMutation.pinnedColumns).toEqual({ left: 1, right: 0 });
		});

		it('omits unknown column fields from stateMutation', () => {
			const saved = wrapState({
				columnWidths: { id: 120, unknown: 180 },
			});

			const result = preparePersistedGridStateRestore(saved, makeCurrent());

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const { stateMutation } = result.restore;
			expect(stateMutation.columnWidths?.['id']).toBe(120);
			expect(stateMutation.columnWidths?.['unknown']).toBeUndefined();
		});
	});

	describe('areRowHeightsEqual', () => {
		it('returns true for identical records', () => {
			expect(areRowHeightsEqual({ '1': 40, '2': 50 }, { '1': 40, '2': 50 })).toBe(true);
		});

		it('returns false for mismatched keys or values', () => {
			expect(areRowHeightsEqual({ '1': 40 }, { '1': 40, '2': 50 })).toBe(false);
			expect(areRowHeightsEqual({ '1': 40 }, { '1': 42 })).toBe(false);
		});
	});
});
