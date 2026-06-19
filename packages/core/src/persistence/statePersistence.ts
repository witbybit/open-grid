import type { ColumnDef } from '../columnDef.js';
import type { GridInitialState, InternalGridState } from '../state/GridState.js';
import type { SortModel, FilterModel } from '../rowModel.js';
import { isBuiltInThemeName, type BuiltInThemeName } from '../renderer/themes.js';

/**
 * Schema version for persisted grid state. Increment this when any field in
 * `PersistedGridState` changes shape (e.g. filter model operators added/removed,
 * field renamed). `applyPersistedState` and `applyPersistedStateToApi` reject
 * blobs whose `v` does not match this value.
 *
 * Migration path: add a `migrateV{N}toV{N+1}` function and call it in the
 * version-dispatch chain before incrementing this constant.
 */
export const GRID_STATE_SCHEMA_VERSION = 2;

export interface PersistedGridState {
	/**
	 * Schema version. Set automatically by `extractPersistedState`. If absent,
	 * the blob pre-dates versioning and is accepted with a console warning.
	 * A mismatched version causes the blob to be silently rejected (no-op).
	 */
	v?: number;
	columnWidths?: Record<string, number>;
	columnOrder?: string[];
	/** false = hidden. Omitted fields use column defaults. */
	columnVisibility?: Record<string, boolean>;
	sortModel?: SortModel | null;
	filterModel?: FilterModel | null;
	themeName?: BuiltInThemeName;
	groupBy?: string[];
	showGroupFooter?: boolean;
	enableStickyGroupRows?: boolean;
	pinnedColumns?: { left: number; right: number };
}

/**
 * Validate the schema version of a persisted state blob.
 * Returns null if the blob is compatible, or a human-readable error string if not.
 * A missing version (`v === undefined`) is treated as a legacy pre-versioning blob
 * and accepted with a warning rather than rejected.
 */
export function validateSchemaVersion(state: PersistedGridState): string | null {
	if (state.v === undefined) {
		console.warn(
			`[open-grid] applyPersistedState: state blob has no schema version (v is undefined). ` +
				`It predates versioning and will be applied as-is. ` +
				`Future schema changes may break this. Save the grid state again to stamp v=${GRID_STATE_SCHEMA_VERSION}.`
		);
		return null;
	}
	if (state.v === GRID_STATE_SCHEMA_VERSION) return null;
	return (
		`[open-grid] applyPersistedState: schema version mismatch ` +
		`(blob v=${state.v}, expected v=${GRID_STATE_SCHEMA_VERSION}). ` +
		`State was not applied. Clear the persisted state or provide a migration function.`
	);
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

/** Extract the persisted subset of internal runtime state. */
export function extractPersistedState<TRowData>(state: InternalGridState<TRowData>): PersistedGridState {
	const columnOrder = state.columns.map((c) => c.field);
	const columnVisibility: Record<string, boolean> = {};
	for (const col of state.columns) {
		// Grid uses col.hide (not col.visible) — persist as false = hidden
		if (col.hide) columnVisibility[col.field] = false;
	}
	const pins = state.pinnedColumns;
	return {
		v: GRID_STATE_SCHEMA_VERSION,
		columnWidths: Object.keys(state.columnWidths).length > 0 ? state.columnWidths : undefined,
		columnOrder,
		columnVisibility: Object.keys(columnVisibility).length > 0 ? columnVisibility : undefined,
		sortModel: state.sortModel,
		filterModel: state.filterModel,
		themeName: state.themeName,
		groupBy: state.groupBy,
		showGroupFooter: state.showGroupFooter,
		enableStickyGroupRows: state.enableStickyGroupRows,
		pinnedColumns: pins && (pins.left > 0 || pins.right > 0) ? pins : undefined,
	};
}

/**
 * Apply a persisted state blob onto the initial grid state.
 * Returns null if the blob's schema version is incompatible (mismatch — not legacy).
 * A legacy blob (no `v` field) is accepted with a console warning.
 */
export function applyPersistedState<TRowData>(
	saved: PersistedGridState,
	initial: Partial<GridInitialState<TRowData>>,
	columns: ColumnDef<unknown>[]
): Partial<GridInitialState<TRowData>> | null {
	const versionError = validateSchemaVersion(saved);
	if (versionError !== null) {
		console.error(versionError);
		return null;
	}
	const knownFields = new Set(columns.map((c) => c.field));
	const result: Partial<GridInitialState<TRowData>> = { ...initial };

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
				result.columns = reordered as unknown as GridInitialState<TRowData>['columns'];
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
		}) as unknown as GridInitialState<TRowData>['columns'];
	}

	// Sort model
	if (saved.sortModel !== undefined) {
		const sm = saved.sortModel;
		if (sm === null || (Array.isArray(sm) && sm.every((s) => knownFields.has(s.colId)))) {
			result.sortModel = sm as GridInitialState<TRowData>['sortModel'];
		}
	}

	// Filter model
	if (saved.filterModel !== undefined) {
		result.filterModel = saved.filterModel as GridInitialState<TRowData>['filterModel'];
	}

	if (saved.themeName !== undefined && isBuiltInThemeName(saved.themeName)) {
		result.themeName = saved.themeName as GridInitialState<TRowData>['themeName'];
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
	'themeName',
	'groupBy',
	'showGroupFooter',
	'enableStickyGroupRows',
	'pinnedColumns',
];

/**
 * Wire persistence to the grid via key-specific subscriptions.
 * Returns a controller that exposes auto-save toggle and save status.
 */
export function createPersistenceSubscription(
	adapter: GridPersistenceAdapter,
	subscribeToKey: (key: string, listener: () => void) => () => void,
	getGridState: () => PersistedGridState,
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
		const snapshot = getGridState();
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

export function areRowHeightsEqual(current: Record<string, number>, next: Record<string, number>): boolean {
	const currentKeys = Object.keys(current);
	const nextKeys = Object.keys(next);
	if (currentKeys.length !== nextKeys.length) return false;
	for (const key of currentKeys) {
		if (current[key] !== next[key]) return false;
	}
	return true;
}

function buildPersistedStateRestoreOps(
	api: {
		setColumnOrder(fields: string[]): void;
		setColumnsVisible(fields: string[], visible: boolean): void;
		setColumnWidth(field: string, width: number): void;
		setSortModel(model: any): void;
		setFilterModel(model: any): void;
		switchTheme(theme: string): void;
		setGroupBy(fields: string[]): void;
		setShowGroupFooter(enabled: boolean): void;
		setStickyGroupRows(enabled: boolean): void;
		setPinnedColumns(pins: any): void;
	},
	state: PersistedGridState,
	columns: Array<{ field: string }>
): Array<() => void> {
	const ops: Array<() => void> = [];
	const knownFields = new Set(columns.map((column) => column.field));

	if (state.columnOrder) {
		const validOrder = state.columnOrder.filter((field) => knownFields.has(field));
		if (validOrder.length === columns.length) {
			ops.push(() => api.setColumnOrder(validOrder));
		}
	}

	if (state.columnVisibility) {
		const hidden = Object.entries(state.columnVisibility)
			.filter(([, visible]) => visible === false)
			.map(([field]) => field)
			.filter((field) => knownFields.has(field));
		const visible = Object.entries(state.columnVisibility)
			.filter(([, visible]) => visible === true)
			.map(([field]) => field)
			.filter((field) => knownFields.has(field));
		if (hidden.length > 0) ops.push(() => api.setColumnsVisible(hidden, false));
		if (visible.length > 0) ops.push(() => api.setColumnsVisible(visible, true));
	}

	if (state.columnWidths) {
		for (const [field, width] of Object.entries(state.columnWidths)) {
			if (knownFields.has(field)) {
				ops.push(() => api.setColumnWidth(field, width));
			}
		}
	}

	if (state.sortModel !== undefined) {
		const sortModel = state.sortModel;
		if (sortModel === null || (Array.isArray(sortModel) && sortModel.every((sort) => knownFields.has(sort.colId)))) {
			ops.push(() => api.setSortModel(sortModel));
		}
	}

	if (state.filterModel !== undefined) ops.push(() => api.setFilterModel(state.filterModel));
	if (state.themeName !== undefined && isBuiltInThemeName(state.themeName)) {
		const themeName = state.themeName;
		ops.push(() => api.switchTheme(themeName));
	}
	if (state.groupBy !== undefined) {
		const groupBy = state.groupBy;
		ops.push(() => api.setGroupBy(groupBy.filter((field) => knownFields.has(field))));
	}
	if (state.showGroupFooter !== undefined) {
		const showGroupFooter = state.showGroupFooter;
		ops.push(() => api.setShowGroupFooter(showGroupFooter));
	}
	if (state.enableStickyGroupRows !== undefined) {
		const enableStickyGroupRows = state.enableStickyGroupRows;
		ops.push(() => api.setStickyGroupRows(enableStickyGroupRows));
	}
	if (state.pinnedColumns !== undefined) ops.push(() => api.setPinnedColumns(state.pinnedColumns));

	return ops;
}

/**
 * Apply a persisted state blob via GridApi method calls.
 * Returns true on success, false if the schema version is incompatible.
 * The caller should report a runtime fault when this returns false.
 */
export function applyPersistedStateToApi<TRowData>(
	api: {
		getStateSnapshot(): { columns: ReadonlyArray<{ field: string }> };
		getGridState(): PersistedGridState;
		setColumnOrder(fields: string[]): void;
		setColumnsVisible(fields: string[], visible: boolean): void;
		setColumnWidth(field: string, width: number): void;
		setSortModel(model: any): void;
		setFilterModel(model: any): void;
		switchTheme(theme: string): void;
		setGroupBy(fields: string[]): void;
		setShowGroupFooter(enabled: boolean): void;
		setStickyGroupRows(enabled: boolean): void;
		setPinnedColumns(pins: any): void;
	},
	state: PersistedGridState
): boolean {
	const versionError = validateSchemaVersion(state);
	if (versionError !== null) {
		return false;
	}
	const originalSnapshotState = api.getStateSnapshot();
	const originalColumns = originalSnapshotState.columns as Array<{ field: string }>;
	const originalSnapshot = api.getGridState();
	const applyOps = buildPersistedStateRestoreOps(api, state, originalColumns);

	try {
		for (const op of applyOps) {
			op();
		}
		return true;
	} catch {
		if (originalSnapshot !== null) {
			try {
				const rollbackOps = buildPersistedStateRestoreOps(api, originalSnapshot, originalColumns);
				for (const rollback of rollbackOps) {
					rollback();
				}
			} catch {
				// Best-effort rollback only. The caller reports the failed restore attempt.
			}
		}
		return false;
	}
}
