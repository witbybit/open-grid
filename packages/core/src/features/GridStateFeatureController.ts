import { GridEventName } from '../api/GridEvents.js';
import type { StateManager } from '../state/StateManager.js';
import type { SortModel, FilterModel } from '../rowModel.js';
import type { GridChange, GridCommitResult } from '../engine/GridChangeApplier.js';
import type { InternalGridState } from '../state/GridState.js';

export interface GridStateFeatureControllerDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	applyChange: (change: GridChange<TRowData>) => GridCommitResult;
}

export class GridStateFeatureController<TRowData = unknown> {
	constructor(private readonly deps: GridStateFeatureControllerDeps<TRowData>) {}

	public getRowOverscanPx(): number {
		return this.deps.stateManager.getState().rowOverscanPx ?? 400;
	}

	public setRowOverscanPx(px: number): void {
		this.deps.applyChange({
			reason: 'ui:set-row-overscan',
			state: { rowOverscanPx: px },
			requestRender: false,
		});
	}

	public getColBuffer(): number {
		return this.deps.stateManager.getState().colBuffer ?? 2;
	}

	public setColBuffer(colBuffer: number): void {
		this.deps.applyChange({
			reason: 'ui:set-col-buffer',
			state: { colBuffer },
			requestRender: false,
		});
	}

	public setStyleRules(styleRules: InternalGridState<TRowData>['styleRules']): void {
		this.deps.applyChange({
			reason: 'ui:set-style-rules',
			state: { styleRules },
			invalidations: [
				{ kind: 'viewport', reason: 'style rules' },
				{ kind: 'headers', reason: 'style rules' },
				{ kind: 'overlay', reason: 'style rules' },
			],
			requestRender: true,
		});
	}

	public setShowFloatingFilters(enabled: boolean): void {
		if (this.deps.stateManager.getState().showFloatingFilters === enabled) return;
		this.deps.applyChange({
			reason: 'ui:set-floating-filters',
			state: { showFloatingFilters: enabled },
			invalidations: [
				{ kind: 'geometry', reason: 'showFloatingFilters' },
				{ kind: 'viewport', reason: 'showFloatingFilters' },
				{ kind: 'headers', reason: 'showFloatingFilters' },
			],
			requestRender: true,
		});
	}

	public setShowFilterChipBar(enabled: boolean): void {
		if ((this.deps.stateManager.getState().showFilterChipBar ?? false) === enabled) return;
		this.deps.applyChange({
			reason: 'ui:set-filter-chip-bar',
			state: { showFilterChipBar: enabled },
			invalidations: [
				{ kind: 'geometry', reason: 'showFilterChipBar' },
				{ kind: 'viewport', reason: 'showFilterChipBar' },
				{ kind: 'headers', reason: 'showFilterChipBar' },
			],
			domains: ['geometry'],
			requestRender: true,
		});
	}

	public setSidebarOpenPanel(panelId: string | null): void {
		if (this.deps.stateManager.getState().sidebarOpenPanel === panelId) return;
		this.deps.applyChange({
			reason: 'ui:set-sidebar-panel',
			state: { sidebarOpenPanel: panelId },
			requestRender: false,
		});
	}

	public setChartOpen(chartOpen: boolean): void {
		if ((this.deps.stateManager.getState().chartOpen ?? false) === chartOpen) return;
		this.deps.applyChange({
			reason: 'ui:set-chart-open',
			state: { chartOpen },
			requestRender: false,
		});
	}

	public setThemeName(themeName: InternalGridState<TRowData>['themeName']): void {
		if (this.deps.stateManager.getState().themeName === themeName) return;
		this.deps.applyChange({
			reason: 'ui:set-theme',
			state: { themeName },
			requestRender: false,
		});
	}

	public resizeRow(rowId: string, height: number, undoable = true): void {
		const state = this.deps.stateManager.getState();
		const oldHeight = state.rowHeights[rowId] ?? state.defaultRowHeight;
		if (oldHeight === height) return;
		this.applyRowHeight(rowId, height, undoable ? oldHeight : null);
	}

	public setRowHeights(rowHeights: Record<string, number>): void {
		this.deps.applyChange({
			reason: 'geometry:set-row-heights',
			state: { rowHeights },
			invalidations: [
				{ kind: 'geometry', reason: 'row heights' },
				{ kind: 'viewport', reason: 'row heights' },
			],
			domains: ['geometry'],
			requestRender: true,
		});
	}

	public setDefaultRowHeight(defaultRowHeight: number): void {
		this.deps.applyChange({
			reason: 'geometry:set-default-row-height',
			state: { defaultRowHeight },
			invalidations: [
				{ kind: 'geometry', reason: 'default row height' },
				{ kind: 'viewport', reason: 'default row height' },
			],
			domains: ['geometry'],
			requestRender: true,
		});
	}

	public setSortModel(sortModel: SortModel | null, undoable = true): void {
		const oldSort = this.deps.stateManager.getState().sortModel;
		this.deps.applyChange({
			reason: 'rows:set-sort-model',
			state: { sortModel },
			invalidations: [{ kind: 'headers' }, { kind: 'full' }],
			domains: ['rows', 'sorting'],
			events: [{ type: GridEventName.sortChanged, payload: { sortModel } }],
			history: undoable
				? {
						undo: {
							reason: 'rows:set-sort-model',
							state: { sortModel: oldSort },
							invalidations: [{ kind: 'headers' }, { kind: 'full' }],
							domains: ['rows', 'sorting'],
							events: [{ type: GridEventName.sortChanged, payload: { sortModel: oldSort } }],
							requestRender: true,
						},
						redo: {
							reason: 'rows:set-sort-model',
							state: { sortModel },
							invalidations: [{ kind: 'headers' }, { kind: 'full' }],
							domains: ['rows', 'sorting'],
							events: [{ type: GridEventName.sortChanged, payload: { sortModel } }],
							requestRender: true,
						},
					}
				: undefined,
			requestRender: true,
		});
	}

	public setFilterModel(filterModel: FilterModel | null, undoable = true): void {
		const oldFilter = this.deps.stateManager.getState().filterModel;
		this.deps.applyChange({
			reason: 'rows:set-filter-model',
			state: { filterModel },
			invalidations: [{ kind: 'full' }],
			domains: ['rows', 'filtering'],
			events: [{ type: GridEventName.filterChanged, payload: { filterModel } }],
			history: undoable
				? {
						undo: {
							reason: 'rows:set-filter-model',
							state: { filterModel: oldFilter },
							invalidations: [{ kind: 'full' }],
							domains: ['rows', 'filtering'],
							events: [{ type: GridEventName.filterChanged, payload: { filterModel: oldFilter } }],
							requestRender: true,
						},
						redo: {
							reason: 'rows:set-filter-model',
							state: { filterModel },
							invalidations: [{ kind: 'full' }],
							domains: ['rows', 'filtering'],
							events: [{ type: GridEventName.filterChanged, payload: { filterModel } }],
							requestRender: true,
						},
					}
				: undefined,
			requestRender: true,
		});
	}

	public setPaginationPage(page: number, metrics?: { pageCount: number; totalRows: number }): void {
		const state = this.deps.stateManager.getState();
		const current = state.pagination;
		if (!current) return;
		const nextPage = Math.max(0, page);
		if (current.page === nextPage) return;
		const payload = {
			page: nextPage,
			pageCount: metrics?.pageCount ?? 0,
			totalRows: metrics?.totalRows ?? 0,
			pageSize: current.pageSize,
		};
		this.deps.applyChange({
			reason: 'rows:set-pagination-page',
			state: { pagination: { pageSize: current.pageSize, page: nextPage } },
			domains: ['rows'],
			events: [{ type: GridEventName.paginationChanged, payload }],
			requestRender: true,
		});
	}

	private applyRowHeight(rowId: string, height: number, undoHeight: number | null = null): void {
		this.deps.applyChange({
			reason: 'geometry:resize-row',
			state: (state) => ({ rowHeights: { ...state.rowHeights, [rowId]: height } }),
			invalidations: [{ kind: 'geometry' }, { kind: 'row', rowId, reason: 'row resize' }],
			domains: ['geometry'],
			events: [{ type: GridEventName.rowResized, payload: { rowId, height } }],
			history:
				undoHeight === null
					? undefined
					: {
							undo: {
								reason: 'geometry:resize-row',
								state: (state) => ({ rowHeights: { ...state.rowHeights, [rowId]: undoHeight } }),
								invalidations: [{ kind: 'geometry' }, { kind: 'row', rowId, reason: 'row resize' }],
								domains: ['geometry'],
								events: [{ type: GridEventName.rowResized, payload: { rowId, height: undoHeight } }],
								requestRender: true,
							},
							redo: {
								reason: 'geometry:resize-row',
								state: (state) => ({ rowHeights: { ...state.rowHeights, [rowId]: height } }),
								invalidations: [{ kind: 'geometry' }, { kind: 'row', rowId, reason: 'row resize' }],
								domains: ['geometry'],
								events: [{ type: GridEventName.rowResized, payload: { rowId, height } }],
								requestRender: true,
							},
						},
			requestRender: true,
		});
	}
}
