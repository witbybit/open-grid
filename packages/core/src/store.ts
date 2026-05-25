import type { FilterModel, SortModel } from './rowModel.js';
import { PriorityLane, TransactionScheduler } from './scheduler.js';
import { ViewportController, ViewportRange } from './viewportController.js';
import { DagEngine } from './calculations/dagEngine.js';
import { GridEngine } from './engine/GridEngine.js';

export interface CellSubscription {
	rowId: string;
	colField: string;
	onStoreChange: () => void;
}

export interface GridCellPointer {
	rowId: string;
	colField: string;
}

export interface GridPlugin<TRowData = unknown> {
	readonly name: string;
	onInit?(api: InternalGridApi<TRowData>): void;
	onMount?(): void;
	onDestroy?(): void;
	onCommand?(command: any): void;
	onViewportChange?(range: ViewportRange): void;
	onBeforeRender?(): void;
	onAfterRender?(): void;
	getApiMethods?(): Record<string, Function>;
}

export interface GridCellRange {
	start: GridCellPointer;
	end: GridCellPointer;
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

export class RowNode<TRowData = any> {
	public id!: string;
	public data!: TRowData;
	public selected: boolean = false;
	public expanded: boolean = false;

	// Tracks current structural UI cell data states to prevent recalculations
	private cellValueCache = new Map<string, any>();

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

	public getCellValue(colField: string, compiledGetter: (data: TRowData) => any): any {
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

export interface ValueGetterParams<TRowData = unknown> {
	node: RowNode<TRowData>;
	row: TRowData;
	colField: string;
}

export interface CellRendererProps<TRowData = unknown> {
	value: unknown;
	computedValue: unknown;
	row: TRowData;
	rowId: string;
	colField: string;
	api: InternalGridApi<TRowData>;
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
	api: InternalGridApi<TRowData>;
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

const pathGetterCache = new Map<string, (data: any) => any>();

export function compilePathGetter(path: string): (data: any) => any {
	if (!path) return () => undefined;
	if (pathGetterCache.has(path)) return pathGetterCache.get(path)!;

	let getter: (data: any) => any;
	if (!path.includes('.')) {
		getter = (data: any) => (data ? data[path] : undefined);
	} else {
		const parts = path.split('.');
		getter = (data: any) => {
			let curr = data;
			for (let i = 0; i < parts.length; i++) {
				if (curr === null || curr === undefined) return undefined;
				curr = curr[parts[i]];
			}
			return curr;
		};
	}
	pathGetterCache.set(path, getter);
	return getter;
}

export interface RowModel<TRowData = unknown> {
	getRow(index: number): TRowData | null;
	getRowNode(index: number): RowNode<TRowData> | null;
	getRowCount(): number;
	getRowIndexById(rowId: string): number;
	getRowNodeById?(rowId: string): RowNode<TRowData> | null;
	setCellValue?(rowId: string, colField: string, value: unknown): boolean;
	loadVisibleBlocks?(visibleRowIndices: number[]): void;
}

export interface ColumnDef<TRowData = unknown> {
	field: string;
	header: string;
	width?: number;
	loading?: boolean;
	valueGetter?: (params: ValueGetterParams<TRowData>) => unknown;
	valueSetter?: (row: TRowData, value: unknown) => boolean;
	cellRenderer?: (props: CellRendererProps<TRowData>) => unknown;
	cellEditor?: (props: CellEditorProps<TRowData>) => unknown;
}

export interface GridStyleSlots<TRowData = any> {
	rowClass?: (row: TRowData) => string;
	cellClass?: (col: ColumnDef<TRowData>, row: TRowData) => string;
	headerCellClass?: (col: ColumnDef<TRowData>) => string;
}

export interface GridState<TRowData = unknown> {
	getRowId?: (row: TRowData) => string;
	columns: ColumnDef<TRowData>[];
	loading?: boolean;
	loadingSkeletonCount?: number;

	focusedCell: GridCellPointer | null;
	selectedRange: GridCellRange | null;

	rowHeights: Record<string, number>; // rowId -> height in px
	columnWidths: Record<string, number>; // colField -> width in px
	defaultRowHeight: number;
	defaultColWidth: number;

	// Active edit state registers
	activeEdit: GridCellPointer | null;

	// Sorting & Filtering State
	sortModel: SortModel | null;
	filterModel: FilterModel | null;

	// React cache invalidator
	dataVersion: number;

	selectedRangeBounds: GridCellRangeBounds | null;

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

/**
 * Public, pristine API intended for application developers.
 */
export interface GridApi<TRowData = unknown> {
	getState(): GridState<TRowData>;
	setState(updater: GridStateUpdater<TRowData>): void;
	getRowId(row: TRowData): string;
	isRowLoading(rowId: string): boolean;
	getCellValue(rowId: string, colField: string): unknown;
	setCellValue(rowId: string, colField: string, value: unknown): void;
	getCellState(rowId: string, colField: string): CellState;
	setFocusedCell(rowId: string | null, colField: string | null): void;
	setSelectedRange(start: GridCellPointer | null, end: GridCellPointer | null): void;
	setColumnWidth(colField: string, width: number): void;
	setRowHeight(rowId: string, height: number): void;
	setSortModel(sortModel: SortModel | null): void;
	setFilterModel(filterModel: FilterModel | null): void;
	addEventListener<T = unknown>(type: string, callback: GridEventListener<T>): () => void;
	dispatchEvent<T = unknown>(type: string, payload: T): void;
	stopEditing(cancel?: boolean): void;
	startTransaction(): void;
	endTransaction(): void;
	subscribe(listener: Listener<TRowData>): () => void;
	subscribeToKey(key: string, listener: Listener<TRowData>): () => void;
	getColumnIndex(colField: string): number;
	getColumnDef(colField: string): ColumnDef<TRowData> | undefined;
	getPlugin<T = unknown>(name: string): T | null;
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	fillRange(source: GridCellRange, target: GridCellRange): void;
	destroy(): void;
}

/**
 * Internal API intended for the rendering engine, plugins, and custom framework adapters.
 */
export interface InternalGridApi<TRowData = unknown> extends GridApi<TRowData> {
	registerRowModel(rowModel: RowModel<TRowData>): void;
	getRowModel(): RowModel<TRowData> | null;
	registerPlugin(plugin: GridPlugin<TRowData>): void;
	triggerCellNotifications(rowId: string): void;
	viewportController: ViewportController;
	batch(callback: () => void): void;
	batchedUpdates: boolean;
	registerCellSubscription(sub: CellSubscription): void;
	unregisterCellSubscription(sub: CellSubscription): void;
	updateCellSubscription(sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void;
	flushCellUpdatesSync(): void;
}

export class GridStore<TRowData = unknown> implements InternalGridApi<TRowData> {
	public scheduler: TransactionScheduler;
	public viewportController: ViewportController;
	public dagEngine: DagEngine;
	public engine: GridEngine<TRowData>;

	private plugins = new Map<string, GridPlugin<TRowData>>();

	constructor(initialState: Partial<GridState<TRowData>> = {}) {
		this.engine = new GridEngine<TRowData>({
			columns: initialState.columns || [],
			focusedCell: initialState.focusedCell || null,
			selectedRange: initialState.selectedRange || null,
			rowHeights: initialState.rowHeights || {},
			columnWidths: initialState.columnWidths || {},
			defaultRowHeight: initialState.defaultRowHeight || 40,
			defaultColWidth: initialState.defaultColWidth || 100,
			activeEdit: initialState.activeEdit || null,
			sortModel: initialState.sortModel || null,
			filterModel: initialState.filterModel || null,
			getRowId: initialState.getRowId,
			loadingSkeletonCount: initialState.loadingSkeletonCount,
		});

		this.scheduler = new TransactionScheduler();
		this.viewportController = new ViewportController(this.engine);
		this.dagEngine = this.engine.dagEngine;

		// Notify plugins of viewport shifts
		this.engine.stateManager.subscribeToKey('visibleRowRange', () => {
			const range = this.state.visibleRowRange;
			this.plugins.forEach((plugin) => {
				if (plugin.onViewportChange) plugin.onViewportChange(range);
			});
		});

		// Notify plugins of commands
		this.engine.commandBus.registerGlobalHandler((command) => {
			this.plugins.forEach((plugin) => {
				if (plugin.onCommand) plugin.onCommand(command);
			});
		});

		// Notify plugins of render phases
		this.engine.eventBus.addEventListener('beforeRender', () => {
			this.plugins.forEach((plugin) => {
				if (plugin.onBeforeRender) plugin.onBeforeRender();
			});
		});
		
		this.engine.eventBus.addEventListener('afterRender', () => {
			this.plugins.forEach((plugin) => {
				if (plugin.onAfterRender) plugin.onAfterRender();
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
		this.engine.commandBus.dispatch({
			type: 'SET_CELL_VALUE',
			payload: { rowId, colField, value, undoable: true },
		});
	};

	public getCellState = (rowId: string, colField: string): CellState => {
		const computedValue = this.getCellValue(rowId, colField);
		const isEditing = this.state.activeEdit?.rowId === rowId && this.state.activeEdit?.colField === colField;

		let value = computedValue;
		if (this.engine.dagEngine.hasFormula(rowId, colField)) {
			value = this.engine.dagEngine.getFormula(rowId, colField);
		} else {
			value = this.engine.data.getRawCellValue(rowId, colField);
		}

		return {
			value,
			computedValue,
			isEditing,
		};
	};

	public setFocusedCell = (rowId: string | null, colField: string | null): void => {
		this.engine.commandBus.dispatch({
			type: 'FOCUS_CELL',
			payload: { rowId, colField },
		});
	};

	public setSelectedRange = (start: GridCellPointer | null, end: GridCellPointer | null): void => {
		this.engine.commandBus.dispatch({
			type: 'SELECT_CELL',
			payload: { start, end },
		});
	};

	public setColumnWidth = (colField: string, width: number): void => {
		this.engine.commandBus.dispatch({
			type: 'SET_COLUMN_WIDTH',
			payload: { colField, width },
		});
	};

	public setRowHeight = (rowId: string, height: number): void => {
		this.engine.commandBus.dispatch({
			type: 'SET_ROW_HEIGHT',
			payload: { rowId, height },
		});
	};

	public setSortModel = (sortModel: SortModel | null): void => {
		this.engine.commandBus.dispatch({
			type: 'SET_SORT_MODEL',
			payload: { sortModel },
		});
	};

	public setFilterModel = (filterModel: FilterModel | null): void => {
		this.engine.commandBus.dispatch({
			type: 'SET_FILTER_MODEL',
			payload: { filterModel },
		});
	};

	public addEventListener = <T = unknown>(type: string, callback: GridEventListener<T>): (() => void) => {
		return this.engine.eventBus.addEventListener(type, callback);
	};

	public dispatchEvent = <T = unknown>(type: string, payload: T): void => {
		this.engine.eventBus.dispatchEvent(type, payload);
	};

	public stopEditing = (cancel: boolean = false): void => {
		this.engine.commandBus.dispatch({
			type: 'STOP_EDIT',
			payload: { cancel },
		});
	};

	public startTransaction = (): void => {
		this.engine.stateManager.startTransaction();
	};

	public endTransaction = (): void => {
		this.engine.stateManager.endTransaction();
	};

	public registerRowModel = (rowModel: RowModel<TRowData>): void => {
		this.engine.registerRowModel(rowModel);
	};

	public getRowModel = (): RowModel<TRowData> | null => {
		return this.engine.getRowModel();
	};

	public subscribe = (listener: Listener<TRowData>): (() => void) => {
		return this.engine.stateManager.subscribe(listener);
	};

	public subscribeToKey = (key: string, listener: Listener<TRowData>): (() => void) => {
		return this.engine.stateManager.subscribeToKey(key, listener);
	};

	public triggerCellNotifications = (rowId: string): void => {
		for (const col of this.state.columns) {
			this.engine.notifyCellChange(rowId, col.field);
		}
	};

	public getColumnIndex = (colField: string): number => {
		return this.engine.columns.getColumnIndex(colField);
	};

	public getColumnDef = (colField: string): ColumnDef<TRowData> | undefined => {
		return this.engine.columns.getColumnDef(colField);
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
			const existing = this.plugins.get(plugin.name);
			if (existing?.onDestroy) {
				try {
					existing.onDestroy();
				} catch (e) {
					console.error(e);
				}
			}
		}
		this.plugins.set(plugin.name, plugin);
		(this as unknown as Record<string, unknown>)[plugin.name] = plugin;
		
		if (plugin.onInit) {
			plugin.onInit(this);
		}

		if (plugin.getApiMethods) {
			const methods = plugin.getApiMethods();
			for (const [methodName, fn] of Object.entries(methods)) {
				(this as unknown as Record<string, unknown>)[methodName] = fn.bind(plugin);
			}
		}
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

	public fillRange = (source: GridCellRange, target: GridCellRange): void => {
		this.engine.fillRange(source, target);
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
		this.scheduler.flushAllSync();
	};
}
