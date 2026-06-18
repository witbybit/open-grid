import { GridEventName, type GridState } from '../store.js';
import type { StateManager } from '../state/StateManager.js';
import type { InvalidationManager } from '../renderer/invalidationManager.js';
import type { CommandHistory } from '../commands/CommandHistory.js';
import type { EventBus } from '../events/EventBus.js';
import type { SortModel, FilterModel } from '../rowModel.js';
import type { GridChange } from '../engine/GridChangeApplier.js';

export interface GridStateFeatureControllerDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	invalidation: InvalidationManager;
	commandHistory: CommandHistory;
	eventBus: EventBus<TRowData>;
	requestRender: (reason: string) => void;
	applyChange?: (change: GridChange<TRowData>) => void;
}

export class GridStateFeatureController<TRowData = unknown> {
	constructor(private readonly deps: GridStateFeatureControllerDeps<TRowData>) {}

	public getRowOverscanPx(): number {
		return this.deps.stateManager.getState().rowOverscanPx ?? 400;
	}

	public setRowOverscanPx(px: number): void {
		this.deps.stateManager.setState({ rowOverscanPx: px });
	}

	public getColBuffer(): number {
		return this.deps.stateManager.getState().colBuffer ?? 2;
	}

	public setColBuffer(colBuffer: number): void {
		this.deps.stateManager.setState({ colBuffer });
	}

	public setStyleRules(styleRules: GridState<TRowData>['styleRules']): void {
		if (this.deps.applyChange) {
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
			return;
		}
		this.deps.stateManager.setState({ styleRules });
		this.deps.invalidation.invalidateViewport('style rules');
		this.deps.invalidation.invalidateHeaders('style rules');
		this.deps.invalidation.invalidateOverlay('style rules');
		this.deps.requestRender('style rules');
	}

	public setShowFloatingFilters(enabled: boolean): void {
		if (this.deps.stateManager.getState().showFloatingFilters === enabled) return;
		if (this.deps.applyChange) {
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
			return;
		}
		this.deps.stateManager.setState({ showFloatingFilters: enabled });
		this.deps.invalidation.invalidateGeometry('showFloatingFilters');
		this.deps.invalidation.invalidateViewport('showFloatingFilters');
		this.deps.invalidation.invalidateHeaders('showFloatingFilters');
		this.deps.requestRender('showFloatingFilters');
	}

	public resizeRow(rowId: string, height: number, undoable = true): void {
		const state = this.deps.stateManager.getState();
		const oldHeight = state.rowHeights[rowId] ?? state.defaultRowHeight;
		if (oldHeight === height) return;

		this.applyRowHeight(rowId, height);

		if (undoable) {
			this.deps.commandHistory.add({
				undo: () => this.applyRowHeight(rowId, oldHeight),
				redo: () => this.applyRowHeight(rowId, height),
			});
		}
	}

	public setSortModel(sortModel: SortModel | null, undoable = true): void {
		const oldSort = this.deps.stateManager.getState().sortModel;
		if (this.deps.applyChange) {
			this.deps.applyChange({
				reason: 'rows:set-sort-model',
				state: { sortModel },
				invalidations: [{ kind: 'headers' }, { kind: 'full' }],
				domains: ['rows', 'sorting'],
				events: [{ type: GridEventName.sortChanged, payload: { sortModel } as never }],
				requestRender: true,
			});
		} else {
			this.deps.stateManager.setState({ sortModel });
			this.deps.invalidation.invalidateHeaders('sort');
			this.deps.invalidation.invalidateFull('sort');
			this.deps.requestRender('sort');
		}

		if (undoable) {
			this.deps.commandHistory.add({
				undo: () => this.setSortModel(oldSort, false),
				redo: () => this.setSortModel(sortModel, false),
			});
		}
	}

	public setFilterModel(filterModel: FilterModel | null, undoable = true): void {
		const oldFilter = this.deps.stateManager.getState().filterModel;
		if (this.deps.applyChange) {
			this.deps.applyChange({
				reason: 'rows:set-filter-model',
				state: { filterModel },
				invalidations: [{ kind: 'full' }],
				domains: ['rows', 'filtering'],
				events: [{ type: GridEventName.filterChanged, payload: { filterModel } as never }],
				requestRender: true,
			});
		} else {
			this.deps.stateManager.setState({ filterModel });
			this.deps.invalidation.invalidateFull('filter');
			this.deps.requestRender('filter');
		}

		if (undoable) {
			this.deps.commandHistory.add({
				undo: () => this.setFilterModel(oldFilter, false),
				redo: () => this.setFilterModel(filterModel, false),
			});
		}
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
		if (this.deps.applyChange) {
			this.deps.applyChange({
				reason: 'rows:set-pagination-page',
				state: { pagination: { pageSize: current.pageSize, page: nextPage } },
				domains: ['rows'],
				events: [{ type: GridEventName.paginationChanged, payload: payload as never }],
				requestRender: true,
			});
			return;
		}
		this.deps.stateManager.setState({ pagination: { pageSize: current.pageSize, page: nextPage } });
		this.deps.eventBus.dispatchEvent(GridEventName.paginationChanged, payload);
		this.deps.requestRender('pagination');
	}

	private applyRowHeight(rowId: string, height: number): void {
		if (this.deps.applyChange) {
			this.deps.applyChange({
				reason: 'geometry:resize-row',
				state: (state) => ({ rowHeights: { ...state.rowHeights, [rowId]: height } }),
				invalidations: [{ kind: 'geometry' }, { kind: 'row', rowId, reason: 'row resize' }],
				domains: ['geometry'],
				events: [{ type: GridEventName.rowResized, payload: { rowId, height } as never }],
				requestRender: true,
			});
		} else {
			this.deps.stateManager.setState((state) => ({
				rowHeights: {
					...state.rowHeights,
					[rowId]: height,
				},
			}));
			this.deps.invalidation.invalidateGeometry('row resize');
			this.deps.invalidation.invalidateRow(rowId, 'row resize');
			this.deps.eventBus.dispatchEvent(GridEventName.rowResized, {
				rowId,
				height,
			});
			this.deps.requestRender('row resize');
		}
	}
}
