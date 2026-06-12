import type { FilterModel, SortModel } from '../rowModel.js';
import type { IGridDatasource } from '../serverRowModel.js';
import type { ColumnDef, GridStyleSlots, CellRendererPhase } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import type { RowNode } from '../rowNode.js';
import type { ViewportRange } from '../viewportController.js';
import type { RenderStats } from '../renderer/renderOrchestrator.js';
import type { AggregationDef } from '../rows/stages/aggregateStage.js';
import type { PersistenceStatus, PersistedGridState } from '../persistence/statePersistence.js';
import type { CsvExportOptions } from '../export/csvExport.js';
import type { GridEventPayloadMap, GridEventListener } from './GridEvents.js';
import type { RuntimeFault } from '../diagnostics/RuntimeFaultReporter.js';
import type { GridState, GridStateUpdater, Listener, ColumnState, GridCellRangeBounds } from '../state/GridState.js';

export type { CsvExportOptions };
export type { RuntimeFault };

// ── Cell / selection types ────────────────────────────────────────────────────

export interface CellSubscription {
	rowId: string;
	colField: string;
	onStoreChange: () => void;
}

export interface GridCellPointer {
	rowId: string;
	colField: string;
}

/** Extended pointer used for the active edit slot — carries optional validation state. */
export interface ActiveEditState extends GridCellPointer {
	/** Non-null when validation has failed; shown below the cell editor. */
	validationError?: string | null;
}

export interface CellPointer {
	rowId: string;
	colId: string;
}

export interface VisualRowPointer {
	visualRowId: string;
}

export interface SelectionChangeResult {
	invalidatedCells: GridCellPointer[];
	invalidatedRows: string[];
	overlayChanged: boolean;
}

export type RowSelectionGestureSource = 'api' | 'checkbox' | 'headerCheckbox' | 'pointer' | 'keyboard';
export type RowSelectionGestureKind = 'replace' | 'select' | 'deselect' | 'toggle' | 'selectAll' | 'clear';

export interface RowSelectionGesture {
	kind: RowSelectionGestureKind;
	rowIds?: string[];
	source?: RowSelectionGestureSource;
}

export interface RowSelectionChangeResult {
	selectedRowIds: string[];
	changedRowIds: string[];
	addedRowIds: string[];
	removedRowIds: string[];
	source: RowSelectionGestureSource;
}

export interface GridCellCoordinates {
	rowIndex: number;
	colIndex: number;
}

export type GridSelectionSource = 'api' | 'keyboard' | 'pointer' | 'fill' | 'program';

export interface GridCellRange {
	start: GridCellPointer;
	end: GridCellPointer;
}

export interface GridSelectionState {
	focus: GridCellPointer | null;
	anchor: GridCellPointer | null;
	range: GridCellRange | null;
	bounds: GridCellRangeBounds | null;
	source: GridSelectionSource;
}

export interface GridPlugin<TRowData = unknown> {
	readonly name: string;
	onInit?(api: GridPluginRuntime<TRowData>): void;
	onMount?(): void;
	onDestroy?(): void;
	onViewportChange?(range: ViewportRange): void;
}

export interface GridCellClickParams<TRowData = unknown> {
	rowId: string;
	rowIndex: number;
	row: TRowData | null;
	node: RowNode<TRowData> | null;
	colField: string;
	colIndex: number;
	column: ColumnDef<TRowData>;
	value: unknown;
	api: GridApi<TRowData>;
	event: MouseEvent;
}

export interface GridCellAccess<TRowData = unknown> {
	rowId: string;
	rowIndex: number;
	row: TRowData | null;
	node: RowNode<TRowData> | null;
	colField: string;
	colIndex: number;
	column: ColumnDef<TRowData>;
	value: unknown;
	rawValue: unknown;
	isFocused: boolean;
	isRowFocused: boolean;
	isSelected: boolean;
	isRowSelected: boolean;
	isEditing: boolean;
	isLoading: boolean;
	event?: Event;
}

export interface CellState {
	value: unknown;
	computedValue?: unknown;
	isEditing?: boolean;
}

export interface GridRowsAccessor<TRowData = unknown> {
	/** Iterate over all active data rows */
	forEach(callback: (row: TRowData, index: number) => void): void;
	/** Get all active data rows as an array */
	getAll(): TRowData[];
	/** Get currently selected data rows */
	getSelected(): TRowData[];
	/** Get currently selected row IDs */
	getSelectedIds(): string[];
	/** Get a data row by its ID */
	getById(id: string): TRowData | null;
	/** Get a row node by its ID */
	getNodeById(id: string): RowNode<TRowData> | null;
	/** Get the total number of data rows */
	getCount(): number;
	/** Get the visual representation of a row by its ID */
	getVisualRowById(id: string): VisualRow<TRowData> | null;
	/** Get helpers for rows within a specific cell/selection range */
	inRange(range: GridCellRange): {
		forEach(callback: (rowId: string, index: number) => void): void;
		getIds(): string[];
		getData(): TRowData[];
	};
	/** Get data rows that have been row-selected (checkbox/Ctrl+Click) */
	getChecked(): TRowData[];
	/** Get IDs of row-selected rows */
	getCheckedIds(): string[];
}

export interface RowDataTransaction<TData = unknown> {
	/** Rows to add. Optional `addIndex` controls insertion position (default: end). */
	add?: TData[];
	/** Index at which to insert added rows. Defaults to appending at the end. */
	addIndex?: number;
	/** Rows to remove, matched by row ID. */
	remove?: TData[];
	/** Rows to update, matched by row ID. Only changed fields are notified. */
	update?: TData[];
}

export interface RowNodeTransaction<TData = unknown> {
	add: RowNode<TData>[];
	remove: RowNode<TData>[];
	update: RowNode<TData>[];
}

export interface GridTransaction<TRowData = unknown> {
	columns?: ColumnDef<TRowData>[];
	rows?: TRowData[];
	rowTransaction?: RowDataTransaction<TRowData>;
	sortModel?: SortModel | null;
	filterModel?: FilterModel | null;
	pins?: { left?: number; right?: number; top?: number; bottom?: number };
	styleSlots?: GridStyleSlots<TRowData>;
}

// Re-export state types so importers of GridApi.ts also get them
export type { GridState, GridStateUpdater, Listener, ColumnState, GridCellRangeBounds };

// ── Cell renderer / editor props ─────────────────────────────────────────────

/**
 * Props passed to every custom cell renderer component.
 *
 * @typeParam TRowData - Shape of the row data object.
 * @typeParam TValue   - Type of the cell value (defaults to `unknown`; narrow it
 *                       to get typed `value` inside your renderer, e.g.
 *                       `CellRendererProps<MyRow, string>`).
 */
export interface CellRendererProps<TRowData = unknown, TValue = unknown> {
	value: TValue;
	computedValue: TValue;
	row: TRowData;
	rowId: string;
	colField: string;
	colId?: string;
	isScrolling?: boolean;
	phase?: CellRendererPhase;
	isFocused?: boolean;
	isEditing?: boolean;
	isSelected?: boolean;
	api: GridApi<TRowData>;
}

/**
 * Props passed to every custom cell editor component.
 *
 * @typeParam TRowData - Shape of the row data object.
 * @typeParam TValue   - Type of the cell value (defaults to `unknown`; narrow it
 *                       to avoid casting inside your editor, e.g.
 *                       `CellEditorProps<MyRow, string>`).
 *
 * @example Typed string editor
 * ```tsx
 * const MyEditor = ({ value, onCommit, onCancel }: CellEditorProps<MyRow, string>) => (
 *   <input
 *     autoFocus
 *     defaultValue={value}
 *     onBlur={(e) => onCommit(e.target.value)}
 *     onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
 *   />
 * );
 * ```
 */
export interface CellEditorProps<TRowData = unknown, TValue = unknown> {
	rowId: string;
	colField: string;
	value: TValue;
	/**
	 * Update the local editing value without committing.
	 * Use this for text inputs where the user is still typing.
	 */
	onChange: (value: TValue) => void;
	api: GridApi<TRowData>;
	/**
	 * Commit the value and exit edit mode.
	 * If no value is passed, commits the last value set via `onChange`.
	 */
	onCommit: (finalValue?: TValue) => void;
	/**
	 * Cancel editing and revert to the original value.
	 */
	onCancel: () => void;
}

export interface HeaderMenuRendererProps<TRowData = unknown> {
	colField: string;
	column: ColumnDef<TRowData>;
	api: GridApi<TRowData>;
	close: () => void;
	container: HTMLDivElement;
}

/**
 * Public, pristine API intended for application developers.
 */
export interface GridApi<TRowData = unknown> {
	getState(): GridState<TRowData>;
	getRowId(row: TRowData): string;
	isRowLoading(rowId: string): boolean;
	getDataRowAtVisualIndex(index: number): TRowData | null;
	getDataRowNodeAtVisualIndex(index: number): RowNode<TRowData> | null;
	setRows(rows: TRowData[]): void;
	updateRows(updater: (rows: TRowData[]) => TRowData[]): void;
	applyTransaction(transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData> | null;
	refreshRows(): void;
	setRowHeights: (rowHeights: Record<string, number> | undefined) => void;
	setDefaultRowHeight: (defaultRowHeight?: number | undefined) => void;
	purgeCache(): void;
	setServerDatasource(datasource: IGridDatasource, blockSize?: number): void;
	getCellValue(rowId: string, colField: string): unknown;
	setCellValue(rowId: string, colField: string, value: unknown): void;
	selectCell(pointer: GridCellPointer | null, source?: GridSelectionSource): void;
	selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource): void;
	extendSelection(end: GridCellPointer, source?: GridSelectionSource): void;
	// Row node multi-select
	applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null;
	selectRows(rowIds: string[]): void;
	deselectRows(rowIds: string[]): void;
	toggleRowSelection(rowId: string): void;
	selectAllRows(): void;
	clearRowSelection(): void;
	isRowNodeSelected(rowId: string): boolean;
	getSelectedRowCount(): number;
	setColumns(columns: ColumnDef<TRowData>[]): void;
	setColumnWidth(colField: string, width: number): void;
	setColumnVisible(colField: string, visible: boolean): void;
	setColumnsVisible(colFields: string[], visible: boolean): void;
	getColumns(): ColumnDef<TRowData>[];
	getDisplayedColumns(): ColumnDef<TRowData>[];
	setPinnedColumns(pins: { left?: number; right?: number }): void;
	getPinnedColumns(): { left: number; right: number };
	moveColumn(colField: string, toIndex: number): void;
	setColumnOrder(colFields: string[]): void;
	setColumnReorderEnabled(enabled: boolean): void;
	setRowHeight(rowId: string, height: number): void;
	setSortModel(sortModel: SortModel | null): void;
	setFilterModel(filterModel: FilterModel | null): void;
	setStyleSlots(styleSlots: GridStyleSlots<TRowData> | undefined): void;
	setGroupBy(colIds: string[]): void;
	getGroupBy(): string[];
	addGroupBy(colId: string, atIndex?: number): void;
	removeGroupBy(colId: string): void;
	moveGroupBy(colId: string, toIndex: number): void;
	setAggDefs(defs: AggregationDef<TRowData>[]): void;
	getAggDefs(): AggregationDef<TRowData>[];
	expandAllGroups(): void;
	collapseAllGroups(): void;
	setShowGroupFooter(enabled: boolean): void;
	setStickyGroupRows(enabled: boolean): void;
	setShowGroupPanel(enabled: boolean): void;
	toggleGroupExpanded(groupId: string): void;
	toggleDetailExpanded(rowId: string): void;
	isGroupExpanded(groupId: string): boolean;
	isDetailExpanded(rowId: string): boolean;
	getRowNodeById(rowId: string): RowNode<TRowData> | null;
	getRawRowById(rowId: string): TRowData | null;
	rows(): GridRowsAccessor<TRowData>;
	addEventListener<K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	): () => void;
	dispatchEvent<K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void;
	startEditing(rowId: string, colField: string): void;
	stopEditing(cancel?: boolean): void;
	/**
	 * Async commit of an in-progress edit.
	 * Runs `valueValidator` first (if defined). If validation passes, optimistically applies the
	 * value, then runs `valueSetter` (if defined). If the setter rejects, rolls back and surfaces
	 * a validation error on `activeEdit.validationError`.
	 * Returns true when the commit succeeded and `stopEditing` was called.
	 */
	commitEdit(rowId: string, colField: string, value: unknown): Promise<boolean>;
	/** Returns a per-column snapshot of the current user-configurable state (width, visibility) in display order. */
	getColumnState(): ColumnState[];
	/** Apply a partial column state array. Only fields present in `states` are updated; others are unchanged. */
	applyColumnState(states: ColumnState[]): void;
	/** Returns a full serializable snapshot of the current grid state (columns, sort, filter, grouping, pinning). */
	getGridState(): PersistedGridState;
	/** Apply a serializable grid state snapshot, updating all covered fields. Unknown fields are ignored. */
	applyGridState(state: PersistedGridState): void;
	subscribe(listener: Listener<TRowData>): () => void;
	subscribeToKey(key: string, listener: Listener<TRowData>): () => void;
	getColumnIndex(colField: string): number;
	getColumnField(colIndex: number): string | null;
	getColumnDef(colField: string): ColumnDef<TRowData> | undefined;
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	// Sidebar panel API
	openPanel(panelId: string): void;
	closePanel(): void;
	togglePanel(panelId: string): void;
	getOpenPanel(): string | null;
	// Chart overlay API
	openChart(): void;
	closeChart(): void;
	toggleChart(): void;
	isChartOpen(): boolean;
	exportCsv(options?: CsvExportOptions): void;
	/** Returns true when a persistence adapter is configured for this grid instance. */
	hasPersistence(): boolean;
	/** Clear all persisted state saved by the configured persistence adapter. No-op when no adapter is set. */
	clearPersistedState(): void | Promise<void>;
	/** Enable or disable auto-save. When disabled, state changes are not persisted until re-enabled. */
	setAutoSave(enabled: boolean): void;
	/** Returns whether auto-save is currently enabled. */
	isAutoSaveEnabled(): boolean;
	/** Returns the current persistence save status. */
	getPersistenceStatus(): PersistenceStatus;
	/** Subscribe to persistence status changes. Fires immediately when saving starts/ends or errors. */
	subscribeToPersistenceStatus(listener: (status: PersistenceStatus) => void): () => void;
	/** Immediately save current state, bypassing the debounce timer. No-op when no adapter is set. */
	saveNow(): void;
	/** Returns a bounded snapshot of recent runtime faults captured by the grid core. */
	getRuntimeFaults(): RuntimeFault[];
	/** Clears the captured runtime fault history. */
	clearRuntimeFaults(): void;
	destroy(): void;
}

export interface GridPluginRuntime<TRowData = unknown> extends GridApi<TRowData> {
	getCellState(rowId: string, colField: string): CellState;
	getCheapDisplayValue(rowId: string, colField: string): string;
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualIndexByRowId(rowId: string): number | null;
	getColumnIndex(colField: string): number;
	getColumnField(colIndex: number): string | null;
	getRowModel(): import('../store.js').RowModel<TRowData> | null;
}

export interface GridPluginController<TRowData = unknown> {
	registerPlugin(plugin: GridPlugin<TRowData>): void;
	getPlugin<T = unknown>(name: string): T | null;
	unregisterPlugin(name: string): void;
}

export interface GridRendererApi<TRowData = unknown> extends GridApi<TRowData> {
	getCachedDisplayValue(rowId: string, colField: string): string | undefined;
	getCheapDisplayValue(rowId: string, colField: string): string;
	getComputedCellValue(rowId: string, colField: string): unknown;
	getCellState(rowId: string, colField: string): CellState;
	getCellAccess(rowId: string, colField: string): GridCellAccess<TRowData> | null;
	getRowOverscanPx(): number;
	setRowOverscanPx(px: number): void;
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualRowIndexById(id: string): number | null;
	getVisualIndexById(visualRowId: string): number | null;
	getVisualIndexByRowId(rowId: string): number | null;
	subscribeToViewport(listener: Listener<TRowData>): () => void;
	subscribeToSelection(listener: Listener<TRowData>): () => void;
	subscribeToFocusedCell(listener: Listener<TRowData>): () => void;
	subscribeToEditingCell(listener: Listener<TRowData>): () => void;
	subscribeToCell(rowId: string, colField: string, listener: () => void): () => void;
	subscribeToRow(rowId: string, listener: Listener<TRowData>): () => void;
	subscribeToColumn(colField: string, listener: Listener<TRowData>): () => void;
	subscribeToHeaders(listener: Listener<TRowData>): () => void;
}

export interface GridHostRuntime<TRowData = unknown> {
	getRenderStats(): RenderStats;
	resetRenderStats(): void;
	setViewportPins(pins: { left?: number; right?: number; top?: number; bottom?: number }): void;
	setViewportSize(width: number, height: number): boolean;
	updateVisibleRanges(): boolean;
}

export interface GridStoreRuntime<TRowData = unknown> {
	setState(updater: GridStateUpdater<TRowData>): void;
	registerRowModel(rowModel: import('../store.js').RowModel<TRowData>): void;
	getRowModel(): import('../store.js').RowModel<TRowData> | null;
	triggerCellNotifications(rowId: string): void;
	/**
	 * @deprecated Auto-batching is on by default. Use `flushCellUpdatesSync()` if a synchronous
	 * flush is required, or restructure to use `applyTransaction` for row-level bulk changes.
	 */
	batch(callback: () => void): void;
	batchedUpdates: boolean;
	registerCellSubscription(sub: CellSubscription): void;
	unregisterCellSubscription(sub: CellSubscription): void;
	updateCellSubscription(sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void;
	flushCellUpdatesSync(): void;
}

/**
 * Internal API intended for the rendering engine and custom framework adapters.
 * Plugin code should use GridPluginRuntime instead of sharing this broader surface.
 *
 * Access this from internal composition roots such as store-owned renderer/host wiring.
 */
export interface InternalGridApi<TRowData = unknown> extends GridRendererApi<TRowData>, GridHostRuntime<TRowData>, GridStoreRuntime<TRowData> {
	// ── Renderer-level display value access ──────────────────────────────────
	getCachedDisplayValue(rowId: string, colField: string): string | undefined;
	getCheapDisplayValue(rowId: string, colField: string): string;
	getComputedCellValue(rowId: string, colField: string): unknown;
	getCellState(rowId: string, colField: string): CellState;
	getCellAccess(rowId: string, colField: string): GridCellAccess<TRowData> | null;

	// ── Render config (viewport / overscan) ──────────────────────────────────
	getRowOverscanPx(): number;
	setRowOverscanPx(px: number): void;

	// ── Render diagnostics ───────────────────────────────────────────────────
	getRenderStats(): RenderStats;
	resetRenderStats(): void;

	// ── Visual row model access (used by renderer, not application code) ─────
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualRowIndexById(id: string): number | null;
	getVisualIndexById(visualRowId: string): number | null;
	getVisualIndexByRowId(rowId: string): number | null;

	// ── Fine-grained subscriptions (used by cell/row portals) ────────────────
	subscribeToViewport(listener: Listener<TRowData>): () => void;
	subscribeToSelection(listener: Listener<TRowData>): () => void;
	subscribeToFocusedCell(listener: Listener<TRowData>): () => void;
	subscribeToEditingCell(listener: Listener<TRowData>): () => void;
	subscribeToCell(rowId: string, colField: string, listener: () => void): () => void;
	subscribeToRow(rowId: string, listener: Listener<TRowData>): () => void;
	subscribeToColumn(colField: string, listener: Listener<TRowData>): () => void;
	subscribeToHeaders(listener: Listener<TRowData>): () => void;

	// ── Store / engine internals ─────────────────────────────────────────────
	setState(updater: GridStateUpdater<TRowData>): void;
	registerRowModel(rowModel: import('../store.js').RowModel<TRowData>): void;
	getRowModel(): import('../store.js').RowModel<TRowData> | null;
	setViewportPins(pins: { left?: number; right?: number; top?: number; bottom?: number }): void;
	setViewportSize(width: number, height: number): boolean;
	updateVisibleRanges(): boolean;
	triggerCellNotifications(rowId: string): void;
	/**
	 * @deprecated Auto-batching is on by default. Use `flushCellUpdatesSync()` if a synchronous
	 * flush is required, or restructure to use `applyTransaction` for row-level bulk changes.
	 */
	batch(callback: () => void): void;
	batchedUpdates: boolean;
	registerCellSubscription(sub: CellSubscription): void;
	unregisterCellSubscription(sub: CellSubscription): void;
	updateCellSubscription(sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void;
	flushCellUpdatesSync(): void;
}
