import { GridEventName, type GridState, type RowModel } from '../store.js';
import type { StateManager } from '../state/StateManager.js';
import type { DataModel } from '../models/DataModel.js';
import type { ColumnModel } from '../models/ColumnModel.js';
import type { GeometryModel } from '../models/GeometryModel.js';
import type { ViewportModel } from '../models/ViewportModel.js';
import type { SelectionModel } from '../models/SelectionModel.js';
import type { InvalidationManager } from '../renderer/invalidationManager.js';
import type { EventBus } from '../events/EventBus.js';
import type { CellNotificationController } from './CellNotificationController.js';

interface RangeBounds {
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}

export interface GridStateReactionControllerDeps<TRowData = unknown> {
	getStateManager: () => StateManager<TRowData>;
	data: DataModel<TRowData>;
	columns: ColumnModel<TRowData>;
	geometry: GeometryModel;
	viewport: ViewportModel<TRowData>;
	selection: SelectionModel;
	invalidation: InvalidationManager;
	eventBus: EventBus<TRowData>;
	cellNotifications: CellNotificationController<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	getRowHeightsList: (rowModel: RowModel<TRowData>, rowHeightsRecord: Record<string, number>, defaultRowHeight: number) => number[];
	notifyCellChange: (rowId: string, colField: string) => void;
	requestRender: (reason: string) => void;
	incrementColumnVersion: () => void;
	incrementGeometryVersion: () => void;
	incrementRowModelVersion: () => void;
}

export class GridStateReactionController<TRowData = unknown> {
	constructor(private readonly deps: GridStateReactionControllerDeps<TRowData>) {}

	public handleStateChanges = (prevState: GridState<TRowData>, updatedKeys: string[]): void => {
		const stateManager = this.deps.getStateManager();
		let currState = stateManager.getState();
		const updatedSet = new Set(updatedKeys);

		if (updatedSet.has('columns') || updatedSet.has('columnWidths') || updatedSet.has('defaultColWidth')) {
			this.deps.columns.updateColumns(currState.columns, currState.columnWidths, currState.defaultColWidth);
			this.deps.incrementColumnVersion();
			this.deps.incrementGeometryVersion();
		}

		if (updatedSet.has('globalVersion')) {
			this.deps.data.clearValueGetterCache();
		}

		if (updatedSet.has('globalVersion') || updatedSet.has('sortModel') || updatedSet.has('filterModel')) {
			this.deps.incrementRowModelVersion();
		}

		const rowModel = this.deps.getRowModel();
		const rowCountChanged = rowModel ? rowModel.getVisualRowCount() !== this.deps.geometry.getRowCount() : false;
		if (
			rowModel &&
			(updatedSet.has('rowHeights') ||
				updatedSet.has('defaultRowHeight') ||
				updatedSet.has('loading') ||
				updatedSet.has('globalVersion') ||
				rowCountChanged)
		) {
			this.deps.geometry.updateRows(
				this.deps.getRowHeightsList(rowModel, currState.rowHeights, currState.defaultRowHeight),
				currState.defaultRowHeight
			);
			this.deps.incrementGeometryVersion();
		}

		if (
			updatedSet.has('selection') ||
			updatedSet.has('columns') ||
			updatedSet.has('sortModel') ||
			updatedSet.has('filterModel') ||
			updatedSet.has('globalVersion') ||
			updatedSet.has('expansion') ||
			updatedSet.has('groupBy')
		) {
			const rangeBounds = this.deps.selection.calculateRangeBounds(
				currState.selection.range,
				(id) => {
					const activeRowModel = this.deps.getRowModel();
					return activeRowModel ? activeRowModel.getVisualIndexByRowId(id) : -1;
				},
				(field) => this.deps.columns.getColumnIndex(field)
			);
			const nextBounds = this.areRangeBoundsEqual(currState.selection.bounds, rangeBounds) ? currState.selection.bounds : rangeBounds;
			const selection = this.deps.selection.setSelection({
				...currState.selection,
				bounds: nextBounds,
			});
			if (currState.selection !== selection) {
				for (const key of stateManager.setDerivedState({ selection }, prevState)) {
					const wasAlreadyUpdated = updatedSet.has(key);
					updatedSet.add(key);
					updatedKeys.push(key);
					if (!wasAlreadyUpdated) {
						stateManager.triggerKeyChange(key, prevState);
					}
				}
				currState = stateManager.getState();
			}
		}

		if (updatedSet.has('selection')) {
			this.deps.selection.setSelection(currState.selection);
			this.deps.invalidation.invalidateOverlay('selection');
		}

		const needsRangeUpdate =
			updatedSet.has('columns') ||
			updatedSet.has('columnWidths') ||
			updatedSet.has('rowHeights') ||
			updatedSet.has('globalVersion') ||
			updatedSet.has('defaultRowHeight') ||
			updatedSet.has('defaultColWidth') ||
			updatedSet.has('loading') ||
			updatedSet.has('rowOverscanPx');

		if (needsRangeUpdate) {
			const activeRowModel = this.deps.getRowModel();
			const nextRowRange = this.deps.viewport.getVisibleRowRange(activeRowModel ? activeRowModel.getVisualRowCount() : 0);
			const nextColRange = this.deps.viewport.getVisibleColumnRange(this.deps.columns.getDisplayedColumnCount());

			const rowRangeChanged =
				!currState.visibleRowRange ||
				currState.visibleRowRange.startIdx !== nextRowRange.startIdx ||
				currState.visibleRowRange.endIdx !== nextRowRange.endIdx;
			const colRangeChanged =
				!currState.visibleColRange ||
				currState.visibleColRange.startIdx !== nextColRange.startIdx ||
				currState.visibleColRange.endIdx !== nextColRange.endIdx;

			if (rowRangeChanged || colRangeChanged) {
				for (const key of stateManager.setDerivedState({ visibleRowRange: nextRowRange, visibleColRange: nextColRange }, prevState)) {
					const wasAlreadyUpdated = updatedSet.has(key);
					updatedSet.add(key);
					updatedKeys.push(key);
					if (!wasAlreadyUpdated) {
						stateManager.triggerKeyChange(key, prevState);
					}
				}
				currState = stateManager.getState();
			}
		}

		const notifiedCells = new Set<string>();
		const notifyCellOnce = (rowId: string, colField: string): void => {
			const key = `${rowId}:${colField}`;
			if (notifiedCells.has(key)) return;
			notifiedCells.add(key);
			this.deps.notifyCellChange(rowId, colField);
		};

		if (updatedSet.has('selection')) {
			if (prevState.selection.focus) {
				notifyCellOnce(prevState.selection.focus.rowId, prevState.selection.focus.colField);
				this.deps.invalidation.invalidateCell(prevState.selection.focus.rowId, prevState.selection.focus.colField, 'focus');
			}
			if (currState.selection.focus) {
				notifyCellOnce(currState.selection.focus.rowId, currState.selection.focus.colField);
				this.deps.invalidation.invalidateCell(currState.selection.focus.rowId, currState.selection.focus.colField, 'focus');
			}
		}

		if (updatedSet.has('activeEdit')) {
			if (prevState.activeEdit) notifyCellOnce(prevState.activeEdit.rowId, prevState.activeEdit.colField);
			if (currState.activeEdit) notifyCellOnce(currState.activeEdit.rowId, currState.activeEdit.colField);
		}

		if (updatedSet.has('selection')) {
			const activeRowModel = this.deps.getRowModel();
			if (activeRowModel) {
				const viewport = this.getSelectionNotificationViewport(currState, activeRowModel);
				const displayedColumns = this.deps.columns.getDisplayedColumns();
				this.deps.selection.forEachDirtyCoordinateInViewport(
					prevState.selection.bounds,
					currState.selection.bounds,
					viewport,
					(rowIdx, colIdx) => {
						const visualRow = activeRowModel.getVisualRow(rowIdx);
						const col = displayedColumns[colIdx];
						if (visualRow?.kind === 'data' && col) {
							notifyCellOnce(visualRow.rowId, col.field);
							this.deps.invalidation.invalidateCell(visualRow.rowId, col.field, 'selection');
						}
					}
				);
			}
		}

		if (updatedSet.has('columnWidths')) {
			const prevWidths = prevState.columnWidths;
			const currWidths = currState.columnWidths;
			const allCols = new Set([...Object.keys(prevWidths), ...Object.keys(currWidths)]);
			allCols.forEach((colField) => {
				if (prevWidths[colField] !== currWidths[colField]) {
					this.deps.cellNotifications.notifyColumnSubscribers(colField);
				}
			});
		}

		if (updatedSet.has('globalVersion')) {
			this.deps.cellNotifications.notifyAllCellSubscribers();
		}

		if (updatedSet.has('selection') && prevState.selection.focus !== currState.selection.focus) {
			this.deps.eventBus.dispatchEvent(GridEventName.focusChanged, { focus: currState.selection.focus, selection: currState.selection });
		}
		if (updatedSet.has('selection')) {
			this.deps.eventBus.dispatchEvent(GridEventName.selectionChanged, {
				selection: currState.selection,
				result: this.deps.selection.describeChange(prevState.selection, currState.selection, this.deps.getRowModel(), currState.columns),
			});
			this.deps.requestRender('selection');
		}
		if (updatedSet.has('sortModel')) {
			this.deps.eventBus.dispatchEvent(GridEventName.sortChanged, { sortModel: currState.sortModel });
		}
		if (updatedSet.has('filterModel')) {
			this.deps.eventBus.dispatchEvent(GridEventName.filterChanged, { filterModel: currState.filterModel });
		}
		if (updatedSet.has('groupBy')) {
			this.deps.eventBus.dispatchEvent(GridEventName.groupByChanged, { groupBy: currState.groupBy });
		}
		if (updatedSet.has('aggDefs')) {
			this.deps.eventBus.dispatchEvent(GridEventName.aggDefsChanged, { aggDefs: currState.aggDefs });
		}
		if (updatedSet.has('showGroupFooter')) {
			this.deps.eventBus.dispatchEvent(GridEventName.showGroupFooterChanged, { showGroupFooter: currState.showGroupFooter });
		}
		if (updatedSet.has('enableStickyGroupRows')) {
			this.deps.eventBus.dispatchEvent(GridEventName.enableStickyGroupRowsChanged, {
				enableStickyGroupRows: currState.enableStickyGroupRows,
			});
		}
	};

	private areRangeBoundsEqual(left: RangeBounds | null, right: RangeBounds | null): boolean {
		return (
			left === right ||
			(!!left &&
				!!right &&
				left.minRow === right.minRow &&
				left.maxRow === right.maxRow &&
				left.minCol === right.minCol &&
				left.maxCol === right.maxCol)
		);
	}

	private getSelectionNotificationViewport(
		state: GridState<TRowData>,
		rowModel: RowModel<TRowData>
	): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
		const rowCount = rowModel.getVisualRowCount();
		const colCount = this.deps.columns.getDisplayedColumnCount();

		if (rowCount === 0 || colCount === 0) {
			return { minRow: 1, maxRow: 0, minCol: 1, maxCol: 0 };
		}

		const rowStart = Math.max(0, Math.min(state.visibleRowRange.startIdx, rowCount - 1));
		const rowEnd = Math.max(rowStart, Math.min(state.visibleRowRange.endIdx, rowCount - 1));
		const colStart = Math.max(0, Math.min(state.visibleColRange.startIdx, colCount - 1));
		const colEnd = Math.max(colStart, Math.min(state.visibleColRange.endIdx, colCount - 1));
		const topEnd = this.deps.viewport.pinTopRows > 0 ? Math.min(rowCount - 1, this.deps.viewport.pinTopRows - 1) : rowStart;
		const bottomStart = this.deps.viewport.pinBottomRows > 0 ? Math.max(0, rowCount - this.deps.viewport.pinBottomRows) : rowEnd;
		const leftEnd = this.deps.viewport.pinLeftColumns > 0 ? Math.min(colCount - 1, this.deps.viewport.pinLeftColumns - 1) : colStart;
		const rightStart = this.deps.viewport.pinRightColumns > 0 ? Math.max(0, colCount - this.deps.viewport.pinRightColumns) : colEnd;

		return {
			minRow: Math.min(rowStart, topEnd, bottomStart),
			maxRow: Math.max(rowEnd, topEnd, bottomStart),
			minCol: Math.min(colStart, leftEnd, rightStart),
			maxCol: Math.max(colEnd, leftEnd, rightStart),
		};
	}
}
