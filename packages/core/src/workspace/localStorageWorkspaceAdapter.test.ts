import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID_STATE_SCHEMA_VERSION } from '../persistence/statePersistence.js';
import { createLocalStorageWorkspaceAdapter } from './localStorageWorkspaceAdapter.js';
import type { GridViewDefinition } from './workspaceTypes.js';

const STORAGE_KEY = 'workspace-views';

function createView(id = 'view-1'): GridViewDefinition {
	return {
		id,
		name: `View ${id}`,
		scope: 'personal',
		createdAt: 1,
		updatedAt: 2,
		version: 1,
		state: {
			v: GRID_STATE_SCHEMA_VERSION,
			state: { columnOrder: ['id'] },
		},
	};
}

describe('createLocalStorageWorkspaceAdapter', () => {
	const storage: Record<string, string> = {};

	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: vi.fn((key: string) => storage[key] ?? null),
			setItem: vi.fn((key: string, value: string) => {
				storage[key] = value;
			}),
			removeItem: vi.fn((key: string) => {
				delete storage[key];
			}),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		for (const key of Object.keys(storage)) delete storage[key];
	});

	it('round-trips valid views and default ids', async () => {
		const adapter = createLocalStorageWorkspaceAdapter({ storageKey: STORAGE_KEY });
		const view = createView();

		await adapter.saveView(view);
		await adapter.setDefaultView?.(view.id);

		expect(await adapter.listViews()).toEqual([view]);
		expect(await adapter.getView(view.id)).toEqual(view);
		expect(await adapter.getDefaultView?.()).toBe(view.id);
	});

	it('returns only complete, schema-compatible views from mixed stored entries', async () => {
		const valid = createView('valid');
		storage[STORAGE_KEY] = JSON.stringify([
			valid,
			{},
			{ ...createView('missing-name'), name: undefined },
			{ ...createView('wrong-version'), state: { v: GRID_STATE_SCHEMA_VERSION + 1, state: {} } },
			{ ...createView('bad-nested-state'), state: { v: GRID_STATE_SCHEMA_VERSION, state: { columnWidths: { id: 0 } } } },
			{ ...createView('bad-metadata'), metadata: [] },
		]);

		const adapter = createLocalStorageWorkspaceAdapter({ storageKey: STORAGE_KEY });
		expect(await adapter.listViews()).toEqual([valid]);
		expect(await adapter.getView('wrong-version')).toBeNull();
	});

	it.each(['{invalid-json', JSON.stringify({ id: 'not-an-array' }), JSON.stringify(null)])(
		'returns an empty list for malformed or non-array storage (%s)',
		async (raw) => {
			storage[STORAGE_KEY] = raw;
			const adapter = createLocalStorageWorkspaceAdapter({ storageKey: STORAGE_KEY });

			await expect(adapter.listViews()).resolves.toEqual([]);
			await expect(adapter.getView('anything')).resolves.toBeNull();
		}
	);

	it('treats unavailable browser storage as an empty no-op adapter', async () => {
		vi.stubGlobal('localStorage', undefined);
		const adapter = createLocalStorageWorkspaceAdapter({ storageKey: STORAGE_KEY });

		await expect(adapter.listViews()).resolves.toEqual([]);
		await expect(adapter.saveView(createView())).resolves.toBeUndefined();
		await expect(adapter.deleteView('view-1')).resolves.toBeUndefined();
		await expect(adapter.getDefaultView?.()).resolves.toBeNull();
		await expect(adapter.setDefaultView?.('view-1')).resolves.toBeUndefined();
	});

	it('swallows unavailable-storage and quota failures across adapter methods', async () => {
		const failure = new Error('storage unavailable');
		vi.stubGlobal('localStorage', {
			getItem: vi.fn(() => {
				throw failure;
			}),
			setItem: vi.fn(() => {
				throw failure;
			}),
			removeItem: vi.fn(() => {
				throw failure;
			}),
		});
		const adapter = createLocalStorageWorkspaceAdapter({ storageKey: STORAGE_KEY });

		await expect(adapter.listViews()).resolves.toEqual([]);
		await expect(adapter.getView('view-1')).resolves.toBeNull();
		await expect(adapter.saveView(createView())).resolves.toBeUndefined();
		await expect(adapter.deleteView('view-1')).resolves.toBeUndefined();
		await expect(adapter.getDefaultView?.()).resolves.toBeNull();
		await expect(adapter.setDefaultView?.('view-1')).resolves.toBeUndefined();
		await expect(adapter.setDefaultView?.(null)).resolves.toBeUndefined();
	});
});
