import type { FilterModel, SortModel } from './rowModel.js';
import type { IGridDatasource } from './serverRowModel.js';
import { ViewportController, type ViewportRange } from './viewportController.js';
import { GridEngine } from './engine/GridEngine.js';
import type { GroupPathItem } from './rows/visualRowIds.js';

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

export class RowNode<TRowData = unknown> {
	public id!: string;
	public data!: TRowData;

	// Caches computed cell values for this row until the row data changes.
	private cellValueCache = new Map<string, unknown>();

	constructor(id: string, data: TRowData) {
		this.id = id;
		this.data = data;
	}

	public setData(data: TRowData): void {
		if (this.data !== data) {
			this.data = data;
			this.clearValueCache();
		}
	}

	public getCellValue(colField: string, compiledGetter: (data: TRowData) => unknown): unknown {
		if (this.cellValueCache.has(colField)) {
			return this.cellValueCache.get(colField);
		}
		const val = compiledGetter(this.data);
		this.cellValueCache.set(colField, val);
		return val;
	}

	public clearValueCache(): void {
		this.cellValueCache.clear();
	}
}

export interface DataVisualRow<T> {
	kind: 'data';
	id: string;
	rowId: string;
	node: RowNode<T>;
	depth: number;
	height?: number;
	selectable?: true;
	editable?: true;
}

export interface GroupVisualRow<T> {
	kind: 'group';
	id: string;
	groupId: string;
	field: string;
	key: unknown;
	keyString: string;
	path: GroupPathItem[];
	depth: number;
	expanded: boolean;
	childCount: number;
	leafCount: number;
	aggregateValues?: Record<string, unknown>;
	aggregate?: Record<string, unknown>;
	height?: number;
	selectable?: boolean;
	editable?: false;
}

export interface DetailVisualRow<T> {
	kind: 'detail';
	id: string;
	parentId: string;
	parentRowId?: string;
	depth: number;
	height: number;
	render: unknown;
	selectable?: false;
	editable?: false;
}

export interface FooterVisualRow<T> {
	kind: 'footer';
	id: string;
	parentGroupId: string;
	depth: number;
	aggregateValues?: Record<string, unknown>;
	aggregate?: Record<string, unknown>;
	height?: number;
	editable?: false;
}

export interface LoadingVisualRow {
	kind: 'loading';
	id: string;
	rowIndex: number;
	height?: number;
	editable?: false;
}

export type VisualRow<TRowData = unknown> =
	| DataVisualRow<TRowData>
	| GroupVisualRow<TRowData>
	| DetailVisualRow<TRowData>
	| FooterVisualRow<TRowData>
	| LoadingVisualRow;

export function isDataVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): row is DataVisualRow<TRowData> {
	return row?.kind === 'data';
}

export function isFullWidthVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return row?.kind === 'detail' || row?.kind === 'loading';
}

export function isSelectableVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	if (row?.kind === 'data') return true;
	if (row?.kind === 'group') return row.selectable !== false;
	return false;
}

export function isEditableVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return row?.kind === 'data';
}

export function canEditCell<TRowData>(row: VisualRow<TRowData> | null | undefined, column: ColumnDef<TRowData> | null | undefined): boolean {
	return row?.kind === 'data' && !!column;
}

export function canFocusVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return !!row && row.kind !== 'loading';
}

export function isDataCellSelectable<TRowData>(row: VisualRow<TRowData> | null | undefined, column: ColumnDef<TRowData> | null | undefined): boolean {
	return row?.kind === 'data' && !!column;
}

export interface ValueGetterParams<TRowData = unknown> {
	node: RowNode<TRowData>;
	row: TRowData;
	colField: string;
}

export type CellRendererPhase = 'initial' | 'scroll' | 'scroll-idle' | 'interaction' | 'edit' | 'destroy';

export interface CellRendererCapabilities {
	/**
	 * Whether renderer content should stay live, defer updates, or show fallback while scrolling.
	 */
	scrollBehavior?: 'live' | 'defer' | 'fallback';
	/**
	 * Future lifecycle hint for renderer instance reuse.
	 */
	recycle?: 'rebind' | 'preserve' | 'destroy';
	estimatedCost?: 'cheap' | 'medium' | 'expensive';
	interactive?: boolean;
	supportsRebind?: boolean;
	warmCache?: boolean;
}

export interface CellRendererProps<TRowData = unknown> {
	value: unknown;
	computedValue: unknown;
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

export interface CellEditorProps<TRowData = unknown> {
	rowId: string;
	colField: string;
	value: unknown;
	/**
	 * Update the local editing value without committing.
	 * Use this for text inputs where user is still typing.
	 */
	onChange: (value: unknown) => void;
	api: GridApi<TRowData>;
	/**
	 * Commit the value and exit edit mode.
	 * If no value is provided, commits the current value from onChange.
	 */
	onCommit: (finalValue?: unknown) => void;
	/**
	 * Cancel editing and revert to original value.
	 */
	onCancel: () => void;
}

export function getValueByPath(obj: unknown, path: string): unknown {
	if (!obj || typeof obj !== 'object' || !path) return undefined;
	const record = obj as Record<string, unknown>;
	if (!path.includes('.')) return record[path];
	return path.split('.').reduce((acc: unknown, part) => {
		if (acc && typeof acc === 'object') {
			return (acc as Record<string, unknown>)[part];
		}
		return undefined;
	}, obj);
}

export function setValueByPath(obj: unknown, path: string, value: unknown): boolean {
	if (!obj || typeof obj !== 'object' || !path) return false;
	const record = obj as Record<string, unknown>;
	if (!path.includes('.')) {
		record[path] = value;
		return true;
	}
	const parts = path.split('.');
	let curr = record;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!curr[part] || typeof curr[part] !== 'object') {
			curr[part] = {};
		}
		curr = curr[part] as Record<string, unknown>;
	}
	curr[parts[parts.length - 1]] = value;
	return true;
}

const pathGetterCache = new Map<string, (data: unknown) => unknown>();

export function compilePathGetter(path: string): (data: unknown) => unknown {
	if (!path) return () => undefined;
	if (pathGetterCache.has(path)) return pathGetterCache.get(path)!;

	let getter: (data: unknown) => unknown;
	if (!path.includes('.')) {
		getter = (data: unknown) => (data && typeof data === 'object' ? (data as Record<string, unknown>)[path] : undefined);
	} else {
		const parts = path.split('.');
		getter = (data: unknown) => {
			let curr: unknown = data;
			for (let i = 0; i < parts.length; i++) {
				if (curr === null || curr === undefined || typeof curr !== 'object') return undefined;
				curr = (curr as Record<string, unknown>)[parts[i]];
			}
			return curr;
		};
	}
	pathGetterCache.set(path, getter);
	return getter;
}

export type RowRefreshReason = 'sort' | 'filter' | 'group' | 'tree' | 'expansion' | 'detail' | 'flatten' | 'bulk' | 'edit';
export interface RowModelRefreshResult {
	changed: boolean;
}

export interface RowModel<TRowData = unknown> {
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualRowIndexById(id: string): number;
	getVisualIndexById(visualRowId: string): number;
	getVisualIndexByRowId(rowId: string): number;
	getRowNodeById(rowId: string): RowNode<TRowData> | null;
	getRawRowById(rowId: string): TRowData | null;
	toggleGroupExpanded?(groupId: string): void;
	toggleDetailExpanded?(rowId: string): void;
	isGroupExpanded?(groupId: string): boolean;
	isDetailExpanded?(rowId: string): boolean;
	setRows?(rows: TRowData[]): void;
	updateRows?(updater: (rows: TRowData[]) => TRowData[]): void;
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

export interface ColumnDef<TRowData = unknown> {
	field: string;
	header: string;
	width?: number;
	hide?: boolean;
	movable?: boolean;
	loading?: boolean;
	valueGetter?: (params: ValueGetterParams<TRowData>) => unknown;
	valueGetterDependencies?: string[];
	valueSetter?: (row: TRowData, value: unknown) => boolean;
	cellRenderer?: (props: CellRendererProps<TRowData>) => unknown;
	cellRendererCapabilities?: CellRendererCapabilities;
	cellEditor?: (props: CellEditorProps<TRowData>) => unknown;
	headerMenuRenderer?: (props: HeaderMenuRendererProps<TRowData>) => void;
	headerMenuComponent?: any;
	sortable?: boolean;
}

export interface GridRowClassParams<TRowData = unknown> {
	row: TRowData;
	rowId: string;
	rowIndex: number;
	isFocused: boolean;
	isSelected: boolean;
	isLoading: boolean;
	selection: GridSelectionState;
}

export interface GridCellClassParams<TRowData = unknown> {
	row: TRowData;
	rowId: string;
	rowIndex: number;
	col: ColumnDef<TRowData>;
	colField: string;
	colIndex: number;
	isFocused: boolean;
	isRowFocused: boolean;
	isRowSelected: boolean;
	isSelected: boolean;
	isEditing: boolean;
	value: unknown;
	rawValue: unknown;
	isLoading: boolean;
	selection: GridSelectionState;
}

export interface GridStyleSlots<TRowData = unknown> {
	rowClass?: (row: TRowData, params: GridRowClassParams<TRowData>) => string;
	cellClass?: (col: ColumnDef<TRowData>, row: TRowData, params: GridCellClassParams<TRowData>) => string;
	headerCellClass?: (col: ColumnDef<TRowData>) => string;
	beforeCellRender?: (cell: GridCellAccess<TRowData>, element: HTMLElement) => void;
	afterCellRender?: (cell: GridCellAccess<TRowData>, element: HTMLElement) => void;
	groupRowClass?: (visualRow: Extract<VisualRow<TRowData>, { kind: 'group' }>) => string;
	detailRowClass?: (visualRow: Extract<VisualRow<TRowData>, { kind: 'detail' }>) => string;
}

export function getCellRendererCapabilities<TRowData>(col: ColumnDef<TRowData>): Required<CellRendererCapabilities> {
	return {
		scrollBehavior: col.cellRendererCapabilities?.scrollBehavior ?? 'fallback',
		recycle: col.cellRendererCapabilities?.recycle ?? 'preserve',
		estimatedCost: col.cellRendererCapabilities?.estimatedCost ?? 'medium',
		interactive: col.cellRendererCapabilities?.interactive ?? false,
		supportsRebind: col.cellRendererCapabilities?.supportsRebind ?? false,
		warmCache: col.cellRendererCapabilities?.warmCache ?? true,
	};
}

export interface GridState<TRowData = unknown> {
	getRowId?: (row: TRowData) => string;
	columns: ColumnDef<TRowData>[];
	loading?: boolean;
	loadingSkeletonCount?: number;

	selection: GridSelectionState;

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

	// Tree / Grouping / Master-Detail State
	groupBy?: string[];
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
	refreshRows(): void;
	setRowHeights: (rowHeights: Record<string, number> | undefined) => void;
	setDefaultRowHeight: (defaultRowHeight?: number | undefined) => void;
	purgeCache(): void;
	setServerDatasource(datasource: IGridDatasource, blockSize?: number): void;
	getCellValue(rowId: string, colField: string): unknown;
	setCellValue(rowId: string, colField: string, value: unknown): void;
	getCellState(rowId: string, colField: string): CellState;
	selectCell(pointer: GridCellPointer | null, source?: GridSelectionSource): void;
	selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource): void;
	extendSelection(end: GridCellPointer, source?: GridSelectionSource): void;
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
	toggleGroupExpanded(groupId: string): void;
	toggleDetailExpanded(rowId: string): void;
	isGroupExpanded(groupId: string): boolean;
	isDetailExpanded(rowId: string): boolean;
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualRowIndexById(id: string): number | null;
	getVisualIndexById(visualRowId: string): number | null;
	getVisualIndexByRowId(rowId: string): number | null;
	getRowNodeById(rowId: string): RowNode<TRowData> | null;
	getRawRowById(rowId: string): TRowData | null;
	rows(): GridRowsAccessor<TRowData>;
	addEventListener<T = unknown>(type: string, callback: GridEventListener<T>): () => void;
	dispatchEvent<T = unknown>(type: string, payload: T): void;
	startEditing(rowId: string, colField: string): void;
	stopEditing(cancel?: boolean): void;
	subscribe(listener: Listener<TRowData>): () => void;
	subscribeToKey(key: string, listener: Listener<TRowData>): () => void;
	subscribeToViewport(listener: Listener<TRowData>): () => void;
	subscribeToSelection(listener: Listener<TRowData>): () => void;
	subscribeToFocusedCell(listener: Listener<TRowData>): () => void;
	subscribeToEditingCell(listener: Listener<TRowData>): () => void;
	subscribeToCell(rowId: string, colField: string, listener: () => void): () => void;
	subscribeToRow(rowId: string, listener: Listener<TRowData>): () => void;
	subscribeToColumn(colField: string, listener: Listener<TRowData>): () => void;
	subscribeToHeaders(listener: Listener<TRowData>): () => void;
	getColumnIndex(colField: string): number;
	getColumnField(colIndex: number): string | null;
	getColumnDef(colField: string): ColumnDef<TRowData> | undefined;
	getCellAccess(rowId: string, colField: string): GridCellAccess<TRowData> | null;
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	destroy(): void;
}

/**
 * Internal API intended for the rendering engine, plugins, and custom framework adapters.
 */
export interface InternalGridApi<TRowData = unknown> extends GridApi<TRowData> {
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
		this.engine = new GridEngine<TRowData>({
			columns: initialState.columns || [],
			selection: initialState.selection,
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
			expansion: initialState.expansion,
		});

		this.viewportController = new ViewportController<TRowData>(this.engine);

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

	public setStyleSlots = (styleSlots: GridStyleSlots<TRowData> | undefined): void => {
		this.engine.setStyleSlots(styleSlots);
	};

	public toggleGroupExpanded = (groupId: string): void => {
		this.getRowModel()?.toggleGroupExpanded?.(groupId);
	};

	public toggleDetailExpanded = (rowId: string): void => {
		this.getRowModel()?.toggleDetailExpanded?.(rowId);
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

	public addEventListener = <T = unknown>(type: string, callback: GridEventListener<T>): (() => void) => {
		return this.engine.eventBus.addEventListener(type, callback);
	};

	public dispatchEvent = <T = unknown>(type: string, payload: T): void => {
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
		};
	};

	public setRows = (rows: TRowData[]): void => {
		this.getRowModel()?.setRows?.(rows);
	};

	public updateRows = (updater: (rows: TRowData[]) => TRowData[]): void => {
		this.getRowModel()?.updateRows?.(updater);
	};

	public refreshRows = (): void => {
		this.getRowModel()?.refresh();
	};

	public setRowHeights = (rowHeights: Record<string, number> | undefined): void => {
		this.engine.stateManager.setState({ rowHeights });
	};

	public setDefaultRowHeight = (defaultRowHeight?: number | undefined): void => {
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
		const unsubscribeEvent = this.addEventListener<{ rowId: string }>('rowResized', (event) => {
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
		const unsubscribeEvent = this.addEventListener<{ colField: string }>('columnResized', (event) => {
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
