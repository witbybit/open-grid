import { GridEventName, type GridState } from '../store.js';
import type { StateManager } from '../state/StateManager.js';
import type { InvalidationManager } from '../renderer/invalidationManager.js';
import type { CommandHistory } from '../commands/CommandHistory.js';
import type { EventBus } from '../events/EventBus.js';
import type { SortModel, FilterModel } from '../rowModel.js';

export interface GridStateFeatureControllerDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	invalidation: InvalidationManager;
	commandHistory: CommandHistory;
	eventBus: EventBus<TRowData>;
	requestRender: (reason: string) => void;
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
		return this.deps.stateManager.getState().colBuffer ?? 1;
	}

	public setColBuffer(colBuffer: number): void {
		this.deps.stateManager.setState({ colBuffer });
	}

	public setStyleSlots(styleSlots: GridState<TRowData>['styleSlots']): void {
		this.deps.stateManager.setState({ styleSlots });
		this.deps.invalidation.invalidateViewport('style slots');
		this.deps.invalidation.invalidateHeaders('style slots');
		this.deps.invalidation.invalidateOverlay('style slots');
		this.deps.requestRender('style slots');
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
		this.deps.stateManager.setState({ sortModel });
		this.deps.invalidation.invalidateHeaders('sort');
		this.deps.invalidation.invalidateFull('sort');
		this.deps.requestRender('sort');

		if (undoable) {
			this.deps.commandHistory.add({
				undo: () => this.deps.stateManager.setState({ sortModel: oldSort }),
				redo: () => this.deps.stateManager.setState({ sortModel }),
			});
		}
	}

	public setFilterModel(filterModel: FilterModel | null, undoable = true): void {
		const oldFilter = this.deps.stateManager.getState().filterModel;
		this.deps.stateManager.setState({ filterModel });
		this.deps.invalidation.invalidateFull('filter');
		this.deps.requestRender('filter');

		if (undoable) {
			this.deps.commandHistory.add({
				undo: () => this.deps.stateManager.setState({ filterModel: oldFilter }),
				redo: () => this.deps.stateManager.setState({ filterModel }),
			});
		}
	}

	private applyRowHeight(rowId: string, height: number): void {
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
