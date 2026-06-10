import {
	canEditCell,
	isDataCellSelectable,
	type GridState,
	type RowModel,
	type CellSubscription,
	type ColumnDef,
	type GridCellRange,
	type GridCellPointer,
	type GridSelectionSource,
} from '../store.js';
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
import { DagEngine, type FormulaCellCoordinate } from '../calculations/dagEngine.js';
import { SpreadsheetFillEngine } from '../spreadsheet/fillRange.js';
import type { GridEngineConfig } from './GridEngineConfig.js';
import type { SortModel, FilterModel } from '../rowModel.js';
import { InvalidationManager } from '../renderer/invalidationManager.js';
import type { RenderStats } from '../renderer/renderOrchestrator.js';

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
	public readonly invalidation: InvalidationManager;
	private readonly formulas: DagEngine;
	private readonly spreadsheetFill: SpreadsheetFillEngine<TRowData>;

	private rowModel: RowModel<TRowData> | null = null;

	// Monotonic change tracking versions
	public geometryVersion = 0;
	public rowModelVersion = 0;
	public columnVersion = 0;

	// Scrolling states
	public isScrolling = false;
	public isScrollFrameActive = false;

	// Performance counters
	public getCellValueCallsDuringScroll = 0;
	public valueGetterCallsDuringScroll = 0;
	public formulaCallsDuringScroll = 0;
	public customRendererMountsDuringScroll = 0;
	public customRendererHydrationChunks = 0;
	public customRendererWarmHits = 0;
	public customRendererWarmMisses = 0;

	// Cell subscriptions are keyed by visible row id and column field.
	public readonly cellSubscriptions = new Map<string, Set<CellSubscription>>();
	public readonly colSubscriptions = new Map<string, Set<CellSubscription>>();
	public readonly cellUpdateBatch = new Map<string, Set<string>>();
	public batchFlushScheduled = false;
	private _batchedUpdates = true;
	private renderTransactionDepth = 0;
	private pendingRenderReason: string | null = null;

	// RenderEngine callbacks to bridge rendering stats
	public getRenderStats?: () => RenderStats;
	public resetRenderStats?: () => void;

	constructor(config: GridEngineConfig<TRowData>) {
		this.commandHistory = new CommandHistory();
		this.eventBus = new EventBus();
		this.invalidation = new InvalidationManager();
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
			selectedRowIds: config.selectedRowIds ?? [],
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
			loading: config.loading,
			loadingSkeletonCount: config.loadingSkeletonCount,
			styleSlots: config.styleSlots,

			// Tree / Grouping / Master-Detail State
			groupBy: config.groupBy,
			getParentId: config.getParentId,
			masterDetailEnabled: config.masterDetailEnabled,
			groupRowHeight: config.groupRowHeight,
			detailRowHeight: config.detailRowHeight,
			detailRenderer: config.detailRenderer,
			rowModelConfig: config.rowModelConfig,
			showGroupFooter: config.showGroupFooter,
			enableStickyGroupRows: config.enableStickyGroupRows,
			expansion: config.expansion ?? { groups: {}, treeRows: {}, details: {} },
			rowOverscanPx: config.rowOverscanPx ?? 400,
			colBuffer: config.colBuffer ?? 1,
			runtimeLimits: config.runtimeLimits,
			overscanAdaptive: config.overscanAdaptive,
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
		this.invalidation.invalidateFull('set data');
		this.requestRender('set data');
		this.commandHistory.clear();
	}

	public getRowOverscanPx(): number {
		return this.stateManager.getState().rowOverscanPx ?? 400;
	}

	public setRowOverscanPx(px: number): void {
		this.stateManager.setState({ rowOverscanPx: px });
	}

	public getColBuffer(): number {
		return this.stateManager.getState().colBuffer ?? 1;
	}

	public setColBuffer(colBuffer: number): void {
		this.stateManager.setState({ colBuffer });
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
		const displayedColumns = this.columns.getDisplayedColumns();
		const fromIndex = displayedColumns.findIndex((column) => column.field === colField);
		if (fromIndex === -1 || !Number.isFinite(toIndex)) return;

		const boundedToIndex = Math.max(0, Math.min(displayedColumns.length - 1, Math.trunc(toIndex)));
		if (fromIndex === boundedToIndex) return;

		const nextDisplayed = this.moveColumnInList(displayedColumns, fromIndex, boundedToIndex);
		const hiddenColumns = state.columns.filter((column) => column.hide === true);
		this.applyColumnOrder([...nextDisplayed, ...hiddenColumns]);
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
		this.invalidation.invalidateHeaders('column reorder toggle');
		this.eventBus.dispatchEvent('columnReorderToggled', { enabled });
		this.requestRender('column reorder toggle');
	}

	public setStyleSlots(styleSlots: GridState<TRowData>['styleSlots']): void {
		this.stateManager.setState({ styleSlots });
		this.invalidation.invalidateViewport('style slots');
		this.invalidation.invalidateHeaders('style slots');
		this.invalidation.invalidateOverlay('style slots');
		this.requestRender('style slots');
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
		this.invalidation.invalidateHeaders('sort');
		this.invalidation.invalidateFull('sort');
		this.requestRender('sort');

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
		this.invalidation.invalidateFull('filter');
		this.requestRender('filter');

		if (undoable) {
			this.commandHistory.add({
				undo: () => this.stateManager.setState({ filterModel: oldFilter }),
				redo: () => this.stateManager.setState({ filterModel }),
			});
		}
	}

	public setGroupBy(colIds: string[]): void {
		const state = this.stateManager.getState();
		// Clear stale group expansion state when grouping columns change
		const newExpansion = { ...state.expansion, groups: {} as Record<string, true> };
		this.stateManager.setState({ groupBy: colIds, expansion: newExpansion });
		this.invalidation.invalidateFull('groupBy');
		this.requestRender('groupBy');
	}

	public setAggDefs(defs: import('../rows/stages/aggregateStage.js').AggregationDef<any>[]): void {
		this.stateManager.setState({ aggDefs: defs });
		this.invalidation.invalidateFull('aggDefs');
		this.requestRender('aggDefs');
	}

	public setShowGroupFooter(enabled: boolean): void {
		this.stateManager.setState({ showGroupFooter: enabled });
		this.invalidation.invalidateFull('showGroupFooter');
		this.requestRender('showGroupFooter');
	}

	public setStickyGroupRows(enabled: boolean): void {
		this.stateManager.setState({ enableStickyGroupRows: enabled });
		this.invalidation.invalidateFull('enableStickyGroupRows');
		this.requestRender('enableStickyGroupRows');
	}

	public setCellValue(rowId: string, colField: string, value: unknown, undoable = true): void {
		const oldValue = this.data.getRawCellValue(rowId, colField);
		if (oldValue === value) return;

		const col = this.columns.getColumnDef(colField);
		const knownOldStoredValue = col?.valueGetter ? undefined : oldValue;
		const applied = this.data.setCellValue(rowId, colField, value, knownOldStoredValue);
		if (!applied) return;

		if (undoable) {
			this.commandHistory.add({
				undo: () => this.setCellValue(rowId, colField, oldValue, false),
				redo: () => this.setCellValue(rowId, colField, value, false),
			});
		}
	}

	public startEdit(rowId: string, colField: string): void {
		if (!this.canEditCell(rowId, colField)) return;
		this.stateManager.setState({
			activeEdit: { rowId, colField },
		});
		this.invalidation.invalidateCell(rowId, colField, 'edit started');
		this.invalidation.invalidateOverlay('edit started');
		this.notifyCellChange(rowId, colField);
		this.eventBus.dispatchEvent('editStarted', { rowId, colField });
		this.requestRender('edit started');
	}

	public stopEdit(cancel = false): void {
		const activeEdit = this.stateManager.getState().activeEdit;
		if (!activeEdit) return;

		const { rowId, colField } = activeEdit;
		this.stateManager.setState({ activeEdit: null });
		this.invalidation.invalidateCell(rowId, colField, 'edit stopped');
		this.invalidation.invalidateOverlay('edit stopped');
		this.notifyCellChange(rowId, colField);
		this.eventBus.dispatchEvent('editStopped', { rowId, colField, cancel });
		this.requestRender('edit stopped');
	}

	public registerRowModel(rowModel: RowModel<TRowData>): void {
		this.rowModel = rowModel;
		this.rowModelVersion++;
		this.geometryVersion++;
		// Refresh coordinates
		const state = this.stateManager.getState();
		this.geometry.updateRows(this.getRowHeightsList(rowModel, state.rowHeights, state.defaultRowHeight), state.defaultRowHeight);
		this.stateManager.setState({ dataVersion: state.dataVersion + 1 });
		this.invalidation.invalidateGeometry('row model registered');
		this.invalidation.invalidateFull('row model registered');
		this.requestRender('row model registered');
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

	public invalidateFormulaCell(rowId: string, colField: string): FormulaCellCoordinate[] {
		return this.formulas.invalidateCell(rowId, colField);
	}

	public getCachedFormulaValue(rowId: string, colField: string): { hasCached: boolean; value: unknown } {
		return this.formulas.getCachedFormulaValue(rowId, colField);
	}

	private getRowHeightsList(rowModel: RowModel<TRowData>, rowHeightsRecord: Record<string, number>, defaultRowHeight: number): number[] {
		let count = rowModel.getVisualRowCount();
		const state = this.stateManager.getState();
		if (state.loading && count === 0) {
			count = state.loadingSkeletonCount ?? 15;
		}
		const heights: number[] = [];
		for (let i = 0; i < count; i++) {
			const row = rowModel.getVisualRow(i);
			if (row) {
				const explicitHeight = row.height ?? rowHeightsRecord[row.id];
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
		this.beginRenderTransaction();
		this.stateManager.startTransaction();
		try {
			callback();
		} finally {
			this.stateManager.endTransaction();
			this.flushCellUpdatesSync();
			this.endRenderTransaction();
		}
	};

	public flushCellUpdates(): void {
		if (this.cellUpdateBatch.size === 0) {
			this.batchFlushScheduled = false;
			return;
		}
		const batch = new Map(this.cellUpdateBatch);
		this.cellUpdateBatch.clear();
		this.batchFlushScheduled = false;
		this.notifyBulkCellChange(batch);
	}

	public enqueueCellUpdate(rowId: string, colField: string): void {
		let fields = this.cellUpdateBatch.get(rowId);
		if (!fields) {
			fields = new Set<string>();
			this.cellUpdateBatch.set(rowId, fields);
		}
		fields.add(colField);
	}

	public flushCellUpdatesSync(): void {
		if (this.cellUpdateBatch.size > 0) {
			this.flushCellUpdates();
		}
	}

	public notifyBulkCellChange(changes: Map<string, Set<string>>): void {
		// Clear caches and notify subscriptions for each changed cell
		for (const [rowId, fields] of changes) {
			for (const colField of fields) {
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
			}
		}
		// Accumulate all invalidations, then fire ONE render event instead of N cellInvalidated events
		const hasRenderConsumer = this.eventBus.hasListeners('cellInvalidated') || this.eventBus.hasListeners('renderInvalidated');
		if (hasRenderConsumer) {
			for (const [rowId, fields] of changes) {
				for (const colField of fields) {
					this.invalidation.invalidateCell(rowId, colField, 'cell');
				}
				this.invalidation.invalidateRow(rowId, 'cell');
			}
			this.requestRender('bulk-cell-change');
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
		const hasRenderConsumer = this.eventBus.hasListeners('cellInvalidated') || this.eventBus.hasListeners('renderInvalidated');
		if (hasRenderConsumer) {
			this.invalidation.invalidateCell(rowId, colField, 'cell');
			this.invalidation.invalidateRow(rowId, 'cell');
			this.eventBus.dispatchEvent('cellInvalidated', { rowId, colField });
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

	// ── Row node selection ─────────────────────────────────────────────────────

	private applyRowSelection(op: 'select' | 'deselect' | 'toggle' | 'selectAll' | 'clear', rowIds?: string[]): void {
		const current = this.stateManager.getState();
		const currentSet = new Set(current.selectedRowIds);
		let newIds: string[];

		switch (op) {
			case 'select': {
				const toAdd = rowIds ?? [];
				toAdd.forEach((id) => currentSet.add(id));
				newIds = [...currentSet];
				break;
			}
			case 'deselect': {
				const toRemove = new Set(rowIds ?? []);
				newIds = current.selectedRowIds.filter((id) => !toRemove.has(id));
				break;
			}
			case 'toggle': {
				const id = rowIds?.[0];
				if (!id) return;
				if (currentSet.has(id)) currentSet.delete(id);
				else currentSet.add(id);
				newIds = [...currentSet];
				break;
			}
			case 'selectAll': {
				const allIds: string[] = [];
				if (this.rowModel) {
					const count = this.rowModel.getVisualRowCount();
					for (let i = 0; i < count; i++) {
						const vr = this.rowModel.getVisualRow(i);
						if (vr?.kind === 'data') allIds.push(vr.rowId);
					}
				}
				newIds = allIds;
				break;
			}
			case 'clear': {
				newIds = [];
				break;
			}
			default:
				return;
		}

		const prevSet = new Set(current.selectedRowIds);
		const newSet = new Set(newIds);
		const changed = newIds.filter((id) => !prevSet.has(id)).concat(current.selectedRowIds.filter((id) => !newSet.has(id)));

		this.stateManager.setState({ selectedRowIds: newIds });
		this.eventBus.dispatchEvent('rowSelectionChanged', {
			selectedRowIds: newIds,
			changedRowIds: changed,
		});
	}

	public selectRowIds(rowIds: string[]): void {
		this.applyRowSelection('select', rowIds);
	}

	public deselectRowIds(rowIds: string[]): void {
		this.applyRowSelection('deselect', rowIds);
	}

	public toggleRowId(rowId: string): void {
		this.applyRowSelection('toggle', [rowId]);
	}

	public selectAllDataRows(): void {
		this.applyRowSelection('selectAll');
	}

	public clearRowSelection(): void {
		this.applyRowSelection('clear');
	}

	private applySelectionRange = (start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'program'): void => {
		const validStart = this.isDataCellSelectable(start) ? start : null;
		const validEnd = this.isDataCellSelectable(end) ? end : null;
		if ((start || end) && (!validStart || !validEnd)) {
			start = validStart;
			end = validEnd;
		}
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

	private canEditCell(rowId: string, colField: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return canEditCell(visualRow, this.columns.getColumnDef(colField));
	}

	private isDataCellSelectable(pointer: GridCellPointer | null): pointer is GridCellPointer {
		if (!pointer) return false;
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(pointer.rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return isDataCellSelectable(visualRow, this.columns.getColumnDef(pointer.colField));
	}

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
		this.invalidation.invalidateFull('columns');
		this.requestRender('columns');

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
		this.invalidation.invalidateGeometry('column resize');
		this.invalidation.invalidateColumn(colField, 'column resize');
		this.invalidation.invalidateHeaders('column resize');

		this.eventBus.dispatchEvent('columnResized', {
			colField,
			width,
		});
		this.requestRender('column resize');
	};

	private applyColumnOrder(columns: ColumnDef<TRowData>[]): void {
		const prevFields = this.stateManager.getState().columns.map((column) => column.field);
		const nextFields = columns.map((column) => column.field);
		if (prevFields.length === nextFields.length && prevFields.every((field, index) => field === nextFields[index])) {
			return;
		}

		this.stateManager.setState({ columns });
		this.invalidation.invalidateFull('column order');
		this.eventBus.dispatchEvent('columnOrderChanged', {
			columns,
			columnFields: nextFields,
		});
		this.requestRender('column order');
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
		this.invalidation.invalidateGeometry('row resize');
		this.invalidation.invalidateRow(rowId, 'row resize');

		this.eventBus.dispatchEvent('rowResized', {
			rowId,
			height,
		});
		this.requestRender('row resize');
	};

	// State-to-coordinate change mapping bridge callback
	private handleStateChanges = (prevState: GridState<TRowData>, updatedKeys: string[]): void => {
		let currState = this.stateManager.getState();
		const updatedSet = new Set(updatedKeys);

		// Synchronize sub-models
		if (updatedSet.has('columns') || updatedSet.has('columnWidths') || updatedSet.has('defaultColWidth')) {
			this.columns.updateColumns(currState.columns, currState.columnWidths, currState.defaultColWidth);
			this.columnVersion++;
			this.geometryVersion++;
		}

		if (updatedSet.has('dataVersion')) {
			this.data.clearValueGetterCache();
		}

		if (updatedSet.has('dataVersion') || updatedSet.has('sortModel') || updatedSet.has('filterModel')) {
			this.rowModelVersion++;
		}

		const rowCountChanged = this.rowModel ? this.rowModel.getVisualRowCount() !== this.geometry.getRowCount() : false;
		if (
			this.rowModel &&
			(updatedSet.has('rowHeights') ||
				updatedSet.has('defaultRowHeight') ||
				updatedSet.has('loading') ||
				updatedSet.has('dataVersion') ||
				rowCountChanged)
		) {
			this.geometry.updateRows(
				this.getRowHeightsList(this.rowModel, currState.rowHeights, currState.defaultRowHeight),
				currState.defaultRowHeight
			);
			this.geometryVersion++;
		}

		if (updatedSet.has('selection') || updatedSet.has('columns')) {
			const rangeBounds = this.selection.calculateRangeBounds(
				currState.selection.range,
				(id) => (this.rowModel ? this.rowModel.getVisualIndexByRowId(id) : -1),
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
			this.invalidation.invalidateOverlay('selection');
		}

		const needsRangeUpdate =
			updatedSet.has('columns') ||
			updatedSet.has('columnWidths') ||
			updatedSet.has('rowHeights') ||
			updatedSet.has('dataVersion') ||
			updatedSet.has('defaultRowHeight') ||
			updatedSet.has('defaultColWidth') ||
			updatedSet.has('loading') ||
			updatedSet.has('rowOverscanPx');

		if (needsRangeUpdate) {
			const nextRowRange = this.viewport.getVisibleRowRange(this.rowModel ? this.rowModel.getVisualRowCount() : 0);
			const nextColRange = this.viewport.getVisibleColumnRange(this.columns.getDisplayedColumnCount());

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
			if (prevState.selection.focus)
				this.invalidation.invalidateCell(prevState.selection.focus.rowId, prevState.selection.focus.colField, 'focus');
			if (currState.selection.focus)
				this.invalidation.invalidateCell(currState.selection.focus.rowId, currState.selection.focus.colField, 'focus');
		}

		if (updatedSet.has('activeEdit')) {
			if (prevState.activeEdit) notifyCellOnce(prevState.activeEdit.rowId, prevState.activeEdit.colField);
			if (currState.activeEdit) notifyCellOnce(currState.activeEdit.rowId, currState.activeEdit.colField);
		}

		if (updatedSet.has('selection')) {
			const rowModel = this.rowModel;
			if (rowModel) {
				const viewport = this.getSelectionNotificationViewport();
				const displayedColumns = this.columns.getDisplayedColumns();
				this.selection.forEachDirtyCoordinateInViewport(
					prevState.selection.bounds,
					currState.selection.bounds,
					viewport,
					(rowIdx, colIdx) => {
						const visualRow = rowModel.getVisualRow(rowIdx);
						const col = displayedColumns[colIdx];
						if (visualRow?.kind === 'data' && col) {
							notifyCellOnce(visualRow.rowId, col.field);
							this.invalidation.invalidateCell(visualRow.rowId, col.field, 'selection');
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
			this.eventBus.dispatchEvent('selectionChanged', {
				selection: currState.selection,
				result: this.selection.describeChange(prevState.selection, currState.selection, this.rowModel, currState.columns),
			});
			this.requestRender('selection');
		}
		if (updatedSet.has('sortModel')) {
			this.eventBus.dispatchEvent('sortChanged', { sortModel: currState.sortModel });
		}
		if (updatedSet.has('filterModel')) {
			this.eventBus.dispatchEvent('filterChanged', { filterModel: currState.filterModel });
		}
		if (updatedSet.has('groupBy')) {
			this.eventBus.dispatchEvent('groupByChanged', { groupBy: currState.groupBy });
		}
		if (updatedSet.has('aggDefs')) {
			this.eventBus.dispatchEvent('aggDefsChanged', { aggDefs: currState.aggDefs });
		}
		if (updatedSet.has('showGroupFooter')) {
			this.eventBus.dispatchEvent('showGroupFooterChanged', { showGroupFooter: currState.showGroupFooter });
		}
		if (updatedSet.has('enableStickyGroupRows')) {
			this.eventBus.dispatchEvent('enableStickyGroupRowsChanged', { enableStickyGroupRows: currState.enableStickyGroupRows });
		}
	};

	private requestRender(reason: string): void {
		if (this.renderTransactionDepth > 0) {
			this.pendingRenderReason = this.pendingRenderReason ? `${this.pendingRenderReason}+${reason}` : reason;
			return;
		}
		this.eventBus.dispatchEvent('renderInvalidated', { reason });
	}

	private beginRenderTransaction(): void {
		this.renderTransactionDepth++;
	}

	private endRenderTransaction(): void {
		if (this.renderTransactionDepth === 0) return;
		this.renderTransactionDepth--;
		if (this.renderTransactionDepth > 0) return;
		const reason = this.pendingRenderReason;
		this.pendingRenderReason = null;
		if (reason) {
			this.eventBus.dispatchEvent('renderInvalidated', { reason });
		}
	}

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
		const rowCount = this.rowModel ? this.rowModel.getVisualRowCount() : 0;
		const colCount = this.columns.getDisplayedColumnCount();

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
