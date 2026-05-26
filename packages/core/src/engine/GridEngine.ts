import type { GridState, GridStateUpdater, Listener, RowModel, CellSubscription, GridEventListener, ColumnDef, GridCellRange } from '../store.js';
import { StateManager } from '../state/StateManager.js';
import { createFormulaRefKey } from '../ids.js';
import { CommandBus } from '../commands/CommandBus.js';
import { CommandHistory } from '../commands/CommandHistory.js';
import { EventBus } from '../events/EventBus.js';
import { DataModel } from '../models/DataModel.js';
import { ColumnModel } from '../models/ColumnModel.js';
import { ViewportModel } from '../models/ViewportModel.js';
import { GeometryModel } from '../models/GeometryModel.js';
import { FocusModel } from '../models/FocusModel.js';
import { SelectionModel } from '../models/SelectionModel.js';
import { EditModel } from '../models/EditModel.js';
import { DagEngine } from '../calculations/dagEngine.js';
import type { GridEngineConfig } from './GridEngineConfig.js';
import type { SortModel, FilterModel } from '../rowModel.js';

export class GridEngine<TRowData = unknown> {
	// Models
	public readonly data: DataModel<TRowData>;
	public readonly columns: ColumnModel<TRowData>;
	public readonly viewport: ViewportModel;
	public readonly geometry: GeometryModel;
	public readonly focus: FocusModel;
	public readonly selection: SelectionModel;
	public readonly edit: EditModel;
	public readonly dagEngine: DagEngine;

	// Infrastructure
	public readonly stateManager: StateManager<TRowData>;
	public readonly commandBus: CommandBus;
	public readonly commandHistory: CommandHistory;
	public readonly eventBus: EventBus;

	// Row Model registered internally
	private rowModel: RowModel<TRowData> | null = null;

	// DMSR: Dynamic Multiplexed Subscription Registry
	public readonly cellSubscriptions = new Map<string, Set<CellSubscription>>();
	public readonly colSubscriptions = new Map<string, Set<CellSubscription>>();
	public readonly cellUpdateBatch = new Set<string>();
	public batchFlushScheduled = false;
	private _batchedUpdates = true;

	constructor(config: GridEngineConfig<TRowData>) {
		this.commandBus = new CommandBus();
		this.commandHistory = new CommandHistory();
		this.eventBus = new EventBus();
		this.dagEngine = new DagEngine();

		// Construct sub-models
		this.data = new DataModel<TRowData>();
		this.columns = new ColumnModel<TRowData>();
		this.viewport = new ViewportModel();
		this.geometry = new GeometryModel();
		this.focus = new FocusModel();
		this.selection = new SelectionModel();
		this.edit = new EditModel();

		// Set initial state
		const initialState: GridState<TRowData> = {
			columns: config.columns || [],
			focusedCell: config.focusedCell || null,
			selectedRange: config.selectedRange || null,
			rowHeights: config.rowHeights || {},
			columnWidths: config.columnWidths || {},
			defaultRowHeight: config.defaultRowHeight || 40,
			defaultColWidth: config.defaultColWidth || 100,
			enableColumnReorder: config.enableColumnReorder ?? true,
			activeEdit: config.activeEdit || null,
			sortModel: config.sortModel || null,
			filterModel: config.filterModel || null,
			dataVersion: 0,
			selectedRangeBounds: null,
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			getRowId: config.getRowId,
			loadingSkeletonCount: config.loadingSkeletonCount,
			styleSlots: config.styleSlots,
		};

		// Construct StateManager with coordinate state update bridging
		this.stateManager = new StateManager<TRowData>(initialState, this.handleStateChanges);

		// Link sub-models back to this engine context
		this.data.init(this);
		this.columns.init(this);
		this.viewport.init(this);
		this.geometry.init();
		this.focus.init();
		this.selection.init();
		this.edit.init();

		// Wire up core commands
		this.setupCommandHandlers();

		// Setup columns if they are passed in config
		if (config.columns) {
			this.columns.updateColumns(config.columns, config.columnWidths || {}, config.defaultColWidth);
		}
	}

	private setupCommandHandlers(): void {
		this.commandBus.registerHandler(
			'SET_DATA',
			(payload: { columns?: ColumnDef<TRowData>[]; defaultColWidth?: number; defaultRowHeight?: number }) => {
				this.stateManager.setState((state) => ({
					...state,
					...payload,
				}));
				this.commandHistory.clear();
			}
		);

		this.commandBus.registerHandler('SELECT_CELL', (payload: { start: any; end: any }) => {
			this.setSelectedRange(payload.start, payload.end);
		});

		this.commandBus.registerHandler('FOCUS_CELL', (payload: { rowId: string | null; colField: string | null }) => {
			this.setFocusedCell(payload.rowId, payload.colField);
		});

		this.commandBus.registerHandler('SET_COLUMN_WIDTH', (payload: { colField: string; width: number }) => {
			const colField = payload.colField;
			const newWidth = payload.width;
			const oldWidth = this.stateManager.getState().columnWidths[colField] ?? this.stateManager.getState().defaultColWidth;

			if (oldWidth === newWidth) return;

			this.setColumnWidth(colField, newWidth);

			this.commandHistory.add({
				undo: () => {
					this.setColumnWidth(colField, oldWidth);
				},
				redo: () => {
					this.setColumnWidth(colField, newWidth);
				},
			});
		});

		this.commandBus.registerHandler('MOVE_COLUMN', (payload: { colField: string; toIndex: number }) => {
			const state = this.stateManager.getState();
			const fromIndex = state.columns.findIndex((column) => column.field === payload.colField);
			if (fromIndex === -1) return;

			if (!Number.isFinite(payload.toIndex)) return;
			const toIndex = Math.max(0, Math.min(state.columns.length - 1, Math.trunc(payload.toIndex)));
			if (fromIndex === toIndex) return;

			this.setColumnOrder(this.moveColumnInList(state.columns, fromIndex, toIndex));
		});

		this.commandBus.registerHandler('SET_COLUMN_ORDER', (payload: { colFields: string[] }) => {
			const state = this.stateManager.getState();
			const orderedFieldSet = new Set<string>();
			const orderedFields = payload.colFields.filter((field) => {
				if (orderedFieldSet.has(field)) return false;
				orderedFieldSet.add(field);
				return true;
			});
			const columnByField = new Map(state.columns.map((column) => [column.field, column]));
			const nextColumns = orderedFields
				.map((field) => columnByField.get(field))
				.filter((column): column is ColumnDef<TRowData> => !!column);

			for (const column of state.columns) {
				if (!orderedFieldSet.has(column.field)) {
					nextColumns.push(column);
				}
			}

			this.setColumnOrder(nextColumns);
		});

		this.commandBus.registerHandler('SET_COLUMN_REORDER_ENABLED', (payload: { enabled: boolean }) => {
			this.stateManager.setState({ enableColumnReorder: payload.enabled });
			this.eventBus.dispatchEvent('columnReorderToggled', { enabled: payload.enabled });
		});

		this.commandBus.registerHandler('SET_ROW_HEIGHT', (payload: { rowId: string; height: number }) => {
			const rowId = payload.rowId;
			const newHeight = payload.height;
			const oldHeight = this.stateManager.getState().rowHeights[rowId] ?? this.stateManager.getState().defaultRowHeight;

			if (oldHeight === newHeight) return;

			this.setRowHeight(rowId, newHeight);

			this.commandHistory.add({
				undo: () => {
					this.setRowHeight(rowId, oldHeight);
				},
				redo: () => {
					this.setRowHeight(rowId, newHeight);
				},
			});
		});

		this.commandBus.registerHandler('SET_SORT_MODEL', (payload: { sortModel: SortModel | null }) => {
			const newSort = payload.sortModel;
			const oldSort = this.stateManager.getState().sortModel;

			this.stateManager.setState({ sortModel: newSort });

			this.commandHistory.add({
				undo: () => {
					this.stateManager.setState({ sortModel: oldSort });
				},
				redo: () => {
					this.stateManager.setState({ sortModel: newSort });
				},
			});
		});

		this.commandBus.registerHandler('SET_FILTER_MODEL', (payload: { filterModel: FilterModel | null }) => {
			const newFilter = payload.filterModel;
			const oldFilter = this.stateManager.getState().filterModel;

			this.stateManager.setState({ filterModel: newFilter });

			this.commandHistory.add({
				undo: () => {
					this.stateManager.setState({ filterModel: oldFilter });
				},
				redo: () => {
					this.stateManager.setState({ filterModel: newFilter });
				},
			});
		});

		this.commandBus.registerHandler('SET_CELL_VALUE', (payload: { rowId: string; colField: string; value: unknown; undoable?: boolean }) => {
			const { rowId, colField, value, undoable = true } = payload;
			const oldValue = this.data.getRawCellValue(rowId, colField);

			if (oldValue === value) return;

			const applied = this.data.setCellValue(rowId, colField, value);
			if (!applied) return;

			if (undoable) {
				this.commandHistory.add({
					undo: () => {
						this.commandBus.dispatch({
							type: 'SET_CELL_VALUE',
							payload: { rowId, colField, value: oldValue, undoable: false },
						});
					},
					redo: () => {
						this.commandBus.dispatch({
							type: 'SET_CELL_VALUE',
							payload: { rowId, colField, value, undoable: false },
						});
					},
				});
			}
		});

		this.commandBus.registerHandler('START_EDIT', (payload: { rowId: string; colField: string }) => {
			const { rowId, colField } = payload;
			this.stateManager.setState({
				activeEdit: { rowId, colField },
			});
			this.notifyCellChange(rowId, colField);
			this.eventBus.dispatchEvent('editStarted', { rowId, colField });
		});

		this.commandBus.registerHandler('STOP_EDIT', (payload: { cancel?: boolean }) => {
			const activeEdit = this.stateManager.getState().activeEdit;
			if (!activeEdit) return;

			const { rowId, colField } = activeEdit;
			const cancel = !!payload.cancel;

			this.stateManager.setState({ activeEdit: null });
			this.notifyCellChange(rowId, colField);
			this.eventBus.dispatchEvent('editStopped', { rowId, colField, cancel });
		});
	}

	public registerRowModel(rowModel: RowModel<TRowData>): void {
		this.rowModel = rowModel;
		// Refresh coordinates
		const state = this.stateManager.getState();
		this.geometry.updateRows(this.getRowHeightsList(rowModel, state.rowHeights, state.defaultRowHeight), state.defaultRowHeight);
		this.stateManager.setState({ dataVersion: state.dataVersion + 1 });
	}

	public getRowModel(): RowModel<TRowData> | null {
		return this.rowModel;
	}

	private getRowHeightsList(rowModel: RowModel<TRowData>, rowHeightsRecord: Record<string, number>, defaultRowHeight: number): number[] {
		let count = rowModel.getRowCount();
		const state = this.stateManager.getState();
		if (state.loading && count === 0) {
			count = state.loadingSkeletonCount ?? 15;
		}
		const heights: number[] = [];
		for (let i = 0; i < count; i++) {
			const node = rowModel.getRowNode(i);
			if (node) {
				const explicitHeight = rowHeightsRecord[node.id];
				heights.push(explicitHeight !== undefined ? explicitHeight : defaultRowHeight);
			} else {
				heights.push(defaultRowHeight);
			}
		}
		return heights;
	}

	public get batchedUpdates(): boolean {
		return this._batchedUpdates;
	}

	public set batchedUpdates(enabled: boolean) {
		this._batchedUpdates = enabled;
		if (!enabled && this.cellUpdateBatch.size > 0) {
			this.flushCellUpdates();
		}
	}

	public batch = (callback: () => void): void => {
		const prev = this._batchedUpdates;
		this._batchedUpdates = true;
		this.stateManager.startTransaction();
		try {
			callback();
		} finally {
			this._batchedUpdates = prev;
			this.stateManager.endTransaction();
			if (this.cellUpdateBatch.size > 0) {
				this.flushCellUpdatesSync();
			}
		}
	};

	public flushCellUpdates(): void {
		this.cellUpdateBatch.forEach((key) => {
			const colonIdx = key.indexOf(':');
			const rowId = colonIdx === -1 ? key : key.substring(0, colonIdx);
			const colField = colonIdx === -1 ? '' : key.substring(colonIdx + 1);
			this.notifyCellChange(rowId, colField);
		});
		this.cellUpdateBatch.clear();
		this.batchFlushScheduled = false;
	}

	public flushCellUpdatesSync(): void {
		if (this.cellUpdateBatch.size > 0) {
			this.flushCellUpdates();
		}
	}

	public notifyCellChange(rowId: string, colField: string): void {
		const cellKey = `${rowId}:${colField}`;
		const cellSubs = this.cellSubscriptions.get(cellKey);
		if (cellSubs) {
			cellSubs.forEach((sub) => {
				try {
					sub.onStoreChange();
				} catch (e) {
					console.error(`GridEngine: Error in DMSR coordinate notification`, e);
				}
			});
		}
	}

	public registerCellSubscription = (sub: CellSubscription): void => {
		const cellKey = `${sub.rowId}:${sub.colField}`;
		if (!this.cellSubscriptions.has(cellKey)) {
			this.cellSubscriptions.set(cellKey, new Set());
		}
		this.cellSubscriptions.get(cellKey)!.add(sub);

		if (!this.colSubscriptions.has(sub.colField)) {
			this.colSubscriptions.set(sub.colField, new Set());
		}
		this.colSubscriptions.get(sub.colField)!.add(sub);
	};

	public unregisterCellSubscription = (sub: CellSubscription): void => {
		const cellKey = `${sub.rowId}:${sub.colField}`;
		const cellSet = this.cellSubscriptions.get(cellKey);
		if (cellSet) {
			cellSet.delete(sub);
			if (cellSet.size === 0) {
				this.cellSubscriptions.delete(cellKey);
			}
		}

		const colSet = this.colSubscriptions.get(sub.colField);
		if (colSet) {
			colSet.delete(sub);
			if (colSet.size === 0) {
				this.colSubscriptions.delete(sub.colField);
			}
		}
	};

	public updateCellSubscription = (sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void => {
		const oldCellKey = `${oldRowId}:${oldColField}`;
		const oldCellSet = this.cellSubscriptions.get(oldCellKey);
		if (oldCellSet) {
			oldCellSet.delete(sub);
			if (oldCellSet.size === 0) {
				this.cellSubscriptions.delete(oldCellKey);
			}
		}

		const newCellKey = `${newRowId}:${newColField}`;
		if (!this.cellSubscriptions.has(newCellKey)) {
			this.cellSubscriptions.set(newCellKey, new Set());
		}
		this.cellSubscriptions.get(newCellKey)!.add(sub);

		if (oldColField !== newColField) {
			const oldColSet = this.colSubscriptions.get(oldColField);
			if (oldColSet) {
				oldColSet.delete(sub);
				if (oldColSet.size === 0) {
					this.colSubscriptions.delete(oldColField);
				}
			}

			if (!this.colSubscriptions.has(newColField)) {
				this.colSubscriptions.set(newColField, new Set());
			}
			this.colSubscriptions.get(newColField)!.add(sub);
		}
	};

	public setFocusedCell = (rowId: string | null, colField: string | null): void => {
		this.stateManager.setState({
			focusedCell: rowId !== null && colField !== null ? { rowId, colField } : null,
		});
	};

	public setSelectedRange = (start: any | null, end: any | null): void => {
		this.stateManager.setState({
			selectedRange: start !== null && end !== null ? { start, end } : null,
		});
	};

	public setColumnWidth = (colField: string, width: number): void => {
		this.stateManager.setState((state) => ({
			columnWidths: {
				...state.columnWidths,
				[colField]: width,
			},
		}));

		this.eventBus.dispatchEvent('columnResized', {
			colField,
			width,
		});
	};

	public setColumnOrder(columns: ColumnDef<TRowData>[]): void {
		const prevFields = this.stateManager.getState().columns.map((column) => column.field);
		const nextFields = columns.map((column) => column.field);
		if (prevFields.length === nextFields.length && prevFields.every((field, index) => field === nextFields[index])) {
			return;
		}

		this.stateManager.setState({ columns });
		this.eventBus.dispatchEvent('columnOrderChanged', {
			columns,
			columnFields: nextFields,
		});
	}

	private moveColumnInList(columns: ColumnDef<TRowData>[], fromIndex: number, toIndex: number): ColumnDef<TRowData>[] {
		const nextColumns = [...columns];
		const [column] = nextColumns.splice(fromIndex, 1);
		nextColumns.splice(toIndex, 0, column);
		return nextColumns;
	}

	public setRowHeight = (rowId: string, height: number): void => {
		this.stateManager.setState((state) => ({
			rowHeights: {
				...state.rowHeights,
				[rowId]: height,
			},
		}));

		this.eventBus.dispatchEvent('rowResized', {
			rowId,
			height,
		});
	};

	// State-to-coordinate change mapping bridge callback
	private handleStateChanges = (prevState: GridState<TRowData>, updatedKeys: string[]): void => {
		let currState = this.stateManager.getState();
		const updatedSet = new Set(updatedKeys);

		// Synchronize sub-models
		if (updatedSet.has('columns') || updatedSet.has('columnWidths') || updatedSet.has('defaultColWidth')) {
			this.columns.updateColumns(currState.columns, currState.columnWidths, currState.defaultColWidth);
		}

		if (this.rowModel && (updatedSet.has('rowHeights') || updatedSet.has('defaultRowHeight') || updatedSet.has('dataVersion') || updatedSet.has('loading'))) {
			this.geometry.updateRows(
				this.getRowHeightsList(this.rowModel, currState.rowHeights, currState.defaultRowHeight),
				currState.defaultRowHeight
			);
		}

		if (updatedSet.has('selectedRange') || updatedSet.has('columns') || updatedSet.has('dataVersion')) {
			const selectedRangeBounds = this.selection.calculateRangeBounds(
				currState.selectedRange,
				(id) => (this.rowModel ? this.rowModel.getRowIndexById(id) : -1),
				(field) => this.columns.getColumnIndex(field)
			);
			if (currState.selectedRangeBounds !== selectedRangeBounds) {
				for (const key of this.stateManager.setDerivedState({ selectedRangeBounds }, prevState)) {
					updatedSet.add(key);
					updatedKeys.push(key);
					this.stateManager.triggerKeyChange(key, prevState);
				}
				currState = this.stateManager.getState();
			}
		}

		if (updatedSet.has('focusedCell')) {
			const cell = currState.focusedCell;
			this.focus.setFocusedCell(cell ? cell.rowId : null, cell ? cell.colField : null);
		}

		if (updatedSet.has('selectedRange')) {
			this.selection.setSelectedRange(currState.selectedRange, currState.selectedRangeBounds);
		}

		// Calculate visible ranges if relevant geometry/data properties changed
		const needsRangeUpdate =
			updatedSet.has('columns') ||
			updatedSet.has('columnWidths') ||
			updatedSet.has('rowHeights') ||
			updatedSet.has('dataVersion') ||
			updatedSet.has('defaultRowHeight') ||
			updatedSet.has('defaultColWidth') ||
			updatedSet.has('loading');

		if (needsRangeUpdate) {
			const nextRowRange = this.viewport.getVisibleRowRange(this.rowModel ? this.rowModel.getRowCount() : 0);
			const nextColRange = this.viewport.getVisibleColumnRange(currState.columns.length);

			const rowRangeChanged =
				!currState.visibleRowRange ||
				currState.visibleRowRange.startIdx !== nextRowRange.startIdx ||
				currState.visibleRowRange.endIdx !== nextRowRange.endIdx;
			const colRangeChanged =
				!currState.visibleColRange ||
				currState.visibleColRange.startIdx !== nextColRange.startIdx ||
				currState.visibleColRange.endIdx !== nextColRange.endIdx;

			if (rowRangeChanged || colRangeChanged) {
				for (const key of this.stateManager.setDerivedState({ visibleRowRange: nextRowRange, visibleColRange: nextColRange }, prevState)) {
					updatedSet.add(key);
					updatedKeys.push(key);
					this.stateManager.triggerKeyChange(key, prevState);
				}
				currState = this.stateManager.getState();
			}
		}

		// Notify coordinate cell subscriptions
		if (updatedSet.has('focusedCell')) {
			if (prevState.focusedCell) this.notifyCellChange(prevState.focusedCell.rowId, prevState.focusedCell.colField);
			if (currState.focusedCell) this.notifyCellChange(currState.focusedCell.rowId, currState.focusedCell.colField);
		}

		if (updatedSet.has('activeEdit')) {
			if (prevState.activeEdit) this.notifyCellChange(prevState.activeEdit.rowId, prevState.activeEdit.colField);
			if (currState.activeEdit) this.notifyCellChange(currState.activeEdit.rowId, currState.activeEdit.colField);
		}

		if (updatedSet.has('selectedRange')) {
			const rowModel = this.rowModel;
			if (rowModel) {
				const viewport = this.getSelectionNotificationViewport();
				this.selection.forEachDirtyCoordinateInViewport(prevState.selectedRangeBounds, currState.selectedRangeBounds, viewport, (rowIdx, colIdx) => {
					const row = rowModel.getRow(rowIdx);
					const col = currState.columns[colIdx];
					if (row && col) {
						this.notifyCellChange(this.data.getRowId(row), col.field);
					}
				});
			}
		}

		if (updatedSet.has('columnWidths')) {
			const prevWidths = prevState.columnWidths;
			const currWidths = currState.columnWidths;
			const allCols = new Set([...Object.keys(prevWidths), ...Object.keys(currWidths)]);
			allCols.forEach((colField) => {
				if (prevWidths[colField] !== currWidths[colField]) {
					const colSubs = this.colSubscriptions.get(colField);
					if (colSubs) {
						colSubs.forEach((sub) => {
							try {
								sub.onStoreChange();
							} catch (e) {
								console.error(`GridEngine: Error in DMSR column notification`, e);
							}
						});
					}
				}
			});
		}

		if (updatedSet.has('dataVersion')) {
			this.cellSubscriptions.forEach((subs) => {
				subs.forEach((sub) => {
					try {
						sub.onStoreChange();
					} catch (e) {
						console.error(`GridEngine: Error in DMSR dataVersion notification`, e);
					}
				});
			});
		}

		// Propagate structured events
		if (updatedSet.has('focusedCell')) {
			this.eventBus.dispatchEvent('focusChanged', { focusedCell: currState.focusedCell });
		}
		if (updatedSet.has('selectedRange')) {
			this.eventBus.dispatchEvent('selectionChanged', { selectedRange: currState.selectedRange });
		}
		if (updatedSet.has('sortModel')) {
			this.eventBus.dispatchEvent('sortChanged', { sortModel: currState.sortModel });
		}
		if (updatedSet.has('filterModel')) {
			this.eventBus.dispatchEvent('filterChanged', { filterModel: currState.filterModel });
		}
	};

	private getSelectionNotificationViewport(): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
		const state = this.stateManager.getState();
		const rowCount = this.rowModel ? this.rowModel.getRowCount() : 0;
		const colCount = state.columns.length;

		if (rowCount === 0 || colCount === 0) {
			return { minRow: 1, maxRow: 0, minCol: 1, maxCol: 0 };
		}

		const rowStart = Math.max(0, Math.min(state.visibleRowRange.startIdx, rowCount - 1));
		const rowEnd = Math.max(rowStart, Math.min(state.visibleRowRange.endIdx, rowCount - 1));
		const colStart = Math.max(0, Math.min(state.visibleColRange.startIdx, colCount - 1));
		const colEnd = Math.max(colStart, Math.min(state.visibleColRange.endIdx, colCount - 1));
		const topEnd = this.viewport.pinTopRows > 0 ? Math.min(rowCount - 1, this.viewport.pinTopRows - 1) : rowStart;
		const bottomStart = this.viewport.pinBottomRows > 0 ? Math.max(0, rowCount - this.viewport.pinBottomRows) : rowEnd;
		const leftEnd = this.viewport.pinLeftColumns > 0 ? Math.min(colCount - 1, this.viewport.pinLeftColumns - 1) : colStart;
		const rightStart = this.viewport.pinRightColumns > 0 ? Math.max(0, colCount - this.viewport.pinRightColumns) : colEnd;

		return {
			minRow: Math.min(rowStart, topEnd, bottomStart),
			maxRow: Math.max(rowEnd, topEnd, bottomStart),
			minCol: Math.min(colStart, leftEnd, rightStart),
			maxCol: Math.max(colEnd, leftEnd, rightStart),
		};
	}

	public undo(): void {
		this.commandHistory.undo();
	}

	public redo(): void {
		this.commandHistory.redo();
	}

	public fillRange(source: GridCellRange, target: GridCellRange): void {
		const rowModel = this.getRowModel();
		if (!rowModel) return;

		const state = this.stateManager.getState();
		const columns = state.columns;

		const sourceBounds = this.resolveRangeBounds(source);
		const targetBounds = this.resolveRangeBounds(target);
		if (!sourceBounds || !targetBounds) return;

		let direction: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT' = 'DOWN';
		if (targetBounds.minRow > sourceBounds.maxRow) direction = 'DOWN';
		else if (targetBounds.maxRow < sourceBounds.minRow) direction = 'UP';
		else if (targetBounds.minCol > sourceBounds.maxCol) direction = 'RIGHT';
		else if (targetBounds.maxCol < sourceBounds.minCol) direction = 'LEFT';

		const oldValueRecord: { rowId: string; colField: string; value: any; hasFormula: boolean; formula?: string }[] = [];
		const newValueRecord: { rowId: string; colField: string; value: any; hasFormula: boolean; formula?: string }[] = [];

		this.batch(() => {
			if (direction === 'DOWN' || direction === 'UP') {
				const fillRows = this.buildOrderedIndexes(targetBounds.minRow, targetBounds.maxRow, direction === 'UP');
				for (let c = targetBounds.minCol; c <= targetBounds.maxCol; c++) {
					const col = columns[c];
					if (!col) continue;

					const sourceValues: Array<{ value: any; hasFormula: boolean; formula?: string }> = [];
					for (let r = sourceBounds.minRow; r <= sourceBounds.maxRow; r++) {
						const node = rowModel.getRowNode(r);
						if (node) sourceValues.push(this.captureCell(node.id, col.field));
					}

					if (sourceValues.length === 0) continue;

					const series = this.analyzeFillSeries(sourceValues);
					fillRows.forEach((r, idx) => {
						const node = rowModel.getRowNode(r);
						if (!node) return;

						const srcItem = sourceValues[idx % sourceValues.length];
						const deltaRow = r - (direction === 'DOWN' ? sourceBounds.maxRow : sourceBounds.minRow);
						this.applyFillValue(node.id, col.field, idx, srcItem, series, deltaRow, 0, rowModel, columns, oldValueRecord, newValueRecord);
					});
				}
			}

			if (direction === 'RIGHT' || direction === 'LEFT') {
				const fillCols = this.buildOrderedIndexes(targetBounds.minCol, targetBounds.maxCol, direction === 'LEFT');
				for (let r = targetBounds.minRow; r <= targetBounds.maxRow; r++) {
					const node = rowModel.getRowNode(r);
					if (!node) continue;

					const sourceValues: Array<{ value: any; hasFormula: boolean; formula?: string }> = [];
					for (let c = sourceBounds.minCol; c <= sourceBounds.maxCol; c++) {
						const col = columns[c];
						if (col) sourceValues.push(this.captureCell(node.id, col.field));
					}

					if (sourceValues.length === 0) continue;

					const series = this.analyzeFillSeries(sourceValues);
					fillCols.forEach((c, idx) => {
						const col = columns[c];
						if (!col) return;

						const srcItem = sourceValues[idx % sourceValues.length];
						const deltaCol = c - (direction === 'RIGHT' ? sourceBounds.maxCol : sourceBounds.minCol);
						this.applyFillValue(node.id, col.field, idx, srcItem, series, 0, deltaCol, rowModel, columns, oldValueRecord, newValueRecord);
					});
				}
			}
		});

		if (newValueRecord.length > 0) {
			this.commandHistory.add({
				undo: () => {
					this.batch(() => {
						for (const item of oldValueRecord) {
							if (item.hasFormula && item.formula) {
								this.data.setCellValue(item.rowId, item.colField, item.formula);
							} else {
								this.dagEngine.clearFormula(item.rowId, item.colField);
								this.data.setCellValue(item.rowId, item.colField, item.value);
							}
						}
					});
				},
				redo: () => {
					this.batch(() => {
						for (const item of newValueRecord) {
							if (item.hasFormula && item.formula) {
								this.data.setCellValue(item.rowId, item.colField, item.formula);
							} else {
								this.dagEngine.clearFormula(item.rowId, item.colField);
								this.data.setCellValue(item.rowId, item.colField, item.value);
							}
						}
					});
				},
			});
		}
	}

	private resolveRangeBounds(range: GridCellRange): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
		const rowModel = this.getRowModel();
		if (!rowModel) return null;

		const startRowIdx = rowModel.getRowIndexById(range.start.rowId);
		const endRowIdx = rowModel.getRowIndexById(range.end.rowId);
		const startColIdx = this.columns.getColumnIndex(range.start.colField);
		const endColIdx = this.columns.getColumnIndex(range.end.colField);

		if (startRowIdx < 0 || endRowIdx < 0 || startColIdx < 0 || endColIdx < 0) return null;

		return {
			minRow: Math.min(startRowIdx, endRowIdx),
			maxRow: Math.max(startRowIdx, endRowIdx),
			minCol: Math.min(startColIdx, endColIdx),
			maxCol: Math.max(startColIdx, endColIdx),
		};
	}

	private buildOrderedIndexes(start: number, end: number, reverse: boolean): number[] {
		const indexes: number[] = [];
		if (reverse) {
			for (let i = end; i >= start; i--) indexes.push(i);
		} else {
			for (let i = start; i <= end; i++) indexes.push(i);
		}
		return indexes;
	}

	private captureCell(rowId: string, colField: string): { value: any; hasFormula: boolean; formula?: string } {
		const hasFormula = this.dagEngine.hasFormula(rowId, colField);
		return {
			value: this.data.getCellValue(rowId, colField),
			hasFormula,
			formula: hasFormula ? this.dagEngine.getFormula(rowId, colField) : undefined,
		};
	}

	private analyzeFillSeries(sourceValues: Array<{ value: any; hasFormula: boolean }>): { allNumeric: boolean; baseNum: number; step: number } {
		const allNumeric = sourceValues.every((s) => !s.hasFormula && !Number.isNaN(parseFloat(String(s.value))) && s.value !== '');
		if (!allNumeric || sourceValues.length === 0) return { allNumeric: false, baseNum: 0, step: 0 };

		const numbers = sourceValues.map((s) => parseFloat(String(s.value)));
		if (numbers.length === 1) return { allNumeric: true, baseNum: numbers[0], step: 0 };

		let diffSum = 0;
		for (let i = 0; i < numbers.length - 1; i++) {
			diffSum += numbers[i + 1] - numbers[i];
		}
		return { allNumeric: true, baseNum: numbers[numbers.length - 1], step: diffSum / (numbers.length - 1) };
	}

	private applyFillValue(
		rowId: string,
		colField: string,
		index: number,
		source: { value: any; hasFormula: boolean; formula?: string },
		series: { allNumeric: boolean; baseNum: number; step: number },
		deltaRow: number,
		deltaCol: number,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[],
		oldValueRecord: { rowId: string; colField: string; value: any; hasFormula: boolean; formula?: string }[],
		newValueRecord: { rowId: string; colField: string; value: any; hasFormula: boolean; formula?: string }[]
	): void {
		const oldValue = this.captureCell(rowId, colField);
		let nextValue = source.value;
		let nextFormula: string | undefined;

		if (source.hasFormula && source.formula) {
			nextFormula = this.shiftFormulaReferences(source.formula, deltaRow, deltaCol, rowModel, columns);
			nextValue = nextFormula;
		} else if (series.allNumeric) {
			const finalVal = series.step === 0 ? series.baseNum : series.baseNum + series.step * (index + 1);
			nextValue = Number.isInteger(finalVal) ? finalVal : parseFloat(finalVal.toFixed(4));
		}

		const applied = this.data.setCellValue(rowId, colField, nextValue);
		if (!applied) return;

		oldValueRecord.push({ rowId, colField, ...oldValue });
		newValueRecord.push({
			rowId,
			colField,
			value: nextFormula ? undefined : nextValue,
			hasFormula: !!nextFormula,
			formula: nextFormula,
		});
	}

	private shiftFormulaReferences(
		formula: string,
		deltaRow: number,
		deltaCol: number,
		rowModel: any,
		columns: ColumnDef<any>[]
	): string {
		const regex = /\[([^\]:]+):([^\]:]+)\]/g;
		return formula.replace(regex, (match, refRowId, refColField) => {
			let newRowId = refRowId;
			let newColField = refColField;

			if (deltaRow !== 0 && rowModel) {
				const rowIdx = rowModel.getRowIndexById(refRowId);
				if (rowIdx !== -1) {
					const newRowIdx = rowIdx + deltaRow;
					const newRowNode = rowModel.getRowNode(newRowIdx);
					if (newRowNode) {
						newRowId = newRowNode.id;
					}
				}
			}

			if (deltaCol !== 0) {
				const colIdx = this.columns.getColumnIndex(refColField);
				if (colIdx !== -1) {
					const newColIdx = colIdx + deltaCol;
					const newCol = columns[newColIdx];
					if (newCol) {
						newColField = newCol.field;
					}
				}
			}

			return createFormulaRefKey(newRowId, newColField);
		});
	}

	public destroy(): void {
		this.cellSubscriptions.clear();
		this.colSubscriptions.clear();
		this.cellUpdateBatch.clear();
		this.eventBus.clear();
		this.commandBus.clear();
		this.stateManager.destroy();
	}
}
