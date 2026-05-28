import type { GridState, RowModel, CellSubscription, ColumnDef, GridCellRange, GridCellPointer, GridSelectionSource } from '../store.js';
import { StateManager } from '../state/StateManager.js';
import { CommandHistory } from '../commands/CommandHistory.js';
import { EventBus } from '../events/EventBus.js';
import { DataModel } from '../models/DataModel.js';
import { ColumnModel } from '../models/ColumnModel.js';
import { ViewportModel } from '../models/ViewportModel.js';
import { GeometryModel } from '../models/GeometryModel.js';
import { SelectionModel } from '../models/SelectionModel.js';
import { EditModel } from '../models/EditModel.js';
import { CellAccessModel } from '../models/CellAccess.js';
import { DagEngine } from '../calculations/dagEngine.js';
import { SpreadsheetFillEngine } from '../spreadsheet/fillRange.js';
import type { GridEngineConfig } from './GridEngineConfig.js';
import type { SortModel, FilterModel } from '../rowModel.js';

export class GridEngine<TRowData = unknown> {
	// Models
	public readonly data: DataModel<TRowData>;
	public readonly columns: ColumnModel<TRowData>;
	public readonly viewport: ViewportModel<TRowData>;
	public readonly geometry: GeometryModel;
	public readonly selection: SelectionModel;
	public readonly edit: EditModel;
	public readonly cellAccess: CellAccessModel<TRowData>;

	// Infrastructure
	public readonly stateManager: StateManager<TRowData>;
	public readonly commandHistory: CommandHistory;
	public readonly eventBus: EventBus;
	private readonly formulas: DagEngine;
	private readonly spreadsheetFill: SpreadsheetFillEngine<TRowData>;

	// Row Model registered internally
	private rowModel: RowModel<TRowData> | null = null;

	// Cell subscriptions are keyed by visible row id and column field.
	public readonly cellSubscriptions = new Map<string, Set<CellSubscription>>();
	public readonly colSubscriptions = new Map<string, Set<CellSubscription>>();
	public readonly cellUpdateBatch = new Set<string>();
	public batchFlushScheduled = false;
	private _batchedUpdates = true;

	constructor(config: GridEngineConfig<TRowData>) {
		this.commandHistory = new CommandHistory();
		this.eventBus = new EventBus();
		this.formulas = new DagEngine();
		this.spreadsheetFill = new SpreadsheetFillEngine(this);

		// Construct sub-models
		this.data = new DataModel<TRowData>();
		this.columns = new ColumnModel<TRowData>();
		this.viewport = new ViewportModel<TRowData>();
		this.geometry = new GeometryModel();
		this.selection = new SelectionModel();
		this.edit = new EditModel();
		this.cellAccess = new CellAccessModel<TRowData>();

		const initialSelection = config.selection ?? this.selection.createCellSelection(null, 'program');

		// Set initial state
		const initialState: GridState<TRowData> = {
			columns: config.columns || [],
			selection: initialSelection,
			rowHeights: config.rowHeights || {},
			columnWidths: config.columnWidths || {},
			defaultRowHeight: config.defaultRowHeight || 40,
			defaultColWidth: config.defaultColWidth || 100,
			enableColumnReorder: config.enableColumnReorder ?? true,
			activeEdit: config.activeEdit || null,
			sortModel: config.sortModel || null,
			filterModel: config.filterModel || null,
			dataVersion: 0,
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
		this.selection.init();
		this.edit.init();
		this.cellAccess.init(this);

		// Setup columns if they are passed in config
		if (config.columns) {
			this.columns.updateColumns(config.columns, config.columnWidths || {}, config.defaultColWidth);
		}
	}

	public setData(payload: { columns?: ColumnDef<TRowData>[]; defaultColWidth?: number; defaultRowHeight?: number }): void {
		this.stateManager.setState((state) => ({
			...state,
			...payload,
		}));
		this.commandHistory.clear();
	}

	public selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'api'): void {
		this.applySelectionRange(start, end, source);
	}

	public resizeColumn(colField: string, width: number, undoable = true): void {
		const oldWidth = this.stateManager.getState().columnWidths[colField] ?? this.stateManager.getState().defaultColWidth;
		if (oldWidth === width) return;

		this.applyColumnWidth(colField, width);

		if (undoable) {
			this.commandHistory.add({
				undo: () => this.applyColumnWidth(colField, oldWidth),
				redo: () => this.applyColumnWidth(colField, width),
			});
		}
	}

	public moveColumn(colField: string, toIndex: number): void {
		const state = this.stateManager.getState();
		const fromIndex = state.columns.findIndex((column) => column.field === colField);
		if (fromIndex === -1 || !Number.isFinite(toIndex)) return;

		const boundedToIndex = Math.max(0, Math.min(state.columns.length - 1, Math.trunc(toIndex)));
		if (fromIndex === boundedToIndex) return;

		this.applyColumnOrder(this.moveColumnInList(state.columns, fromIndex, boundedToIndex));
	}

	public setColumnOrderByFields(colFields: string[]): void {
		const state = this.stateManager.getState();
		const orderedFieldSet = new Set<string>();
		const orderedFields = colFields.filter((field) => {
			if (orderedFieldSet.has(field)) return false;
			orderedFieldSet.add(field);
			return true;
		});
		const columnByField = new Map(state.columns.map((column) => [column.field, column]));
		const nextColumns = orderedFields.map((field) => columnByField.get(field)).filter((column): column is ColumnDef<TRowData> => !!column);

		for (const column of state.columns) {
			if (!orderedFieldSet.has(column.field)) {
				nextColumns.push(column);
			}
		}

		this.applyColumnOrder(nextColumns);
	}

	public setColumnReorderEnabled(enabled: boolean): void {
		this.stateManager.setState({ enableColumnReorder: enabled });
		this.eventBus.dispatchEvent('columnReorderToggled', { enabled });
	}

	public resizeRow(rowId: string, height: number, undoable = true): void {
		const oldHeight = this.stateManager.getState().rowHeights[rowId] ?? this.stateManager.getState().defaultRowHeight;
		if (oldHeight === height) return;

		this.applyRowHeight(rowId, height);

		if (undoable) {
			this.commandHistory.add({
				undo: () => this.applyRowHeight(rowId, oldHeight),
				redo: () => this.applyRowHeight(rowId, height),
			});
		}
	}

	public setSortModel(sortModel: SortModel | null, undoable = true): void {
		const oldSort = this.stateManager.getState().sortModel;
		this.stateManager.setState({ sortModel });

		if (undoable) {
			this.commandHistory.add({
				undo: () => this.stateManager.setState({ sortModel: oldSort }),
				redo: () => this.stateManager.setState({ sortModel }),
			});
		}
	}

	public setFilterModel(filterModel: FilterModel | null, undoable = true): void {
		const oldFilter = this.stateManager.getState().filterModel;
		this.stateManager.setState({ filterModel });

		if (undoable) {
			this.commandHistory.add({
				undo: () => this.stateManager.setState({ filterModel: oldFilter }),
				redo: () => this.stateManager.setState({ filterModel }),
			});
		}
	}

	public setCellValue(rowId: string, colField: string, value: unknown, undoable = true): void {
		const oldValue = this.data.getRawCellValue(rowId, colField);
		if (oldValue === value) return;

		const applied = this.data.setCellValue(rowId, colField, value);
		if (!applied) return;

		if (undoable) {
			this.commandHistory.add({
				undo: () => this.setCellValue(rowId, colField, oldValue, false),
				redo: () => this.setCellValue(rowId, colField, value, false),
			});
		}
	}

	public startEdit(rowId: string, colField: string): void {
		this.stateManager.setState({
			activeEdit: { rowId, colField },
		});
		this.notifyCellChange(rowId, colField);
		this.eventBus.dispatchEvent('editStarted', { rowId, colField });
	}

	public stopEdit(cancel = false): void {
		const activeEdit = this.stateManager.getState().activeEdit;
		if (!activeEdit) return;

		const { rowId, colField } = activeEdit;
		this.stateManager.setState({ activeEdit: null });
		this.notifyCellChange(rowId, colField);
		this.eventBus.dispatchEvent('editStopped', { rowId, colField, cancel });
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

	public clearFormulas(): void {
		this.formulas.clearAll();
	}

	public hasFormula(rowId: string, colField: string): boolean {
		return this.formulas.hasFormula(rowId, colField);
	}

	public getFormula(rowId: string, colField: string): string | undefined {
		return this.formulas.getFormula(rowId, colField);
	}

	public syncFormulaForCell(rowId: string, colField: string, value: unknown): void {
		if (typeof value === 'string' && value.startsWith('=')) {
			this.formulas.registerFormula(rowId, colField, value);
			return;
		}
		this.formulas.clearFormula(rowId, colField);
	}

	public evaluateFormulaCell(rowId: string, colField: string, getRawValue: (rId: string, cField: string) => unknown): unknown {
		return this.formulas.getCellValue(rowId, colField, getRawValue);
	}

	public invalidateFormulaCell(rowId: string, colField: string): string[] {
		return this.formulas.invalidateCell(rowId, colField);
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
		this.data.clearValueGetterCache(rowId, colField);
		const cellKey = `${rowId}:${colField}`;
		const cellSubs = this.cellSubscriptions.get(cellKey);
		if (cellSubs) {
			cellSubs.forEach((sub) => {
				try {
					sub.onStoreChange();
				} catch (e) {
					console.error(`GridEngine: Error in cell subscription notification`, e);
				}
			});
		}
		this.eventBus.dispatchEvent('cellInvalidated', { rowId, colField });
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

	private applySelectionRange = (start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'program'): void => {
		const range = start !== null && end !== null ? { start, end } : null;
		const selection = this.selection.setSelection({
			focus: end,
			anchor: start,
			range,
			source,
		});
		this.stateManager.setState({
			selection,
		});
	};

	public setColumns(columns: ColumnDef<TRowData>[], undoable = false): void {
		const state = this.stateManager.getState();

		const prevColumns = state.columns;
		const prevWidths = state.columnWidths;

		const nextWidths = columns.reduce<Record<string, number>>((acc, column) => {
			const existingWidth = prevWidths[column.field];

			if (existingWidth !== undefined) {
				acc[column.field] = existingWidth;
			} else if (column.width !== undefined) {
				acc[column.field] = column.width;
			}

			return acc;
		}, {});

		this.stateManager.setState({
			columns,
			columnWidths: nextWidths,
		});

		this.eventBus.dispatchEvent('columnsChanged', {
			columns,
			columnFields: columns.map((column) => column.field),
		});

		if (undoable) {
			this.commandHistory.add({
				undo: () => {
					this.stateManager.setState({
						columns: prevColumns,
						columnWidths: prevWidths,
					});
				},
				redo: () => {
					this.stateManager.setState({
						columns,
						columnWidths: nextWidths,
					});
				},
			});
		}
	}

	private applyColumnWidth = (colField: string, width: number): void => {
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

	private applyColumnOrder(columns: ColumnDef<TRowData>[]): void {
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

	private applyRowHeight = (rowId: string, height: number): void => {
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

		if (updatedSet.has('dataVersion')) {
			this.data.clearValueGetterCache();
		}

		if (
			this.rowModel &&
			(updatedSet.has('rowHeights') || updatedSet.has('defaultRowHeight') || updatedSet.has('dataVersion') || updatedSet.has('loading'))
		) {
			this.geometry.updateRows(
				this.getRowHeightsList(this.rowModel, currState.rowHeights, currState.defaultRowHeight),
				currState.defaultRowHeight
			);
		}

		if (updatedSet.has('selection') || updatedSet.has('columns') || updatedSet.has('dataVersion')) {
			const rangeBounds = this.selection.calculateRangeBounds(
				currState.selection.range,
				(id) => (this.rowModel ? this.rowModel.getRowIndexById(id) : -1),
				(field) => this.columns.getColumnIndex(field)
			);
			const nextBounds = this.areRangeBoundsEqual(currState.selection.bounds, rangeBounds) ? currState.selection.bounds : rangeBounds;
			const selection = this.selection.setSelection({
				...currState.selection,
				bounds: nextBounds,
			});
			if (currState.selection !== selection) {
				for (const key of this.stateManager.setDerivedState({ selection }, prevState)) {
					const wasAlreadyUpdated = updatedSet.has(key);
					updatedSet.add(key);
					updatedKeys.push(key);
					if (!wasAlreadyUpdated) {
						this.stateManager.triggerKeyChange(key, prevState);
					}
				}
				currState = this.stateManager.getState();
			}
		}

		if (updatedSet.has('selection')) {
			this.selection.setSelection(currState.selection);
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
					const wasAlreadyUpdated = updatedSet.has(key);
					updatedSet.add(key);
					updatedKeys.push(key);
					if (!wasAlreadyUpdated) {
						this.stateManager.triggerKeyChange(key, prevState);
					}
				}
				currState = this.stateManager.getState();
			}
		}

		const notifiedCells = new Set<string>();
		const notifyCellOnce = (rowId: string, colField: string) => {
			const key = `${rowId}:${colField}`;
			if (notifiedCells.has(key)) return;
			notifiedCells.add(key);
			this.notifyCellChange(rowId, colField);
		};

		// Notify coordinate cell subscriptions
		if (updatedSet.has('selection')) {
			if (prevState.selection.focus) notifyCellOnce(prevState.selection.focus.rowId, prevState.selection.focus.colField);
			if (currState.selection.focus) notifyCellOnce(currState.selection.focus.rowId, currState.selection.focus.colField);
		}

		if (updatedSet.has('activeEdit')) {
			if (prevState.activeEdit) notifyCellOnce(prevState.activeEdit.rowId, prevState.activeEdit.colField);
			if (currState.activeEdit) notifyCellOnce(currState.activeEdit.rowId, currState.activeEdit.colField);
		}

		if (updatedSet.has('selection')) {
			const rowModel = this.rowModel;
			if (rowModel) {
				const viewport = this.getSelectionNotificationViewport();
				this.selection.forEachDirtyCoordinateInViewport(
					prevState.selection.bounds,
					currState.selection.bounds,
					viewport,
					(rowIdx, colIdx) => {
						const row = rowModel.getRow(rowIdx);
						const col = currState.columns[colIdx];
						if (row && col) {
							notifyCellOnce(this.data.getRowId(row), col.field);
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
					const colSubs = this.colSubscriptions.get(colField);
					if (colSubs) {
						colSubs.forEach((sub) => {
							try {
								sub.onStoreChange();
							} catch (e) {
								console.error(`GridEngine: Error in column subscription notification`, e);
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
						console.error(`GridEngine: Error in data refresh subscription notification`, e);
					}
				});
			});
		}

		// Propagate structured events
		if (updatedSet.has('selection') && prevState.selection.focus !== currState.selection.focus) {
			this.eventBus.dispatchEvent('focusChanged', { focus: currState.selection.focus, selection: currState.selection });
		}
		if (updatedSet.has('selection')) {
			this.eventBus.dispatchEvent('selectionChanged', { selection: currState.selection });
		}
		if (updatedSet.has('sortModel')) {
			this.eventBus.dispatchEvent('sortChanged', { sortModel: currState.sortModel });
		}
		if (updatedSet.has('filterModel')) {
			this.eventBus.dispatchEvent('filterChanged', { filterModel: currState.filterModel });
		}
	};

	private areRangeBoundsEqual(
		left: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null,
		right: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null
	): boolean {
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
		this.spreadsheetFill.fillRange(source, target);
	}

	public destroy(): void {
		this.cellSubscriptions.clear();
		this.colSubscriptions.clear();
		this.cellUpdateBatch.clear();
		this.eventBus.clear();
		this.stateManager.destroy();
	}
}
