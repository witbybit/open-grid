import type { GridState, ColumnDef } from '../store.js';
import type { SortModel, FilterModel } from '../rowModel.js';

export interface PersistedGridState {
	columnWidths?: Record<string, number>;
	columnOrder?: string[];
	/** false = hidden. Omitted fields use column defaults. */
	columnVisibility?: Record<string, boolean>;
	sortModel?: SortModel | null;
	filterModel?: FilterModel | null;
	groupBy?: string[];
	showGroupFooter?: boolean;
	enableStickyGroupRows?: boolean;
	pinnedColumns?: { left: number; right: number };
}

/**
 * Pluggable persistence adapter. Implement this interface to store grid settings
 * anywhere — localStorage, a remote API, a database, etc.
 *
 * @example localStorage (built-in shorthand via `createLocalStorageAdapter`)
 * @example Remote API:
 *   const adapter: GridPersistenceAdapter = {
 *     async load() { const res = await fetch('/api/grid-settings'); return res.ok ? res.json() : null; },
 *     async save(state) { await fetch('/api/grid-settings', { method: 'PUT', body: JSON.stringify(state) }); },
 *     async clear() { await fetch('/api/grid-settings', { method: 'DELETE' }); },
 *   };
 */
export interface GridPersistenceAdapter {
	/** Load saved state. May return a Promise for async/network sources. */
	load(): PersistedGridState | null | Promise<PersistedGridState | null>;
	/** Persist current state. Called debounced after relevant state changes. */
	save(state: PersistedGridState): void | Promise<void>;
	/** Optionally clear all saved state (e.g. "Reset to defaults"). */
	clear?(): void | Promise<void>;
	/**
	 * Debounce delay in ms before saving after a state change.
	 * @default 500
	 */
	debounceMs?: number;
}

export type PersistenceSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface PersistenceStatus {
	status: PersistenceSaveStatus;
	/** Whether auto-save is currently enabled. */
	autoSave: boolean;
	/** ms-since-epoch timestamp of the last successful save, or undefined if never saved this session. */
	lastSavedAt?: number;
	/** Populated when status === 'error'. */
	error?: unknown;
}

export interface PersistenceController {
	setAutoSave(enabled: boolean): void;
	isAutoSaveEnabled(): boolean;
	getStatus(): PersistenceStatus;
	/** Subscribe to status changes. Returns unsubscribe function. */
	onStatusChange(listener: (status: PersistenceStatus) => void): () => void;
	/** Immediately save current state, bypassing the debounce timer. */
	saveNow(): void;
	destroy(): void;
}

/** Built-in localStorage adapter. */
export function createLocalStorageAdapter(key: string): GridPersistenceAdapter {
	return {
		load() {
			try {
				const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
				if (!raw) return null;
				return JSON.parse(raw) as PersistedGridState;
			} catch {
				return null;
			}
		},
		save(state) {
			try {
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem(key, JSON.stringify(state));
				}
			} catch {
				// localStorage may be unavailable (SSR, quota exceeded, private browsing)
			}
		},
		clear() {
			try {
				if (typeof localStorage !== 'undefined') {
					localStorage.removeItem(key);
				}
			} catch {}
		},
	};
}

/** Extract the subset of GridState that should be persisted. */
export function extractPersistedState(state: GridState): PersistedGridState {
	const columnOrder = state.columns.map((c) => c.field);
	const columnVisibility: Record<string, boolean> = {};
	for (const col of state.columns) {
		// Grid uses col.hide (not col.visible) — persist as false = hidden
		if (col.hide) columnVisibility[col.field] = false;
	}
	const pins = state.pinnedColumns;
	return {
		columnWidths: Object.keys(state.columnWidths).length > 0 ? state.columnWidths : undefined,
		columnOrder,
		columnVisibility: Object.keys(columnVisibility).length > 0 ? columnVisibility : undefined,
		sortModel: state.sortModel,
		filterModel: state.filterModel,
		groupBy: state.groupBy,
		showGroupFooter: state.showGroupFooter,
		enableStickyGroupRows: state.enableStickyGroupRows,
		pinnedColumns: pins && (pins.left > 0 || pins.right > 0) ? pins : undefined,
	};
}

export function applyPersistedState<TRowData>(
	saved: PersistedGridState,
	initial: Partial<GridState<TRowData>>,
	columns: ColumnDef<unknown>[]
): Partial<GridState<TRowData>> {
	const knownFields = new Set(columns.map((c) => c.field));
	const result: Partial<GridState<TRowData>> = { ...initial };

	// Column widths — merge, persisted overrides defaults
	if (saved.columnWidths) {
		const filtered: Record<string, number> = {};
		for (const [field, width] of Object.entries(saved.columnWidths)) {
			if (knownFields.has(field)) filtered[field] = width;
		}
		if (Object.keys(filtered).length > 0) {
			result.columnWidths = { ...(initial.columnWidths ?? {}), ...filtered };
		}
	}

	// Column order — only apply when saved order covers all current columns
	const baseColumns = (result.columns ?? columns) as ColumnDef<unknown>[];
	if (saved.columnOrder) {
		const validOrder = saved.columnOrder.filter((f) => knownFields.has(f));
		if (validOrder.length === columns.length) {
			const colMap = new Map(baseColumns.map((c) => [c.field, c]));
			const reordered = validOrder.map((f) => colMap.get(f)).filter((c): c is ColumnDef<unknown> => !!c);
			if (reordered.length === columns.length) {
				result.columns = reordered as unknown as GridState<TRowData>['columns'];
			}
		}
	}

	// Column visibility — use col.hide (grid convention), not col.visible
	if (saved.columnVisibility) {
		const visBase = (result.columns ?? baseColumns) as ColumnDef<unknown>[];
		result.columns = visBase.map((col) => {
			const savedVis = saved.columnVisibility![col.field];
			if (savedVis === false) return { ...col, hide: true };
			if (savedVis === true && col.hide) return { ...col, hide: false };
			return col;
		}) as unknown as GridState<TRowData>['columns'];
	}

	// Sort model
	if (saved.sortModel !== undefined) {
		const sm = saved.sortModel;
		if (sm === null || (Array.isArray(sm) && sm.every((s) => knownFields.has(s.colId)))) {
			result.sortModel = sm as GridState<TRowData>['sortModel'];
		}
	}

	// Filter model
	if (saved.filterModel !== undefined) {
		result.filterModel = saved.filterModel as GridState<TRowData>['filterModel'];
	}

	// Group by — only restore fields that still exist in schema
	if (saved.groupBy !== undefined) {
		result.groupBy = saved.groupBy.filter((f) => knownFields.has(f));
	}

	// Group display settings
	if (saved.showGroupFooter !== undefined) result.showGroupFooter = saved.showGroupFooter;
	if (saved.enableStickyGroupRows !== undefined) result.enableStickyGroupRows = saved.enableStickyGroupRows;

	// Column pin counts
	if (saved.pinnedColumns !== undefined) result.pinnedColumns = saved.pinnedColumns;

	return result;
}

/**
 * Apply a loaded PersistedGridState to a live grid via its API.
 * Used for async adapters that resolve after the grid is already mounted.
 */
export function applyPersistedStateViaApi<TRowData>(
	api: import('../store.js').GridApi<TRowData>,
	saved: PersistedGridState,
	columns: ColumnDef<TRowData>[]
): void {
	const knownFields = new Set((columns as ColumnDef<unknown>[]).map((c) => c.field));

	if (saved.columnOrder) {
		const validOrder = saved.columnOrder.filter((f) => knownFields.has(f));
		if (validOrder.length === columns.length) api.setColumnOrder(validOrder);
	}
	if (saved.columnVisibility) {
		const hidden = Object.entries(saved.columnVisibility)
			.filter(([, v]) => v === false)
			.map(([f]) => f)
			.filter((f) => knownFields.has(f));
		const visible = Object.entries(saved.columnVisibility)
			.filter(([, v]) => v === true)
			.map(([f]) => f)
			.filter((f) => knownFields.has(f));
		if (hidden.length > 0) api.setColumnsVisible(hidden, false);
		if (visible.length > 0) api.setColumnsVisible(visible, true);
	}
	if (saved.columnWidths) {
		for (const [field, width] of Object.entries(saved.columnWidths)) {
			if (knownFields.has(field)) api.setColumnWidth(field, width);
		}
	}
	if (saved.sortModel !== undefined) {
		if (saved.sortModel === null || (Array.isArray(saved.sortModel) && saved.sortModel.every((s) => knownFields.has(s.colId)))) {
			api.setSortModel(saved.sortModel);
		}
	}
	if (saved.filterModel !== undefined) api.setFilterModel(saved.filterModel);
	if (saved.groupBy !== undefined) api.setGroupBy(saved.groupBy.filter((f) => knownFields.has(f)));
	if (saved.showGroupFooter !== undefined) api.setShowGroupFooter(saved.showGroupFooter);
	if (saved.enableStickyGroupRows !== undefined) api.setStickyGroupRows(saved.enableStickyGroupRows);
	if (saved.pinnedColumns !== undefined) api.setPinnedColumns(saved.pinnedColumns);
}

function debounce(fn: () => void, ms: number): (() => void) & { flush(): void; cancel(): void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const debounced = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn();
		}, ms);
	};
	debounced.flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
			fn();
		}
	};
	debounced.cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};
	return debounced;
}

/**
 * Only these state keys should trigger a persistence save.
 * Scroll position, selection, active edit, etc. are intentionally excluded to
 * avoid flooding network adapters on every pointer event.
 */
const PERSISTENCE_KEYS = [
	'columns',
	'columnWidths',
	'sortModel',
	'filterModel',
	'groupBy',
	'showGroupFooter',
	'enableStickyGroupRows',
	'pinnedColumns',
];

/**
 * Wire persistence to the grid via key-specific subscriptions.
 * Returns a controller that exposes auto-save toggle and save status.
 */
export function createPersistenceSubscription<TRowData>(
	adapter: GridPersistenceAdapter,
	subscribeToKey: (key: string, listener: () => void) => () => void,
	getState: () => GridState<TRowData>,
	debounceMs = 500
): PersistenceController {
	let autoSave = true;
	let currentStatus: PersistenceStatus = { status: 'idle', autoSave: true };
	const statusListeners = new Set<(status: PersistenceStatus) => void>();

	function setStatus(next: PersistenceStatus): void {
		currentStatus = next;
		statusListeners.forEach((l) => l(next));
	}

	function performSave(): void {
		if (!autoSave) return;
		const snapshot = extractPersistedState(getState() as GridState);
		setStatus({ status: 'saving', autoSave, lastSavedAt: currentStatus.lastSavedAt });
		try {
			const result = adapter.save(snapshot);
			if (result instanceof Promise) {
				result
					.then(() => {
						setStatus({ status: 'saved', autoSave, lastSavedAt: Date.now() });
					})
					.catch((err: unknown) => {
						setStatus({ status: 'error', autoSave, lastSavedAt: currentStatus.lastSavedAt, error: err });
					});
			} else {
				setStatus({ status: 'saved', autoSave, lastSavedAt: Date.now() });
			}
		} catch (err) {
			setStatus({ status: 'error', autoSave, lastSavedAt: currentStatus.lastSavedAt, error: err });
		}
	}

	const debouncedSave = debounce(performSave, debounceMs);

	// Subscribe only to keys that affect persisted state — not scroll, selection, viewport, etc.
	const unsubs = PERSISTENCE_KEYS.map((key) => subscribeToKey(key, debouncedSave));

	return {
		setAutoSave(enabled: boolean) {
			autoSave = enabled;
			setStatus({ ...currentStatus, autoSave: enabled });
		},
		isAutoSaveEnabled() {
			return autoSave;
		},
		getStatus() {
			return currentStatus;
		},
		onStatusChange(listener) {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
		saveNow() {
			debouncedSave.cancel(); // cancel any pending debounce to avoid a second save
			performSave();
		},
		destroy() {
			debouncedSave.flush(); // flush any pending save before teardown
			unsubs.forEach((u) => u());
			statusListeners.clear();
		},
	};
}
