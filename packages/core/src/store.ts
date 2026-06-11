import type { FilterModel, SortModel } from './rowModel.js';
import type { IGridDatasource } from './serverRowModel.js';
import { ViewportController, type ViewportRange } from './viewportController.js';
import { GridEngine } from './engine/GridEngine.js';
import type { RenderStats } from './renderer/renderOrchestrator.js';
import type { AggregationDef } from './rows/stages/aggregateStage.js';
import { exportToCsv, type CsvExportOptions } from './export/csvExport.js';
import type { PersistenceStatus } from './persistence/statePersistence.js';

// ── Focused sub-modules — re-export so callers of store.ts continue to work ──
export { RowNode } from './rowNode.js';

export { isDomCellRenderer, getValueByPath, setValueByPath, compilePathGetter } from './columnDef.js';
export type {
	CellCopyParams,
	CellPasteParams,
	ValueGetterParams,
	CellRendererPhase,
	CellRendererCapabilities,
	ImperativeCellHandle,
	DomCellRendererParams,
	DomCellRendererHandle,
	DomCellRenderer,
	ColumnRendererSpec,
	ColumnRenderMode,
	ColumnRenderPlan,
	CompiledGridPlan,
	ColumnDef,
	InternalColumnDef,
	GridRowClassParams,
	GridCellClassParams,
	GridStyleSlots,
} from './columnDef.js';

export {
	isDataVisualRow,
	isFullWidthVisualRow,
	isSelectableVisualRow,
	isEditableVisualRow,
	canEditCell,
	canFocusVisualRow,
	isDataCellSelectable,
} from './visualRow.js';
export type { DataVisualRow, GroupVisualRow, DetailVisualRow, FooterVisualRow, LoadingVisualRow, VisualRow } from './visualRow.js';

export type { PersistenceStatus };

// ── Internal imports (for use by definitions in this file) ───────────────────
import { RowNode } from './rowNode.js';
import type { ColumnDef, GridStyleSlots, CellRendererPhase } from './columnDef.js';
import type { VisualRow } from './visualRow.js';

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

export interface GridSelectionState {
	focus: GridCellPointer | null;
	anchor: GridCellPointer | null;
	range: GridCellRange | null;
	bounds: GridCellRangeBounds | null;
	source: GridSelectionSource;
}

export interface GridPlugin<TRowData = unknown> {
	readonly name: string;
	onInit?(api: InternalGridApi<TRowData>): void;
	onMount?(): void;
	onDestroy?(): void;
	onViewportChange?(range: ViewportRange): void;
}

export interface GridCellRange {
	start: GridCellPointer;
	end: GridCellPointer;
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

export interface GridEvent<T = unknown> {
	type: string;
	payload: T;
}

export type GridEventListener<T = unknown> = (event: GridEvent<T>) => void;

export enum GridEventName {
	aggDefsChanged = 'aggDefsChanged',
	cellClicked = 'cellClicked',
	cellInvalidated = 'cellInvalidated',
	cellsCopied = 'cellsCopied',
	cellValueChanged = 'cellValueChanged',
	columnOrderChanged = 'columnOrderChanged',
	columnReorderToggled = 'columnReorderToggled',
	columnResized = 'columnResized',
	columnsChanged = 'columnsChanged',
	editStarted = 'editStarted',
	editStopped = 'editStopped',
	enableStickyGroupRowsChanged = 'enableStickyGroupRowsChanged',
	filterChanged = 'filterChanged',
	focusChanged = 'focusChanged',
	groupByChanged = 'groupByChanged',
	renderInvalidated = 'renderInvalidated',
	rowResized = 'rowResized',
	rowSelectionChanged = 'rowSelectionChanged',
	rowsUpdated = 'rowsUpdated',
	selectionChanged = 'selectionChanged',
	serverBlockLoaded = 'serverBlockLoaded',
	showGroupFooterChanged = 'showGroupFooterChanged',
	sortChanged = 'sortChanged',
}

export interface GridEventPayloadMap<TRowData = unknown> {
	[GridEventName.aggDefsChanged]: { aggDefs: AggregationDef<TRowData>[] | undefined };
	[GridEventName.cellClicked]: GridCellClickParams<TRowData>;
	[GridEventName.cellInvalidated]: { rowId: string; colField: string };
	[GridEventName.cellsCopied]: { cells: Array<{ rowId: string; colField: string }> };
	[GridEventName.cellValueChanged]: { rowId: string; colField: string; oldValue: unknown; newValue: unknown };
	[GridEventName.columnOrderChanged]: { columns: ColumnDef<TRowData>[]; columnFields: string[] };
	[GridEventName.columnReorderToggled]: { enabled: boolean };
	[GridEventName.columnResized]: { colField: string; width: number };
	[GridEventName.columnsChanged]: { columns: ColumnDef<TRowData>[]; columnFields: string[] };
	[GridEventName.editStarted]: { rowId: string; colField: string };
	[GridEventName.editStopped]: { rowId: string; colField: string; cancel: boolean };
	[GridEventName.enableStickyGroupRowsChanged]: { enableStickyGroupRows: boolean | undefined };
	[GridEventName.filterChanged]: { filterModel: FilterModel | null };
	[GridEventName.focusChanged]: { focus: GridCellPointer | null; selection: GridSelectionState };
	[GridEventName.groupByChanged]: { groupBy: string[] | undefined };
	[GridEventName.renderInvalidated]: { reason: string };
	[GridEventName.rowResized]: { rowId: string; height: number };
	[GridEventName.rowSelectionChanged]: RowSelectionChangeResult;
	[GridEventName.rowsUpdated]: {
		changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
		changedNodes: RowNode<TRowData>[];
		addedNodes?: RowNode<TRowData>[];
		removedNodes?: RowNode<TRowData>[];
	};
	[GridEventName.selectionChanged]: { selection: GridSelectionState; result: SelectionChangeResult };
	[GridEventName.serverBlockLoaded]: {
		blockIndex: number;
		loadedBlockStart: number;
		loadedBlockEnd: number;
		totalRecords: number;
		durationMs: number;
	};
	[GridEventName.showGroupFooterChanged]: { showGroupFooter: boolean | undefined };
	[GridEventName.sortChanged]: { sortModel: SortModel | null };
}

// ── Cell renderer / editor props (stay here — they reference GridApi) ─────────

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

// ── Row model ─────────────────────────────────────────────────────────────────

export type RowRefreshReason = 'sort' | 'filter' | 'group' | 'tree' | 'expansion' | 'detail' | 'flatten' | 'bulk' | 'edit';
export interface RowModelRefreshResult {
	changed: boolean;
	reason?: RowRefreshReason;
	previousRowCount?: number;
	nextRowCount?: number;
	changedStartIndex?: number;
	changedEndIndex?: number;
	groupId?: string;
}

export interface RowModel<TRowData = unknown> {
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualRowIndexById(id: string): number;
	getVisualIndexById(visualRowId: string): number;
	getVisualIndexByRowId(rowId: string): number;
	getRowNodeById(rowId: string): RowNode<TRowData> | null;
	getRawRowById(rowId: string): TRowData | null;
	toggleGroupExpanded?(groupId: string): RowModelRefreshResult | void;
	toggleDetailExpanded?(rowId: string): RowModelRefreshResult | void;
	isGroupExpanded?(groupId: string): boolean;
	isDetailExpanded?(rowId: string): boolean;
	expandAllGroups?(): RowModelRefreshResult | void;
	collapseAllGroups?(): RowModelRefreshResult | void;
	getStickyGroupMeta?(): Map<number, number>;
	setRows?(rows: TRowData[]): void;
	updateRows?(updater: (rows: TRowData[]) => TRowData[]): void;
	applyTransaction?(transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData>;
	refresh(reason?: RowRefreshReason): RowModelRefreshResult;
	purgeCache?(): void;
	setDatasource?(datasource: IGridDatasource, blockSize?: number): void;
	setCellValue?(rowId: string, colField: string, value: unknown): boolean;
	loadVisibleBlocks?(startRow: number, endRow: number): void;
}

export interface HeaderMenuRendererProps<TRowData = unknown> {
	colField: string;
	column: ColumnDef<TRowData>;
	api: GridApi<TRowData>;
	close: () => void;
	container: HTMLDivElement;
}

// ── Grid state ────────────────────────────────────────────────────────────────

export interface GridState<TRowData = unknown> {
	getRowId?: (row: TRowData) => string;
	columns: ColumnDef<TRowData>[];
	loading?: boolean;
	loadingSkeletonCount?: number;

	selection: GridSelectionState;

	// Row-level multi-select (independent of cell range selection)
	selectedRowIds: string[];

	rowHeights: Record<string, number>; // rowId -> height in px
	columnWidths: Record<string, number>; // colField -> width in px
	defaultRowHeight: number;
	defaultColWidth: number;
	enableColumnReorder: boolean;

	// Active edit state registers
	activeEdit: GridCellPointer | null;

	// Sorting & Filtering State
	sortModel: SortModel | null;
	filterModel: FilterModel | null;

	// Sidebar UI state
	sidebarOpenPanel?: string | null;

	// Chart overlay UI state
	chartOpen?: boolean;

	// Tree / Grouping / Master-Detail State
	groupBy?: string[];
	aggDefs?: AggregationDef<TRowData>[];
	showGroupFooter?: boolean;
	enableStickyGroupRows?: boolean;
	pinnedColumns?: { left: number; right: number };
	getParentId?: (row: TRowData) => string | null | undefined;
	masterDetailEnabled?: boolean;
	groupRowHeight?: number;
	detailRowHeight?: number;
	detailRenderer?: unknown;
	rowModelConfig?: import('./rowModel.js').RowModelConfig<TRowData>;
	expansion: {
		groups: Record<string, true>;
		treeRows: Record<string, true>;
		details: Record<string, true>;
	};

	// React cache invalidator
	dataVersion: number;

	// 2D Recycled Viewport Range states
	visibleRowRange: ViewportRange;
	visibleColRange: ViewportRange;

	styleSlots?: GridStyleSlots<TRowData>;
	/**
	 * Pixel height of the pre-render buffer above and below the visible viewport.
	 * Default: 400px (roughly 10 rows at the default 40px row height).
	 */
	rowOverscanPx?: number;
	colBuffer?: number;
	runtimeLimits?: {
		maxRenderedRows?: number;
		maxRenderedCells?: number;
		suppressRenderedRangeLimit?: boolean;
	};
	/**
	 * When true, the overscan buffer automatically expands in the scroll direction proportional
	 * to scroll velocity, reducing blank-band flashes during fast scrolling.
	 * Default: false.
	 */
	overscanAdaptive?: boolean;
}

export interface GridCellRangeBounds {
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}

export type GridStateUpdater<TRowData = unknown> = Partial<GridState<TRowData>> | ((state: GridState<TRowData>) => Partial<GridState<TRowData>>);

export type Listener<TRowData = unknown> = (state: GridState<TRowData>) => void;

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

/**
 * Validates column definitions before they are applied to the grid.
 * Throws early with a clear message rather than silently producing broken layout.
 */
export function validateColumns<TRowData>(columns: ColumnDef<TRowData>[]): void {
	const seen = new Set<string>();

	for (const column of columns) {
		const id = column.field;

		if (!id) {
			throw new Error('Open Grid: every column must have a non-empty field.');
		}

		if (seen.has(id)) {
			throw new Error(`Open Grid: duplicate column field "${id}". Each column must have a unique field.`);
		}

		seen.add(id);

		if (column.width != null && (!Number.isFinite(column.width) || column.width <= 0)) {
			throw new Error(`Open Grid: invalid width for column "${id}". Width must be a positive finite number, got ${column.width}.`);
		}
	}
}

/**
 * Validates row IDs produced by getRowId before they are inserted into the grid.
 * Throws on empty or duplicate IDs, which would otherwise cause silent identity corruption.
 */
export function validateRowIds(ids: string[], context = 'setRows'): void {
	const seen = new Set<string>();

	for (const id of ids) {
		if (!id) {
			throw new Error(`Open Grid [${context}]: getRowId returned an empty string. Every row must have a non-empty ID.`);
		}

		if (seen.has(id)) {
			throw new Error(`Open Grid [${context}]: duplicate row ID "${id}". Each row must have a unique ID.`);
		}

		seen.add(id);
	}
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
	setAggDefs(defs: AggregationDef<TRowData>[]): void;
	getAggDefs(): AggregationDef<TRowData>[];
	expandAllGroups(): void;
	collapseAllGroups(): void;
	setShowGroupFooter(enabled: boolean): void;
	setStickyGroupRows(enabled: boolean): void;
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
	destroy(): void;
}

export type { CsvExportOptions };

/**
 * Internal API intended for the rendering engine, plugins, and custom framework adapters.
 * Extends GridApi with renderer-level and store-level access that must not leak to application code.
 *
 * Access this via getInternalApiFromApi(api) or getStoreFromApi(api) from @open-grid/core/internal.
 */
export interface InternalGridApi<TRowData = unknown> extends GridApi<TRowData> {
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
	registerRowModel(rowModel: RowModel<TRowData>): void;
	getRowModel(): RowModel<TRowData> | null;
	registerPlugin(plugin: GridPlugin<TRowData>): void;
	getPlugin<T = unknown>(name: string): T | null;
	unregisterPlugin(name: string): void;
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

export class GridStore<TRowData = unknown> implements InternalGridApi<TRowData> {
	public engine: GridEngine<TRowData>;

	private readonly viewportController: ViewportController<TRowData>;
	private plugins = new Map<string, GridPlugin<TRowData>>();

	constructor(initialState: Partial<GridState<TRowData>> = {}) {
		validateColumns(initialState.columns || []);
		this.engine = new GridEngine<TRowData>({
			columns: initialState.columns || [],
			selection: initialState.selection,
			selectedRowIds: initialState.selectedRowIds ?? [],
			rowHeights: initialState.rowHeights || {},
			columnWidths: initialState.columnWidths || {},
			defaultRowHeight: initialState.defaultRowHeight || 40,
			defaultColWidth: initialState.defaultColWidth || 100,
			enableColumnReorder: initialState.enableColumnReorder ?? true,
			activeEdit: initialState.activeEdit || null,
			sortModel: initialState.sortModel || null,
			filterModel: initialState.filterModel || null,
			getRowId: initialState.getRowId,
			loading: initialState.loading,
			loadingSkeletonCount: initialState.loadingSkeletonCount,
			styleSlots: initialState.styleSlots,
			groupBy: initialState.groupBy,
			getParentId: initialState.getParentId,
			masterDetailEnabled: initialState.masterDetailEnabled,
			groupRowHeight: initialState.groupRowHeight,
			detailRowHeight: initialState.detailRowHeight,
			detailRenderer: initialState.detailRenderer,
			rowModelConfig: initialState.rowModelConfig,
			showGroupFooter: initialState.showGroupFooter,
			enableStickyGroupRows: initialState.enableStickyGroupRows,
			expansion: initialState.expansion,
			rowOverscanPx: initialState.rowOverscanPx ?? 400,
			colBuffer: initialState.colBuffer ?? 1,
			// Phase 2: always normalize runtimeLimits so all callers can assume it exists
			runtimeLimits: {
				maxRenderedRows: 500,
				maxRenderedCells: 20_000,
				suppressRenderedRangeLimit: false,
				...initialState.runtimeLimits,
			},
			overscanAdaptive: initialState.overscanAdaptive,
		});

		this.viewportController = new ViewportController<TRowData>(this.engine);

		// Apply persisted pin counts at construction time before any renders occur
		if (initialState.pinnedColumns) {
			this.viewportController.pinLeftColumns = initialState.pinnedColumns.left ?? 0;
			this.viewportController.pinRightColumns = initialState.pinnedColumns.right ?? 0;
		}

		// Notify plugins of viewport shifts
		this.engine.stateManager.subscribeToKey('visibleRowRange', () => {
			const range = this.state.visibleRowRange;
			this.plugins.forEach((plugin) => {
				if (plugin.onViewportChange) plugin.onViewportChange(range);
			});
		});
	}

	private get state(): GridState<TRowData> {
		return this.engine.stateManager.getState();
	}

	private set state(val: GridState<TRowData>) {
		this.engine.stateManager.setState(val);
	}

	public getState = (): GridState<TRowData> => {
		return this.engine.stateManager.getState();
	};

	public setState = (updater: GridStateUpdater<TRowData>): void => {
		this.engine.stateManager.setState(updater);
	};

	public getRowId = (row: TRowData): string => {
		return this.engine.data.getRowId(row);
	};

	public isRowLoading = (rowId: string): boolean => {
		return this.engine.data.isRowLoading(rowId);
	};

	public getCellValue = (rowId: string, colField: string): unknown => {
		return this.engine.data.getCellValue(rowId, colField);
	};

	public getCachedDisplayValue = (rowId: string, colField: string): string | undefined => {
		return this.engine.data.getCachedDisplayValue(rowId, colField);
	};

	public getCheapDisplayValue = (rowId: string, colField: string): string => {
		return this.engine.data.getCheapDisplayValue(rowId, colField);
	};

	public getComputedCellValue = (rowId: string, colField: string): unknown => {
		return this.engine.data.getComputedCellValue(rowId, colField);
	};

	public getRowOverscanPx = (): number => {
		return this.state.rowOverscanPx ?? 400;
	};

	public setRowOverscanPx = (px: number): void => {
		this.setState({ rowOverscanPx: px });
	};

	public setCellValue = (rowId: string, colField: string, value: unknown): void => {
		this.engine.setCellValue(rowId, colField, value);
	};

	public getCellState = (rowId: string, colField: string): CellState => {
		const computedValue = this.getCellValue(rowId, colField);
		const isEditing = this.state.activeEdit?.rowId === rowId && this.state.activeEdit?.colField === colField;

		let value = computedValue;
		if (this.engine.hasFormula(rowId, colField)) {
			value = this.engine.getFormula(rowId, colField);
		} else {
			value = this.engine.data.getRawCellValue(rowId, colField);
		}

		return {
			value,
			computedValue,
			isEditing,
		};
	};

	public selectCell = (pointer: GridCellPointer | null, source: GridSelectionSource = 'api'): void => {
		this.engine.selectRange(pointer, pointer, source);
	};

	public selectRange = (start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'api'): void => {
		this.engine.selectRange(start, end, source);
	};

	public extendSelection = (end: GridCellPointer, source: GridSelectionSource = 'api'): void => {
		const state = this.getState();
		this.engine.selectRange(state.selection.anchor ?? state.selection.focus ?? end, end, source);
	};

	public applyRowSelectionGesture = (gesture: RowSelectionGesture): RowSelectionChangeResult | null => {
		return this.engine.applyRowSelectionGesture(gesture);
	};

	public selectRows = (rowIds: string[]): void => {
		this.engine.selectRowIds(rowIds, 'api');
	};

	public deselectRows = (rowIds: string[]): void => {
		this.engine.deselectRowIds(rowIds, 'api');
	};

	public toggleRowSelection = (rowId: string): void => {
		this.engine.toggleRowId(rowId, 'api');
	};

	public selectAllRows = (): void => {
		this.engine.selectAllDataRows('api');
	};

	public clearRowSelection = (): void => {
		this.engine.clearRowSelection('api');
	};

	public isRowNodeSelected = (rowId: string): boolean => {
		return this.state.selectedRowIds.includes(rowId);
	};

	public setColumnWidth = (colField: string, width: number): void => {
		this.engine.resizeColumn(colField, width);
	};

	public setColumnVisible = (colField: string, visible: boolean): void => {
		const columns = this.state.columns;
		const column = columns.find((candidate) => candidate.field === colField);
		if (!column || column.hide === !visible) return;
		this.engine.setColumns(
			columns.map((candidate) => (candidate.field === colField ? { ...candidate, hide: !visible } : candidate)),
			false
		);
	};

	public setColumnsVisible = (colFields: string[], visible: boolean): void => {
		const fieldSet = new Set(colFields);
		if (fieldSet.size === 0) return;
		let changed = false;
		const columns = this.state.columns.map((column) => {
			if (!fieldSet.has(column.field) || column.hide === !visible) return column;
			changed = true;
			return { ...column, hide: !visible };
		});
		if (changed) {
			this.engine.setColumns(columns, false);
		}
	};

	public getColumns = (): ColumnDef<TRowData>[] => {
		return this.state.columns.slice();
	};

	public getDisplayedColumns = (): ColumnDef<TRowData>[] => {
		return this.engine.columns.getDisplayedColumns().slice();
	};

	public setPinnedColumns = (pins: { left?: number; right?: number }): void => {
		this.setViewportPins(pins);
	};

	public getPinnedColumns = (): { left: number; right: number } => {
		return {
			left: this.engine.viewport.pinLeftColumns,
			right: this.engine.viewport.pinRightColumns,
		};
	};

	public moveColumn = (colField: string, toIndex: number): void => {
		this.engine.moveColumn(colField, toIndex);
	};

	public setColumnOrder = (colFields: string[]): void => {
		this.engine.setColumnOrderByFields(colFields);
	};

	public setColumnReorderEnabled = (enabled: boolean): void => {
		this.engine.setColumnReorderEnabled(enabled);
	};

	public setRowHeight = (rowId: string, height: number): void => {
		this.engine.resizeRow(rowId, height);
	};

	public setSortModel = (sortModel: SortModel | null): void => {
		this.engine.setSortModel(sortModel);
	};

	public setFilterModel = (filterModel: FilterModel | null): void => {
		this.engine.setFilterModel(filterModel);
	};

	public setGroupBy = (colIds: string[]): void => {
		this.engine.setGroupBy(colIds);
	};

	public getGroupBy = (): string[] => {
		return this.state.groupBy ?? [];
	};

	public setAggDefs = (defs: AggregationDef<TRowData>[]): void => {
		this.engine.setAggDefs(defs);
	};

	public getAggDefs = (): AggregationDef<TRowData>[] => {
		return this.state.aggDefs ?? [];
	};

	private applyRowModelRefreshInvalidation = (
		result: RowModelRefreshResult | void,
		reason: 'group expansion' | 'detail',
		groupId?: string
	): void => {
		if (!result?.changed) return;

		const invalidationReason = reason;
		const targetGroupId = result.groupId ?? groupId;
		if (targetGroupId) {
			this.engine.invalidation.invalidateGroup(targetGroupId, invalidationReason);
		}
		if (result.changedStartIndex !== undefined && result.changedEndIndex !== undefined) {
			this.engine.invalidation.invalidateRowRange(result.changedStartIndex, result.changedEndIndex, invalidationReason);
		}
		if (result.previousRowCount !== result.nextRowCount) {
			this.engine.invalidation.invalidateGeometry(invalidationReason);
		}
		this.engine.invalidation.invalidateViewport(invalidationReason);
	};

	public expandAllGroups = (): void => {
		this.applyRowModelRefreshInvalidation(this.getRowModel()?.expandAllGroups?.(), 'group expansion');
	};

	public collapseAllGroups = (): void => {
		this.applyRowModelRefreshInvalidation(this.getRowModel()?.collapseAllGroups?.(), 'group expansion');
	};

	public setShowGroupFooter = (enabled: boolean): void => {
		this.engine.setShowGroupFooter(enabled);
	};

	public setStickyGroupRows = (enabled: boolean): void => {
		this.engine.setStickyGroupRows(enabled);
	};

	public exportCsv = (options?: CsvExportOptions): void => {
		exportToCsv(this, options);
	};

	// All persistence methods are overridden by createApiFacade when an adapter is configured.
	public hasPersistence = (): boolean => false;
	public clearPersistedState = (): void => {};
	public setAutoSave = (_enabled: boolean): void => {};
	public isAutoSaveEnabled = (): boolean => true;
	public getPersistenceStatus = (): PersistenceStatus => ({ status: 'idle', autoSave: true });
	public subscribeToPersistenceStatus =
		(_listener: (status: PersistenceStatus) => void): (() => void) =>
		() => {};
	public saveNow = (): void => {};

	public openPanel = (panelId: string): void => {
		this.setState({ sidebarOpenPanel: panelId });
	};

	public closePanel = (): void => {
		this.setState({ sidebarOpenPanel: null });
	};

	public togglePanel = (panelId: string): void => {
		const current = this.state.sidebarOpenPanel;
		this.setState({ sidebarOpenPanel: current === panelId ? null : panelId });
	};

	public getOpenPanel = (): string | null => {
		return this.state.sidebarOpenPanel ?? null;
	};

	public openChart = (): void => {
		this.setState({ chartOpen: true });
	};

	public closeChart = (): void => {
		this.setState({ chartOpen: false });
	};

	public toggleChart = (): void => {
		this.setState({ chartOpen: !this.state.chartOpen });
	};

	public isChartOpen = (): boolean => {
		return this.state.chartOpen ?? false;
	};

	public setStyleSlots = (styleSlots: GridStyleSlots<TRowData> | undefined): void => {
		this.engine.setStyleSlots(styleSlots);
	};

	public toggleGroupExpanded = (groupId: string): void => {
		this.applyRowModelRefreshInvalidation(this.getRowModel()?.toggleGroupExpanded?.(groupId), 'group expansion', groupId);
	};

	public toggleDetailExpanded = (rowId: string): void => {
		this.applyRowModelRefreshInvalidation(this.getRowModel()?.toggleDetailExpanded?.(rowId), 'detail');
	};

	public isGroupExpanded = (groupId: string): boolean => {
		return this.getRowModel()?.isGroupExpanded?.(groupId) ?? false;
	};

	public isDetailExpanded = (rowId: string): boolean => {
		return this.getRowModel()?.isDetailExpanded?.(rowId) ?? false;
	};

	public getVisualRow = (index: number): VisualRow<TRowData> | null => {
		return this.getRowModel()?.getVisualRow(index) ?? null;
	};

	public getVisualRowCount = (): number => {
		return this.getRowModel()?.getVisualRowCount() ?? 0;
	};

	public getVisualRowIndexById = (id: string): number | null => {
		return this.getRowModel()?.getVisualRowIndexById(id) ?? null;
	};

	public getVisualIndexById = (visualRowId: string): number | null => {
		const idx = this.getRowModel()?.getVisualIndexById(visualRowId);
		return idx !== undefined && idx >= 0 ? idx : null;
	};

	public getVisualIndexByRowId = (rowId: string): number | null => {
		const idx = this.getRowModel()?.getVisualIndexByRowId(rowId);
		return idx !== undefined && idx >= 0 ? idx : null;
	};

	public getRowNodeById = (rowId: string): RowNode<TRowData> | null => {
		return this.getRowModel()?.getRowNodeById(rowId) ?? null;
	};

	public getRawRowById = (rowId: string): TRowData | null => {
		return this.getRowModel()?.getRawRowById(rowId) ?? null;
	};

	public addEventListener = <K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	): (() => void) => {
		return this.engine.eventBus.addEventListener(type, callback);
	};

	public dispatchEvent = <K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void => {
		this.engine.eventBus.dispatchEvent(type, payload);
	};

	public startEditing = (rowId: string, colField: string): void => {
		this.engine.startEdit(rowId, colField);
	};

	public stopEditing = (cancel: boolean = false): void => {
		this.engine.stopEdit(cancel);
	};

	public registerRowModel = (rowModel: RowModel<TRowData>): void => {
		this.engine.registerRowModel(rowModel);
	};

	public getRowModel = (): RowModel<TRowData> | null => {
		return this.engine.getRowModel();
	};

	public getDataRowAtVisualIndex = (index: number): TRowData | null => {
		const vr = this.getVisualRow(index);
		return vr?.kind === 'data' ? vr.node.data : null;
	};

	public getDataRowNodeAtVisualIndex = (index: number): RowNode<TRowData> | null => {
		const vr = this.getVisualRow(index);
		return vr?.kind === 'data' ? vr.node : null;
	};

	public rows = (): GridRowsAccessor<TRowData> => {
		return {
			forEach: (callback) => {
				const count = this.getVisualRowCount();
				let dataIndex = 0;
				for (let i = 0; i < count; i++) {
					const row = this.getDataRowAtVisualIndex(i);
					if (row !== null) {
						callback(row, dataIndex++);
					}
				}
			},
			getAll: () => {
				const count = this.getVisualRowCount();
				const rows: TRowData[] = [];
				for (let i = 0; i < count; i++) {
					const row = this.getDataRowAtVisualIndex(i);
					if (row !== null) {
						rows.push(row);
					}
				}
				return rows;
			},
			getSelected: () => {
				const bounds = this.state.selection.bounds;
				if (!bounds) return [];
				const rows: TRowData[] = [];
				for (let i = bounds.minRow; i <= bounds.maxRow; i++) {
					const row = this.getDataRowAtVisualIndex(i);
					if (row !== null) {
						rows.push(row);
					}
				}
				return rows;
			},
			getSelectedIds: () => {
				const bounds = this.state.selection.bounds;
				if (!bounds) return [];
				const ids: string[] = [];
				for (let i = bounds.minRow; i <= bounds.maxRow; i++) {
					const vr = this.getVisualRow(i);
					if (vr?.kind === 'data') {
						ids.push(vr.rowId);
					}
				}
				return ids;
			},
			getById: (id) => {
				return this.getRawRowById(id);
			},
			getNodeById: (id) => {
				return this.getRowNodeById(id);
			},
			getCount: () => {
				const count = this.getVisualRowCount();
				let dataCount = 0;
				for (let i = 0; i < count; i++) {
					const vr = this.getVisualRow(i);
					if (vr?.kind === 'data') {
						dataCount++;
					}
				}
				return dataCount;
			},
			getVisualRowById: (id) => {
				const index = this.getVisualIndexByRowId(id);
				if (index === null || index === -1) return null;
				return this.getVisualRow(index);
			},
			inRange: (range) => {
				const startIdx = this.getVisualIndexByRowId(range.start.rowId);
				const endIdx = this.getVisualIndexByRowId(range.end.rowId);
				const hasValidIndices = startIdx !== null && endIdx !== null && startIdx !== -1 && endIdx !== -1;

				return {
					forEach: (callback) => {
						if (!hasValidIndices) return;
						const minRow = Math.min(startIdx!, endIdx!);
						const maxRow = Math.max(startIdx!, endIdx!);
						let idx = 0;
						for (let i = minRow; i <= maxRow; i++) {
							const vr = this.getVisualRow(i);
							if (vr?.kind === 'data') {
								callback(vr.rowId, idx++);
							}
						}
					},
					getIds: () => {
						if (!hasValidIndices) return [];
						const minRow = Math.min(startIdx!, endIdx!);
						const maxRow = Math.max(startIdx!, endIdx!);
						const ids: string[] = [];
						for (let i = minRow; i <= maxRow; i++) {
							const vr = this.getVisualRow(i);
							if (vr?.kind === 'data') {
								ids.push(vr.rowId);
							}
						}
						return ids;
					},
					getData: () => {
						if (!hasValidIndices) return [];
						const minRow = Math.min(startIdx!, endIdx!);
						const maxRow = Math.max(startIdx!, endIdx!);
						const data: TRowData[] = [];
						for (let i = minRow; i <= maxRow; i++) {
							const row = this.getDataRowAtVisualIndex(i);
							if (row !== null) {
								data.push(row);
							}
						}
						return data;
					},
				};
			},
			getChecked: (): TRowData[] => {
				const checkedSet = new Set(this.state.selectedRowIds);
				const result: TRowData[] = [];
				const rowModel = this.getRowModel();
				if (rowModel) {
					const count = rowModel.getVisualRowCount();
					for (let i = 0; i < count; i++) {
						const vr = rowModel.getVisualRow(i);
						if (vr?.kind === 'data' && checkedSet.has(vr.rowId)) {
							const node = rowModel.getRowNodeById(vr.rowId);
							if (node) result.push(node.data);
						}
					}
				}
				return result;
			},
			getCheckedIds: (): string[] => {
				return [...this.state.selectedRowIds];
			},
		};
	};

	public setRows = (rows: TRowData[]): void => {
		this.getRowModel()?.setRows?.(rows);
	};

	public updateRows = (updater: (rows: TRowData[]) => TRowData[]): void => {
		this.getRowModel()?.updateRows?.(updater);
	};

	public applyTransaction = (transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData> | null => {
		const rowModel = this.getRowModel();
		if (!rowModel?.applyTransaction) return null;
		return rowModel.applyTransaction(transaction);
	};

	public transaction = (transaction: GridTransaction<TRowData>): RowNodeTransaction<TRowData> | null => {
		let rowResult: RowNodeTransaction<TRowData> | null = null;
		this.engine.batch(() => {
			if (transaction.columns) {
				this.setColumns(transaction.columns);
			}
			if (transaction.rows) {
				this.setRows(transaction.rows);
			}
			if (transaction.rowTransaction) {
				rowResult = this.applyTransaction(transaction.rowTransaction);
			}
			if ('sortModel' in transaction) {
				this.setSortModel(transaction.sortModel ?? null);
			}
			if ('filterModel' in transaction) {
				this.setFilterModel(transaction.filterModel ?? null);
			}
			if (transaction.pins) {
				this.setViewportPins(transaction.pins);
			}
			if ('styleSlots' in transaction) {
				this.setStyleSlots(transaction.styleSlots);
			}
		});
		return rowResult;
	};

	public refreshRows = (): void => {
		this.getRowModel()?.refresh();
	};

	public setRowHeights = (rowHeights: Record<string, number> | undefined): void => {
		const current = this.state.rowHeights;
		const next = rowHeights ?? {};
		const currentKeys = Object.keys(current);
		const nextKeys = Object.keys(next);
		if (currentKeys.length === nextKeys.length) {
			let equal = true;
			for (const key of currentKeys) {
				if (current[key] !== next[key]) {
					equal = false;
					break;
				}
			}
			if (equal) return;
		}
		this.engine.stateManager.setState({ rowHeights: next });
	};

	public setDefaultRowHeight = (defaultRowHeight?: number | undefined): void => {
		if (defaultRowHeight === undefined) return;
		if (this.state.defaultRowHeight === defaultRowHeight) return;
		this.engine.stateManager.setState({ defaultRowHeight });
	};

	public purgeCache = (): void => {
		this.getRowModel()?.purgeCache?.();
	};

	public setServerDatasource = (datasource: IGridDatasource, blockSize?: number): void => {
		this.getRowModel()?.setDatasource?.(datasource, blockSize);
	};

	public setViewportPins = (pins: { left?: number; right?: number; top?: number; bottom?: number }): void => {
		if (pins.left !== undefined) this.viewportController.pinLeftColumns = pins.left;
		if (pins.right !== undefined) this.viewportController.pinRightColumns = pins.right;
		if (pins.top !== undefined) this.viewportController.pinTopRows = pins.top;
		if (pins.bottom !== undefined) this.viewportController.pinBottomRows = pins.bottom;
		// Sync column pin counts into state so they can be subscribed to and persisted
		if (pins.left !== undefined || pins.right !== undefined) {
			this.engine.stateManager.setState({
				pinnedColumns: {
					left: this.viewportController.pinLeftColumns,
					right: this.viewportController.pinRightColumns,
				},
			});
		}
	};

	public setViewportSize = (width: number, height: number): boolean => {
		return this.viewportController.setViewportSize(width, height);
	};

	public setScrollPosition = (scrollTop: number, scrollLeft: number, timestamp?: number): boolean => {
		return this.viewportController.setScrollPosition(scrollTop, scrollLeft, timestamp);
	};

	public getScrollVelocity = (): { vx: number; vy: number } => {
		return this.viewportController.getVelocity();
	};

	public getVisibleRowRange = (): ViewportRange => {
		return this.viewportController.getVisibleRowRange();
	};

	public getVisibleColumnRange = (): ViewportRange => {
		return this.viewportController.getVisibleColumnRange();
	};

	public updateVisibleRanges = (): boolean => {
		return this.viewportController.updateVisibleRanges();
	};

	public subscribe = (listener: Listener<TRowData>): (() => void) => {
		return this.engine.stateManager.subscribe(listener);
	};

	public subscribeToKey = (key: string, listener: Listener<TRowData>): (() => void) => {
		return this.engine.stateManager.subscribeToKey(key, listener);
	};

	public subscribeToViewport = (listener: Listener<TRowData>): (() => void) => {
		const unsubscribeRows = this.subscribeToKey('visibleRowRange', listener);
		const unsubscribeCols = this.subscribeToKey('visibleColRange', listener);
		return () => {
			unsubscribeRows();
			unsubscribeCols();
		};
	};

	public subscribeToSelection = (listener: Listener<TRowData>): (() => void) => {
		return this.subscribeToKey('selection', listener);
	};

	public subscribeToFocusedCell = (listener: Listener<TRowData>): (() => void) => {
		return this.subscribeToKey('selection', listener);
	};

	public subscribeToEditingCell = (listener: Listener<TRowData>): (() => void) => {
		return this.subscribeToKey('activeEdit', listener);
	};

	public subscribeToCell = (rowId: string, colField: string, listener: () => void): (() => void) => {
		const sub: CellSubscription = { rowId, colField, onStoreChange: listener };
		this.registerCellSubscription(sub);
		return () => this.unregisterCellSubscription(sub);
	};

	public subscribeToRow = (rowId: string, listener: Listener<TRowData>): (() => void) => {
		const unsubscribeData = this.subscribeToKey('dataVersion', listener);
		const unsubscribeHeights = this.subscribeToKey('rowHeights', listener);
		const unsubscribeEvent = this.addEventListener(GridEventName.rowResized, (event) => {
			if (event.payload.rowId === rowId) listener(this.getState());
		});
		return () => {
			unsubscribeData();
			unsubscribeHeights();
			unsubscribeEvent();
		};
	};

	public subscribeToColumn = (colField: string, listener: Listener<TRowData>): (() => void) => {
		const unsubscribeColumns = this.subscribeToKey('columns', listener);
		const unsubscribeWidths = this.subscribeToKey('columnWidths', listener);
		const unsubscribeEvent = this.addEventListener(GridEventName.columnResized, (event) => {
			if (event.payload.colField === colField) listener(this.getState());
		});
		return () => {
			unsubscribeColumns();
			unsubscribeWidths();
			unsubscribeEvent();
		};
	};

	public subscribeToHeaders = (listener: Listener<TRowData>): (() => void) => {
		const unsubscribeColumns = this.subscribeToKey('columns', listener);
		const unsubscribeWidths = this.subscribeToKey('columnWidths', listener);
		const unsubscribeSort = this.subscribeToKey('sortModel', listener);
		return () => {
			unsubscribeColumns();
			unsubscribeWidths();
			unsubscribeSort();
		};
	};

	public triggerCellNotifications = (rowId: string): void => {
		for (const col of this.state.columns) {
			this.engine.notifyCellChange(rowId, col.field);
		}
	};

	public setColumns = (columns: ColumnDef<TRowData>[]): void => {
		validateColumns(columns);
		this.engine.setColumns(columns);
	};

	public getColumnIndex = (colField: string): number => {
		return this.engine.columns.getColumnIndex(colField);
	};

	public getColumnField = (colIndex: number): string | null => {
		return this.engine.columns.getColumnField(colIndex);
	};

	public getColumnDef = (colField: string): ColumnDef<TRowData> | undefined => {
		return this.engine.columns.getColumnDef(colField);
	};

	public getCellAccess = (rowId: string, colField: string): GridCellAccess<TRowData> | null => {
		return this.engine.cellAccess.getByPointer(rowId, colField);
	};

	public registerCellSubscription = (sub: CellSubscription): void => {
		this.engine.registerCellSubscription(sub);
	};

	public unregisterCellSubscription = (sub: CellSubscription): void => {
		this.engine.unregisterCellSubscription(sub);
	};

	public updateCellSubscription = (sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void => {
		this.engine.updateCellSubscription(sub, oldRowId, oldColField, newRowId, newColField);
	};

	public get batchedUpdates(): boolean {
		return this.engine.batchedUpdates;
	}

	public set batchedUpdates(enabled: boolean) {
		this.engine.batchedUpdates = enabled;
	}

	public batch = (callback: () => void): void => {
		this.engine.batch(callback);
	};

	public flushCellUpdatesSync = (): void => {
		this.engine.flushCellUpdatesSync();
	};

	public registerPlugin = (plugin: GridPlugin<TRowData>): void => {
		if (this.plugins.has(plugin.name)) {
			this.unregisterPlugin(plugin.name);
		}
		this.plugins.set(plugin.name, plugin);

		if (plugin.onInit) {
			plugin.onInit(this);
		}
	};

	public unregisterPlugin = (name: string): void => {
		const plugin = this.plugins.get(name);
		if (!plugin) return;

		if (plugin.onDestroy) {
			try {
				plugin.onDestroy();
			} catch (e) {
				console.error(e);
			}
		}

		this.plugins.delete(name);
	};

	public getPlugin = <T = unknown>(name: string): T | null => {
		return (this.plugins.get(name) as unknown as T) || null;
	};

	public undo = (): void => {
		this.engine.undo();
	};

	public redo = (): void => {
		this.engine.redo();
	};

	public canUndo = (): boolean => {
		return this.engine.commandHistory.canUndo();
	};

	public canRedo = (): boolean => {
		return this.engine.commandHistory.canRedo();
	};

	public getRenderStats = (): RenderStats => {
		if (this.engine.getRenderStats) {
			return this.engine.getRenderStats();
		}
		return {
			fullPaints: 0,
			rowPaints: 0,
			cellPaints: 0,
			headerPaints: 0,
			overlayPaints: 0,
			geometryRecomputes: 0,
			viewportPaints: 0,
			scrollFrames: 0,
			viewportRecycles: 0,
			headerPaintsDuringScroll: 0,
			headerRangeSyncsDuringScroll: 0,
			overlayPaintsDuringScroll: 0,
			overlayCheapSyncsDuringScroll: 0,
			portalFlushesDuringScroll: 0,
			portalDeferredDuringScroll: 0,
			portalMountsDuringScroll: 0,
			portalReleasesDuringScroll: 0,
			portalFlushChunks: 0,
			maxPortalOpsFlushedInOneChunk: 0,
			focusCallsDuringScroll: 0,
			rootTextContentWritesOnPortalCells: 0,
			cellsBoundDuringScroll: 0,
			rowsVisitedDuringScroll: 0,
			rowsReboundDuringScroll: 0,
			cellsVisitedDuringScroll: 0,
			cellsWrittenDuringScroll: 0,
			portalOpsDuringScroll: 0,
			cellsDecoratedAfterScroll: 0,
			cellAccessReadsDuringScroll: 0,
			cellClassComputesDuringScroll: 0,
			dirtyCellsMarkedDuringScroll: 0,
			postScrollDirtyCellsDecorated: 0,
			reusableCellsSkippedDuringScroll: 0,
			styleHookCallsDuringScroll: 0,
			rowsEnteredDuringScroll: 0,
			rowsExitedDuringScroll: 0,
			rowsStayedDuringScroll: 0,
			colsEnteredDuringScroll: 0,
			colsExitedDuringScroll: 0,
			colsStayedDuringScroll: 0,
			cellsSkippedDuringScroll: 0,
			sameWindowBailouts: 0,
			stateReadsDuringScroll: 0,
			compiledPlanVersion: this.engine.columns.getCompiledPlanVersion(),
			hotDomReleases: 0,
			coldDomReleases: 0,
			cellsPatchedPerScrollFrame: [],
			rowsRecycledPerScrollFrame: [],
			lastInvalidationReasons: [],
			lastInvalidations: [],
			portalMounts: { cells: 0, rows: 0, menus: 0, custom: { active: 0, warm: 0, cold: 0, hydrationQueue: 0, completedChunks: 0 } },
			getCellValueCallsDuringScroll: 0,
			valueGetterCallsDuringScroll: 0,
			formulaCallsDuringScroll: 0,
			customRendererMountsDuringScroll: 0,
			customRendererHydrationChunks: 0,
			customRendererWarmHits: 0,
			customRendererWarmMisses: 0,
		};
	};

	public resetRenderStats = (): void => {
		this.engine.resetRenderStats?.();
	};

	public destroy = (): void => {
		this.plugins.forEach((plugin) => {
			if (plugin.onDestroy) {
				try {
					plugin.onDestroy();
				} catch (e) {
					console.error(e);
				}
			}
		});
		this.plugins.clear();

		this.engine.destroy();
	};
}
