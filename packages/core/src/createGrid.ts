import { ClientRowModelController, type ClientRowModelOptions } from './rowModel.js';
import type { RowValidator } from './features/ValidationManager.js';
import { InfiniteRowModelController, type InfiniteRowModelOptions } from './infiniteRowModel.js';
import { ServerPageRowModelController, type ServerPageRowModelOptions } from './serverPageRowModel.js';
import { GridStore as GridRuntime } from './store.js';
import type { GridApi, RowSelectionMode, RowSelectionOptions } from './api/GridApi.js';
import type { ColumnDef } from './columnDef.js';
import type { GridInitialState } from './state/GridState.js';
import {
	type GridPersistenceAdapter,
	type PersistedGridState,
	type PersistenceController,
	createLocalStorageAdapter,
	createPersistenceSubscription,
} from './persistence/statePersistence.js';
import { createGridRuntimeComposition } from './internal/createGridRuntimeComposition.js';
import type { GridWorkspaceAdapter } from './workspace/workspaceTypes.js';
import { type GridWorkspaceController, createWorkspaceController } from './workspace/GridWorkspaceController.js';

export type { GridPersistenceAdapter, PersistedGridState };
export { createLocalStorageAdapter };
export type { GridWorkspaceAdapter };
export { createWorkspaceController };

export interface ClientGridOptions<TRowData> extends ClientRowModelOptions<TRowData> {
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridInitialState<TRowData>>;
	/**
	 * Enable first-class row selection. When set to `'multiple'`, a built-in checkbox
	 * column is automatically prepended and pinned to the left — no need to add a
	 * `checkboxSelection: true` column manually. Works like AG Grid's `rowSelection` prop.
	 *
	 * @example
	 * useClientGrid({ rows, columns, rowSelection: 'multiple' })
	 */
	rowSelection?: RowSelectionMode | RowSelectionOptions;
	/**
	 * Persistence adapter. Pass `createLocalStorageAdapter(key)` for the built-in
	 * localStorage implementation, or supply your own for remote/API-backed storage.
	 *
	 * @example localStorage
	 * persistence: createLocalStorageAdapter('my-grid')
	 *
	 * @example Remote API
	 * persistence: {
	 *   async load() { return fetch('/api/grid-prefs').then(r => r.json()); },
	 *   async save(state) { await fetch('/api/grid-prefs', { method: 'PUT', body: JSON.stringify(state) }); },
	 *   async clear() { await fetch('/api/grid-prefs', { method: 'DELETE' }); },
	 * }
	 */
	persistence?: string | GridPersistenceAdapter;
	workspace?: GridWorkspaceAdapter;
	/** Grid-level cross-field validator — see RowValidator for details. */
	rowValidator?: RowValidator<TRowData>;
}

/** Options for creating an infinite (block/range loading) grid. */
export interface InfiniteGridOptions<TRowData> extends InfiniteRowModelOptions<TRowData> {
	initialState?: Partial<GridInitialState<TRowData>>;
	rowSelection?: RowSelectionMode | RowSelectionOptions;
	persistence?: string | GridPersistenceAdapter;
	workspace?: GridWorkspaceAdapter;
	rowValidator?: RowValidator<TRowData>;
}

/** Options for creating a server-page (explicit page loading) grid. */
export interface ServerPageGridOptions<TRowData> extends ServerPageRowModelOptions<TRowData> {
	initialState?: Partial<GridInitialState<TRowData>>;
	rowSelection?: RowSelectionMode | RowSelectionOptions;
	persistence?: string | GridPersistenceAdapter;
	workspace?: GridWorkspaceAdapter;
	rowValidator?: RowValidator<TRowData>;
}

function buildColumnWidths<TRowData>(columns: Array<ColumnDef<TRowData>>): Record<string, number> {
	return columns.reduce<Record<string, number>>((acc, column) => {
		if (column.width !== undefined) acc[column.field] = column.width;
		return acc;
	}, {});
}

function normalizeRowSelection(rowSelection?: RowSelectionMode | RowSelectionOptions): RowSelectionOptions | undefined {
	if (!rowSelection) return undefined;
	if (typeof rowSelection === 'string') return { mode: rowSelection, selectAllScope: 'page' };
	return { selectAllScope: 'page', ...rowSelection };
}

function withRowSelectionColumn<TRowData>(
	columns: Array<ColumnDef<TRowData>>,
	initialState: Partial<GridInitialState<TRowData>>,
	rowSelection?: RowSelectionMode | RowSelectionOptions
): { columns: Array<ColumnDef<TRowData>>; initialState: Partial<GridInitialState<TRowData>> } {
	const normalized = normalizeRowSelection(rowSelection);
	if (!normalized) return { columns, initialState };

	let nextColumns = columns;
	let nextInitial: Partial<GridInitialState<TRowData>> = { ...initialState, rowSelection: normalized };
	if (normalized.mode === 'multiple' && !columns.some((column) => column.checkboxSelection)) {
		const checkboxCol = {
			field: '__rowSelect__',
			header: '',
			width: 40,
			checkboxSelection: true,
			sortable: false,
			movable: false,
		} as unknown as ColumnDef<TRowData>;
		nextColumns = [checkboxCol, ...columns];
		nextInitial = {
			...nextInitial,
			pinnedColumns: {
				left: (nextInitial.pinnedColumns?.left ?? 0) + 1,
				right: nextInitial.pinnedColumns?.right ?? 0,
			},
		};
	}
	if (normalized.mode === 'multiple') {
		nextInitial = { ...nextInitial, columns: nextColumns };
	}
	return { columns: nextColumns, initialState: nextInitial };
}

function wireGridWorkspace<TRowData>(
	options: { workspace?: GridWorkspaceAdapter },
	runtime: GridRuntime<TRowData>,
	persistenceController?: PersistenceController
): GridWorkspaceController | undefined {
	if (!options.workspace) return undefined;
	const controller = createWorkspaceController(options.workspace);

	// When persistence auto-saves, also update the active writable view
	if (persistenceController) {
		persistenceController.onStatusChange((status) => {
			if (status.status === 'saved') {
				const activeId = controller.getActiveWritableViewId();
				if (activeId) {
					controller.updateView(activeId, runtime.getGridState()).catch(() => {});
				}
			}
		});
	}

	controller.init().catch(() => {});
	return controller;
}

function wireGridPersistence<TRowData>(
	options: { columns: ColumnDef<TRowData>[]; initialState?: Partial<GridInitialState<TRowData>>; persistence?: string | GridPersistenceAdapter },
	runtime: GridRuntime<TRowData>
): PersistenceController | undefined {
	const { persistence: rawPersistence } = options;
	if (!rawPersistence) return undefined;
	const adapter = typeof rawPersistence === 'string' ? createLocalStorageAdapter(rawPersistence) : rawPersistence;
	return createPersistenceSubscription(
		adapter,
		// Wrap subscribeToKey — persistence listener only needs () => void, extra args are ignored at runtime
		(key, cb) => runtime.engine.subscribeToKey(key, () => cb()),
		() => runtime.getGridState(),
		adapter.debounceMs ?? 500
	);
}

export function createClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const { persistence: rawPersistence } = options;
	const adapter = typeof rawPersistence === 'string' ? createLocalStorageAdapter(rawPersistence) : rawPersistence;

	let columns = options.columns;
	let mergedInitial: Partial<GridInitialState<TRowData>> = options.initialState ?? {};
	let loadedPersistedState: PersistedGridState | null = null;
	let asyncLoad: Promise<PersistedGridState | null> | undefined;

	if (adapter) {
		const loaded = adapter.load();
		if (loaded instanceof Promise) {
			asyncLoad = loaded;
		} else if (loaded) {
			loadedPersistedState = loaded;
		}
	}
	// Apply row selection before persisted restore so startup hydration never depends on a persistence-only state merge path.
	const selected = withRowSelectionColumn(mergedInitial.columns ?? columns, mergedInitial, options.rowSelection);
	columns = selected.columns;
	mergedInitial = selected.initialState;

	let resolvedColumns = mergedInitial.columns ?? columns;
	// Derive pinnedColumns from column.pinned when not explicitly provided.
	if (!mergedInitial.pinnedColumns) {
		const leftCols = resolvedColumns.filter((c) => c.pinned === 'left');
		const rightCols = resolvedColumns.filter((c) => c.pinned === 'right');
		if (leftCols.length > 0 || rightCols.length > 0) {
			const centerCols = resolvedColumns.filter((c) => !c.pinned);
			resolvedColumns = [...leftCols, ...centerCols, ...rightCols];
			mergedInitial = { ...mergedInitial, pinnedColumns: { left: leftCols.length, right: rightCols.length } };
		}
	}
	const runtime = new GridRuntime<TRowData>(
		{
			columns: resolvedColumns,
			getRowId: options.getRowId,
			columnWidths: buildColumnWidths(resolvedColumns),
			...mergedInitial,
		},
		{ rowValidator: options.rowValidator }
	);

	const controller = new ClientRowModelController<TRowData>(runtime.getClientRowModelRuntime(), { ...options, columns: resolvedColumns });
	const persistenceController = wireGridPersistence({ ...options, persistence: adapter }, runtime);
	const workspaceController = wireGridWorkspace(options, runtime, persistenceController);
	const api = createGridRuntimeComposition({
		runtime,
		destroy: () => {
			persistenceController?.destroy();
			workspaceController?.destroy();
			controller.dispose();
			runtime.destroy();
		},
		persistenceAdapter: adapter,
		persistenceController,
		workspaceController,
	});

	if (loadedPersistedState) {
		api.applyGridState(loadedPersistedState);
	}

	if (asyncLoad) {
		asyncLoad
			.then((saved) => {
				if (saved) api.applyGridState(saved);
			})
			.catch(() => {
				/* load failure — grid stays in default state */
			});
	}

	return api;
}

export function createInfiniteGrid<TRowData>(options: InfiniteGridOptions<TRowData>): GridApi<TRowData> {
	const { persistence: rawPersistence } = options;
	const adapter = typeof rawPersistence === 'string' ? createLocalStorageAdapter(rawPersistence) : rawPersistence;

	let mergedInitial: Partial<GridInitialState<TRowData>> = options.initialState ?? {};
	let loadedPersistedState: PersistedGridState | null = null;
	let asyncLoad: Promise<PersistedGridState | null> | undefined;

	if (adapter) {
		const loaded = adapter.load();
		if (loaded instanceof Promise) {
			asyncLoad = loaded;
		} else if (loaded) {
			loadedPersistedState = loaded;
		}
	}
	const selected = withRowSelectionColumn(options.columns, mergedInitial, options.rowSelection);
	mergedInitial = selected.initialState;

	let resolvedColumns = mergedInitial.columns ?? selected.columns;
	if (!mergedInitial.pinnedColumns) {
		const leftCols = resolvedColumns.filter((c) => c.pinned === 'left');
		const rightCols = resolvedColumns.filter((c) => c.pinned === 'right');
		if (leftCols.length > 0 || rightCols.length > 0) {
			const centerCols = resolvedColumns.filter((c) => !c.pinned);
			resolvedColumns = [...leftCols, ...centerCols, ...rightCols];
			mergedInitial = { ...mergedInitial, pinnedColumns: { left: leftCols.length, right: rightCols.length } };
		}
	}
	const runtime = new GridRuntime<TRowData>(
		{
			columns: resolvedColumns,
			getRowId: options.getRowId,
			columnWidths: buildColumnWidths(resolvedColumns),
			...mergedInitial,
		},
		{ rowValidator: options.rowValidator }
	);

	const controller = new InfiniteRowModelController<TRowData>(runtime.getInfiniteRowModelRuntime(), { ...options, columns: selected.columns });
	const persistenceController = wireGridPersistence({ ...options, persistence: adapter }, runtime);
	const workspaceController = wireGridWorkspace(options, runtime, persistenceController);
	const api = createGridRuntimeComposition({
		runtime,
		destroy: () => {
			persistenceController?.destroy();
			workspaceController?.destroy();
			controller.dispose();
			runtime.destroy();
		},
		persistenceAdapter: adapter,
		persistenceController,
		workspaceController,
	});

	if (loadedPersistedState) {
		api.applyGridState(loadedPersistedState);
	}
	if (asyncLoad) {
		asyncLoad
			.then((saved) => {
				if (saved) api.applyGridState(saved);
			})
			.catch(() => {
				/* load failure — grid stays in default state */
			});
	}
	return api;
}

export function createServerPageGrid<TRowData>(options: ServerPageGridOptions<TRowData>): GridApi<TRowData> {
	const { persistence: rawPersistence } = options;
	const adapter = typeof rawPersistence === 'string' ? createLocalStorageAdapter(rawPersistence) : rawPersistence;

	let mergedInitial: Partial<GridInitialState<TRowData>> = options.initialState ?? {};
	let loadedPersistedState: PersistedGridState | null = null;
	let asyncLoad: Promise<PersistedGridState | null> | undefined;

	if (adapter) {
		const loaded = adapter.load();
		if (loaded instanceof Promise) {
			asyncLoad = loaded;
		} else if (loaded) {
			loadedPersistedState = loaded;
		}
	}
	const selected = withRowSelectionColumn(options.columns, mergedInitial, options.rowSelection);
	mergedInitial = selected.initialState;

	let resolvedColumns = mergedInitial.columns ?? selected.columns;
	if (!mergedInitial.pinnedColumns) {
		const leftCols = resolvedColumns.filter((c) => c.pinned === 'left');
		const rightCols = resolvedColumns.filter((c) => c.pinned === 'right');
		if (leftCols.length > 0 || rightCols.length > 0) {
			const centerCols = resolvedColumns.filter((c) => !c.pinned);
			resolvedColumns = [...leftCols, ...centerCols, ...rightCols];
			mergedInitial = { ...mergedInitial, pinnedColumns: { left: leftCols.length, right: rightCols.length } };
		}
	}
	const runtime = new GridRuntime<TRowData>(
		{
			columns: resolvedColumns,
			getRowId: options.getRowId,
			columnWidths: buildColumnWidths(resolvedColumns),
			...mergedInitial,
		},
		{ rowValidator: options.rowValidator }
	);

	const controller = new ServerPageRowModelController<TRowData>(runtime.getServerPageRowModelRuntime(), { ...options, columns: selected.columns });
	const persistenceController = wireGridPersistence({ ...options, persistence: adapter }, runtime);
	const workspaceController = wireGridWorkspace(options, runtime, persistenceController);
	const api = createGridRuntimeComposition({
		runtime,
		destroy: () => {
			persistenceController?.destroy();
			workspaceController?.destroy();
			controller.dispose();
			runtime.destroy();
		},
		persistenceAdapter: adapter,
		persistenceController,
		workspaceController,
	});

	if (loadedPersistedState) {
		api.applyGridState(loadedPersistedState);
	}
	if (asyncLoad) {
		asyncLoad
			.then((saved) => {
				if (saved) api.applyGridState(saved);
			})
			.catch(() => {
				/* load failure — grid stays in default state */
			});
	}
	return api;
}
