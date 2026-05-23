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
		this.geometry.init(this);
		this.focus.init(this);
		this.selection.init(this);
		this.edit.init(this);

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
			const oldValue = this.data.getCellValue(rowId, colField);

			if (oldValue === value) return;

			this.data.setCellValue(rowId, colField, value);

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
		const currState = this.stateManager.getState();
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
			currState.selectedRangeBounds = this.selection.calculateRangeBounds(
				currState.selectedRange,
				(id) => (this.rowModel ? this.rowModel.getRowIndexById(id) : -1),
				(field) => this.columns.getColumnIndex(field)
			);
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
				currState.visibleRowRange = nextRowRange;
				currState.visibleColRange = nextColRange;
				updatedKeys.push('visibleRowRange', 'visibleColRange');
				this.stateManager.triggerKeyChange('visibleRowRange', prevState);
				this.stateManager.triggerKeyChange('visibleColRange', prevState);
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
			const dirty = this.selection.getDirtyCoordinates(prevState.selectedRangeBounds, currState.selectedRangeBounds);
			if (dirty.length > 0 && this.rowModel) {
				for (let i = 0; i < dirty.length; i++) {
					const { rowIdx, colIdx } = dirty[i];
					const row = this.rowModel.getRow(rowIdx);
					const col = currState.columns[colIdx];
					if (row && col) {
						this.notifyCellChange(this.data.getRowId(row), col.field);
					}
				}
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

		const startRowIdx = rowModel.getRowIndexById(source.start.rowId);
		const endRowIdx = rowModel.getRowIndexById(source.end.rowId);
		const startColIdx = this.columns.getColumnIndex(source.start.colField);
		const endColIdx = this.columns.getColumnIndex(source.end.colField);

		const fillStartRow = Math.min(startRowIdx, endRowIdx);
		const fillEndRow = Math.max(startRowIdx, endRowIdx);
		const fillStartCol = Math.min(startColIdx, endColIdx);
		const fillEndCol = Math.max(startColIdx, endColIdx);

		const tStartRowIdx = rowModel.getRowIndexById(target.start.rowId);
		const tEndRowIdx = rowModel.getRowIndexById(target.end.rowId);
		const tStartColIdx = this.columns.getColumnIndex(target.start.colField);
		const tEndColIdx = this.columns.getColumnIndex(target.end.colField);

		const minRowTarget = Math.min(tStartRowIdx, tEndRowIdx);
		const maxRowTarget = Math.max(tStartRowIdx, tEndRowIdx);
		const minColTarget = Math.min(tStartColIdx, tEndColIdx);
		const maxColTarget = Math.max(tStartColIdx, tEndColIdx);

		let direction: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT' = 'DOWN';
		if (minRowTarget > fillEndRow) direction = 'DOWN';
		else if (maxRowTarget < fillStartRow) direction = 'UP';
		else if (minColTarget > fillEndCol) direction = 'RIGHT';
		else if (maxColTarget < fillStartCol) direction = 'LEFT';

		const oldValueRecord: { rowId: string; colField: string; value: any; hasFormula: boolean; formula?: string }[] = [];
		const newValueRecord: { rowId: string; colField: string; value: any; hasFormula: boolean; formula?: string }[] = [];

		this.batch(() => {
			if (direction === 'DOWN' || direction === 'UP') {
				for (let c = minColTarget; c <= maxColTarget; c++) {
					const col = columns[c];
					if (!col) continue;

					const sourceValues: { value: any; hasFormula: boolean; formula?: string }[] = [];
					for (let r = fillStartRow; r <= fillEndRow; r++) {
						const node = rowModel.getRowNode(r);
						if (node) {
							const hasF = this.dagEngine.hasFormula(node.id, col.field);
							sourceValues.push({
								value: this.data.getCellValue(node.id, col.field),
								hasFormula: hasF,
								formula: hasF ? this.dagEngine.getFormula(node.id, col.field) : undefined,
							});
						}
					}

					if (sourceValues.length === 0) continue;

					const allNumeric = sourceValues.every(s => !s.hasFormula && !Number.isNaN(parseFloat(String(s.value))) && s.value !== '');
					let step = 0;
					let baseNum = 0;
					const numbers = sourceValues.map(s => parseFloat(String(s.value)));

					if (allNumeric && numbers.length > 0) {
						if (numbers.length === 1) {
							step = 0;
							baseNum = numbers[0];
						} else {
							let diffSum = 0;
							for (let i = 0; i < numbers.length - 1; i++) {
								diffSum += numbers[i + 1] - numbers[i];
							}
							step = diffSum / (numbers.length - 1);
							baseNum = numbers[numbers.length - 1];
						}
					}

					const fillRows = [];
					if (direction === 'DOWN') {
						for (let r = minRowTarget; r <= maxRowTarget; r++) fillRows.push(r);
					} else {
						for (let r = maxRowTarget; r >= minRowTarget; r--) fillRows.push(r);
					}

					fillRows.forEach((r, idx) => {
						const node = rowModel.getRowNode(r);
						if (!node) return;

						const oldHasF = this.dagEngine.hasFormula(node.id, col.field);
						oldValueRecord.push({
							rowId: node.id,
							colField: col.field,
							value: this.data.getCellValue(node.id, col.field),
							hasFormula: oldHasF,
							formula: oldHasF ? this.dagEngine.getFormula(node.id, col.field) : undefined,
						});

						const srcIdx = idx % sourceValues.length;
						const srcItem = sourceValues[srcIdx];

						if (srcItem.hasFormula && srcItem.formula) {
							const deltaRow = r - (direction === 'DOWN' ? fillEndRow : fillStartRow);
							const shiftedFormula = this.shiftFormulaReferences(srcItem.formula, deltaRow, 0, rowModel, columns);
							
							this.data.setCellValue(node.id, col.field, shiftedFormula);
							newValueRecord.push({
								rowId: node.id,
								colField: col.field,
								value: undefined,
								hasFormula: true,
								formula: shiftedFormula,
							});
						} else if (allNumeric) {
							let finalVal;
							if (numbers.length === 1) {
								finalVal = baseNum;
							} else {
								finalVal = baseNum + step * (idx + 1);
							}
							const formattedVal = Number.isInteger(finalVal) ? finalVal : parseFloat(finalVal.toFixed(4));
							
							this.dagEngine.clearFormula(node.id, col.field);
							this.data.setCellValue(node.id, col.field, formattedVal);
							newValueRecord.push({
								rowId: node.id,
								colField: col.field,
								value: formattedVal,
								hasFormula: false,
							});
						} else {
							this.dagEngine.clearFormula(node.id, col.field);
							this.data.setCellValue(node.id, col.field, srcItem.value);
							newValueRecord.push({
								rowId: node.id,
								colField: col.field,
								value: srcItem.value,
								hasFormula: false,
							});
						}
					});
				}
			}

			if (direction === 'RIGHT' || direction === 'LEFT') {
				for (let r = minRowTarget; r <= maxRowTarget; r++) {
					const node = rowModel.getRowNode(r);
					if (!node) continue;

					const sourceValues: { value: any; hasFormula: boolean; formula?: string; colField: string }[] = [];
					for (let c = fillStartCol; c <= fillEndCol; c++) {
						const col = columns[c];
						if (col) {
							const hasF = this.dagEngine.hasFormula(node.id, col.field);
							sourceValues.push({
								value: this.data.getCellValue(node.id, col.field),
								hasFormula: hasF,
								formula: hasF ? this.dagEngine.getFormula(node.id, col.field) : undefined,
								colField: col.field,
							});
						}
					}

					if (sourceValues.length === 0) continue;

					const allNumeric = sourceValues.every(s => !s.hasFormula && !Number.isNaN(parseFloat(String(s.value))) && s.value !== '');
					let step = 0;
					let baseNum = 0;
					const numbers = sourceValues.map(s => parseFloat(String(s.value)));

					if (allNumeric && numbers.length > 0) {
						if (numbers.length === 1) {
							step = 0;
							baseNum = numbers[0];
						} else {
							let diffSum = 0;
							for (let i = 0; i < numbers.length - 1; i++) {
								diffSum += numbers[i + 1] - numbers[i];
							}
							step = diffSum / (numbers.length - 1);
							baseNum = numbers[numbers.length - 1];
						}
					}

					const fillCols = [];
					if (direction === 'RIGHT') {
						for (let c = minColTarget; c <= maxColTarget; c++) fillCols.push(c);
					} else {
						for (let c = maxColTarget; c >= minColTarget; c--) fillCols.push(c);
					}

					fillCols.forEach((c, idx) => {
						const col = columns[c];
						if (!col) return;

						const oldHasF = this.dagEngine.hasFormula(node.id, col.field);
						oldValueRecord.push({
							rowId: node.id,
							colField: col.field,
							value: this.data.getCellValue(node.id, col.field),
							hasFormula: oldHasF,
							formula: oldHasF ? this.dagEngine.getFormula(node.id, col.field) : undefined,
						});

						const srcIdx = idx % sourceValues.length;
						const srcItem = sourceValues[srcIdx];

						if (srcItem.hasFormula && srcItem.formula) {
							const deltaCol = c - (direction === 'RIGHT' ? fillEndCol : fillStartCol);
							const shiftedFormula = this.shiftFormulaReferences(srcItem.formula, 0, deltaCol, rowModel, columns);
							
							this.data.setCellValue(node.id, col.field, shiftedFormula);
							newValueRecord.push({
								rowId: node.id,
								colField: col.field,
								value: undefined,
								hasFormula: true,
								formula: shiftedFormula,
							});
						} else if (allNumeric) {
							let finalVal;
							if (numbers.length === 1) {
								finalVal = baseNum;
							} else {
								finalVal = baseNum + step * (idx + 1);
							}
							const formattedVal = Number.isInteger(finalVal) ? finalVal : parseFloat(finalVal.toFixed(4));
							
							this.dagEngine.clearFormula(node.id, col.field);
							this.data.setCellValue(node.id, col.field, formattedVal);
							newValueRecord.push({
								rowId: node.id,
								colField: col.field,
								value: formattedVal,
								hasFormula: false,
							});
						} else {
							this.dagEngine.clearFormula(node.id, col.field);
							this.data.setCellValue(node.id, col.field, srcItem.value);
							newValueRecord.push({
								rowId: node.id,
								colField: col.field,
								value: srcItem.value,
								hasFormula: false,
							});
						}
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
				const colIdx = columns.findIndex(c => c.field === refColField);
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
