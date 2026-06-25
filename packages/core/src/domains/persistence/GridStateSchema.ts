import type { GroupByModel } from '../pipeline/GroupModel.js';
import type { FilterModel, SortModel } from '../pipeline/PipelineModels.js';
import type { ColumnState } from '../columns/ColumnState.js';

export const GRID_STATE_SCHEMA_VERSION = 2;

/**
 * Serialized snapshot of all user-configurable grid state (ARCHITECTURE.md §3 R8).
 * Intentionally flat/JSON-serializable — no class instances, no functions.
 */
export interface SerializedGridState {
	readonly schemaVersion: typeof GRID_STATE_SCHEMA_VERSION;
	readonly columns: readonly ColumnState[];
	readonly sortModel: SortModel;
	readonly filterModel: FilterModel;
	readonly groupBy: GroupByModel;
	readonly theme?: string;
	readonly sidebarOpenPanel?: string | null;
}

/**
 * Create a frozen snapshot of the current grid state from a live read surface.
 */
export interface GridStateReadPort {
	getColumnState(): ColumnState[];
	getSortModel(): SortModel;
	getFilterModel(): FilterModel;
	getGroupBy(): GroupByModel;
	getTheme?(): string | undefined;
	getSidebarOpenPanel?(): string | null;
}

export function createGridStateSnapshot(port: GridStateReadPort): SerializedGridState {
	return Object.freeze({
		schemaVersion: GRID_STATE_SCHEMA_VERSION,
		columns: port.getColumnState().slice(),
		sortModel: port.getSortModel().slice(),
		filterModel: port.getFilterModel().slice(),
		groupBy: port.getGroupBy().slice(),
		theme: port.getTheme?.(),
		sidebarOpenPanel: port.getSidebarOpenPanel?.() ?? null,
	});
}

export function isValidGridState(value: unknown): value is SerializedGridState {
	if (!value || typeof value !== 'object') return false;
	const s = value as Record<string, unknown>;
	return s['schemaVersion'] === GRID_STATE_SCHEMA_VERSION && Array.isArray(s['columns']);
}

/**
 * Apply a serialized state to a live API.
 */
export interface GridStateWritePort {
	setColumnState(state: readonly ColumnState[]): void;
	setSortModel(model: SortModel): void;
	setFilterModel(model: FilterModel): void;
	setGroupBy(model: GroupByModel): void;
	setTheme?(name: string): void;
	setSidebarOpenPanel?(id: string | null): void;
}

export function applyGridState(state: SerializedGridState, port: GridStateWritePort): void {
	if (!isValidGridState(state)) {
		console.warn('[GridState] Invalid or incompatible state snapshot — skipping apply');
		return;
	}
	port.setColumnState(state.columns);
	port.setSortModel(state.sortModel);
	port.setFilterModel(state.filterModel);
	port.setGroupBy(state.groupBy);
	if (state.theme && port.setTheme) port.setTheme(state.theme);
	if (state.sidebarOpenPanel !== undefined && port.setSidebarOpenPanel) {
		port.setSidebarOpenPanel(state.sidebarOpenPanel);
	}
}
