import type { FilterModel, SortModel } from './rowModel.js';
import { PriorityLane, TransactionScheduler } from './scheduler.js';
import { ColumnController } from './columnController.js';
import { RowController } from './rowController.js';
import { FocusController } from './focusController.js';
import { SelectionController } from './selectionController.js';
import { ViewportController, ViewportRange } from './viewportController.js';
import { DagEngine } from './calculations/dagEngine.js';

export interface CellSubscription {
	rowId: string;
	colField: string;
	onStoreChange: () => void;
}

export interface GridCellPointer {
	rowId: string;
	colField: string;
}

export interface GridFeature<TRowData = unknown> {
	readonly name: string;
	init(api: GridApi<TRowData>): void;
	destroy?(): void;
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
	public rowIndex: number = -1; // Current visible index position
	public rowTop: number = 0; // Computed absolute vertical pixel coordinate
	public rowHeight: number = 40; // Explicit height tracker
	public selected: boolean = false;
	public expanded: boolean = false;

	// Tracks current structural UI cell data states to prevent recalculations
	private cellValueCache = new Map<string, any>();

	constructor(id: string, data: TRowData) {
		this.id = id;
		this.data = data;
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

export function compilePathGetter(path: string): (data: any) => any {
	if (!path) return () => undefined;
	if (!path.includes('.')) {
		return (data: any) => (data ? data[path] : undefined);
	}
	const parts = path.split('.');
	return (data: any) => {
		let curr = data;
		for (let i = 0; i < parts.length; i++) {
			if (curr === null || curr === undefined) return undefined;
			curr = curr[parts[i]];
		}
		return curr;
	};
}

export interface RowModel<TRowData = unknown> {
	getRow(index: number): TRowData | null;
	getRowNode(index: number): RowNode<TRowData> | null;
	getRowCount(): number;
	getRowIndexById(rowId: string): number;
	getRowNodeById?(rowId: string): RowNode<TRowData> | null;
	setCellValue?(rowId: string, colField: string, value: unknown): void;
	loadVisibleBlocks?(visibleRowIndices: number[]): void;
}

export interface ColumnDef<TRowData = unknown> {
	field: string;
	header: string;
	width?: number;
	valueGetter?: (params: ValueGetterParams<TRowData>) => unknown;
	valueSetter?: (row: TRowData, value: unknown) => boolean;
	cellRenderer?: (props: CellRendererProps<TRowData>) => unknown;
	cellEditor?: (props: CellEditorProps<TRowData>) => unknown;
}

export interface GridState<TRowData = unknown> {
	getRowId?: (row: TRowData) => string;
	columns: ColumnDef<TRowData>[];

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
}

export interface GridCellRangeBounds {
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}

export type GridStateUpdater<TRowData = unknown> = Partial<GridState<TRowData>> | ((state: GridState<TRowData>) => Partial<GridState<TRowData>>);

export type Listener<TRowData = unknown> = (state: GridState<TRowData>) => void;

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
	registerRowModel(rowModel: RowModel<TRowData>): void;
	getRowModel(): RowModel<TRowData> | null;
	registerFeature(feature: GridFeature<TRowData>): void;
	getFeature<T = unknown>(name: string): T | null;
	subscribe(listener: Listener<TRowData>): () => void;
	subscribeToKey(key: string, listener: Listener<TRowData>): () => void;
	triggerCellNotifications(rowId: string): void;
	getColumnIndex(colField: string): number;
	getColumnDef(colField: string): ColumnDef<TRowData> | undefined;
	viewportController: ViewportController;
	batch(callback: () => void): void;
	batchedUpdates: boolean;
	registerCellSubscription(sub: CellSubscription): void;
	unregisterCellSubscription(sub: CellSubscription): void;
	updateCellSubscription(sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void;
	destroy(): void;
}

export class GridStore<TRowData = unknown> implements GridApi<TRowData> {
	private state: GridState<TRowData>;
	private autoRowIdMap = new WeakMap<any, string>();
	private autoRowIdCounter = 0;
	private listeners = new Set<Listener<TRowData>>();
	private keyListeners = new Map<string, Set<Listener<TRowData>>>();
	private eventListeners = new Map<string, Set<GridEventListener<unknown>>>();
	private features = new Map<string, GridFeature<TRowData>>();

	private compiledGetters = new Map<string, (data: TRowData) => any>();
	private isBatching = false;
	private batchedStateUpdates: Partial<GridState<TRowData>> = {};
	private preTransactionState: GridState<TRowData> | null = null;

	// Cell update batching for improved performance during bulk operations
	private cellUpdateBatch = new Set<string>();
	private batchFlushScheduled = false;
	private _batchedUpdates = true; // Always on — library manages batching internally

	/**
	 * Creates a serialized coordinate batch key from rowId and colField.
	 */
	private createBatchKey(rowId: string, colField: string): string {
		return `${rowId}:${colField}`;
	}

	/**
	 * Splits a serialized coordinate batch key into its constituent rowId and colField.
	 */
	private splitBatchKey(key: string): [string, string] {
		const colonIdx = key.indexOf(':');
		if (colonIdx === -1) {
			return [key, ''];
		}
		return [key.substring(0, colonIdx), key.substring(colonIdx + 1)];
	}

	// Core specialized controllers & scheduler
	public columnController: ColumnController<TRowData>;
	public rowController: RowController<TRowData>;
	public focusController: FocusController;
	public selectionController: SelectionController;
	public scheduler: TransactionScheduler;
	public viewportController: ViewportController;
	public dagEngine: DagEngine;

	// DMSR: Dynamic Multiplexed Subscription Registry
	private cellSubscriptions = new Map<string, Set<CellSubscription>>();
	private colSubscriptions = new Map<string, Set<CellSubscription>>();

	constructor(initialState: Partial<GridState<TRowData>> = {}) {
		this.state = {
			columns: [],
			focusedCell: null,
			selectedRange: null,
			rowHeights: {},
			columnWidths: {},
			defaultRowHeight: 40,
			defaultColWidth: 100,
			activeEdit: null,
			sortModel: null,
			filterModel: null,
			dataVersion: 0,
			selectedRangeBounds: null,
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			...initialState,
		};

		// Initialize specialized controller layers
		this.columnController = new ColumnController<TRowData>(this.state.defaultColWidth);
		this.rowController = new RowController<TRowData>(this.state.defaultRowHeight);
		this.focusController = new FocusController();
		this.selectionController = new SelectionController();
		this.scheduler = new TransactionScheduler();
		this.viewportController = new ViewportController();
		this.dagEngine = new DagEngine();

		this.columnController.updateColumns(this.state.columns, this.state.columnWidths, this.state.defaultColWidth);
		this.rowController.refreshRowGeometry(this.state.rowHeights, this.state.defaultRowHeight);

		if (this.state.columns) {
			this.updateCompiledGetters(this.state.columns);
		}

		// Compute initial visible ranges based on initial layout geometry
		this.state.visibleRowRange = this.viewportController.getVisibleRowRange(this.rowController);
		this.state.visibleColRange = this.viewportController.getVisibleColumnRange(this.columnController);
	}

	private updateCompiledGetters(columns: ColumnDef<TRowData>[]): void {
		this.compiledGetters.clear();
		for (let i = 0; i < columns.length; i++) {
			const col = columns[i];
			if (col.field) {
				this.compiledGetters.set(col.field, compilePathGetter(col.field));
			}
		}
	}

	private notifyCellChange(rowId: string, colField: string): void {
		// DMSR: Notify targeted cell subscriptions
		const cellKey = `${rowId}:${colField}`;
		const cellSubs = this.cellSubscriptions.get(cellKey);
		if (cellSubs) {
			cellSubs.forEach(sub => {
				try {
					sub.onStoreChange();
				} catch(e) {
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
		// Remove from old cell key
		const oldCellKey = `${oldRowId}:${oldColField}`;
		const oldCellSet = this.cellSubscriptions.get(oldCellKey);
		if (oldCellSet) {
			oldCellSet.delete(sub);
			if (oldCellSet.size === 0) {
				this.cellSubscriptions.delete(oldCellKey);
			}
		}

		// Add to new cell key
		const newCellKey = `${newRowId}:${newColField}`;
		if (!this.cellSubscriptions.has(newCellKey)) {
			this.cellSubscriptions.set(newCellKey, new Set());
		}
		this.cellSubscriptions.get(newCellKey)!.add(sub);

		// If column changed, update column subscriptions
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

	public registerRowModel = (rowModel: RowModel<TRowData>): void => {
		this.rowController.registerRowModel(rowModel);
		this.rowController.refreshRowGeometry(this.state.rowHeights, this.state.defaultRowHeight);
		this.setState({ dataVersion: this.state.dataVersion + 1 });
	};

	public getRowModel = (): RowModel<TRowData> | null => {
		return this.rowController.getRowModel();
	};

	public getState = (): GridState<TRowData> => {
		return this.state;
	};

	public getRowId = (row: TRowData): string => {
		if (this.state.getRowId) {
			return this.state.getRowId(row);
		}
		if (typeof row === 'object' && row !== null) {
			const anyRow = row as any;
			if (anyRow.id !== undefined && anyRow.id !== null) {
				return String(anyRow.id);
			}
			let id = this.autoRowIdMap.get(row);
			if (id === undefined) {
				id = `__row_${this.autoRowIdCounter++}__`;
				this.autoRowIdMap.set(row, id);
			}
			return id;
		}
		return String(row);
	};

	public isRowLoading = (rowId: string): boolean => {
		return rowId.startsWith('__loading_');
	};

	private getCellsInRange(range: GridCellRange | null): Set<string> {
		const cells = new Set<string>();
		const rowModel = this.getRowModel();
		if (!range || !rowModel) return cells;

		const startIdx = rowModel.getRowIndexById(range.start.rowId);
		const endIdx = rowModel.getRowIndexById(range.end.rowId);
		if (startIdx === -1 || endIdx === -1) return cells;

		const startColIdx = this.getColumnIndex(range.start.colField);
		const endColIdx = this.getColumnIndex(range.end.colField);
		if (startColIdx === -1 || endColIdx === -1) return cells;

		const minRow = Math.min(startIdx, endIdx);
		const maxRow = Math.max(startIdx, endIdx);
		const minCol = Math.min(startColIdx, endColIdx);
		const maxCol = Math.max(startColIdx, endColIdx);

		for (let r = minRow; r <= maxRow; r++) {
			const row = rowModel.getRow(r);
			if (!row) continue;
			const rowId = this.getRowId(row);
			for (let c = minCol; c <= maxCol; c++) {
				const colField = this.state.columns[c].field;
				cells.add(`${rowId}:${colField}`);
			}
		}
		return cells;
	}

	private calculateRangeBounds(range: GridCellRange | null | undefined): GridCellRangeBounds | null {
		const rowModel = this.getRowModel();
		if (!range || !rowModel) return null;
		return this.selectionController.calculateRangeBounds(
			range,
			(id) => rowModel.getRowIndexById(id),
			(field) => this.getColumnIndex(field)
		);
	}

	/**
	 * Update the store state, rebuilding float matrices and scheduling notifications.
	 */
	public setState = (updater: GridStateUpdater<TRowData>): void => {
		const nextState = typeof updater === 'function' ? updater(this.state) : updater;

		if (this.isBatching) {
			this.batchedStateUpdates = { ...this.batchedStateUpdates, ...nextState };
			this.state = { ...this.state, ...nextState };

			if (nextState.columns !== undefined || nextState.columnWidths !== undefined || nextState.defaultColWidth !== undefined) {
				this.columnController.updateColumns(this.state.columns, this.state.columnWidths, this.state.defaultColWidth);
				this.updateCompiledGetters(this.state.columns);
			}

			const rowModel = this.getRowModel();
			if (rowModel && (nextState.rowHeights !== undefined || nextState.defaultRowHeight !== undefined || nextState.dataVersion !== undefined)) {
				this.rowController.refreshRowGeometry(this.state.rowHeights, this.state.defaultRowHeight);
			}

			if (nextState.selectedRange !== undefined || nextState.columns !== undefined || nextState.dataVersion !== undefined) {
				this.state.selectedRangeBounds = this.calculateRangeBounds(this.state.selectedRange);
			}

			const needsRangeUpdate =
				nextState.columns !== undefined ||
				nextState.columnWidths !== undefined ||
				nextState.rowHeights !== undefined ||
				nextState.dataVersion !== undefined ||
				nextState.defaultRowHeight !== undefined ||
				nextState.defaultColWidth !== undefined;

			if (needsRangeUpdate) {
				this.state.visibleRowRange = this.viewportController.getVisibleRowRange(this.rowController);
				this.state.visibleColRange = this.viewportController.getVisibleColumnRange(this.columnController);
			}

			return;
		}

		const prevState = this.state;
		this.state = { ...prevState, ...nextState };

		if (nextState.columns !== undefined || nextState.columnWidths !== undefined || nextState.defaultColWidth !== undefined) {
			this.columnController.updateColumns(this.state.columns, this.state.columnWidths, this.state.defaultColWidth);
			this.updateCompiledGetters(this.state.columns);
		}

		const rowModel = this.getRowModel();
		if (rowModel && (nextState.rowHeights !== undefined || nextState.defaultRowHeight !== undefined || nextState.dataVersion !== undefined)) {
			this.rowController.refreshRowGeometry(this.state.rowHeights, this.state.defaultRowHeight);
		}

		if (nextState.selectedRange !== undefined || nextState.columns !== undefined || nextState.dataVersion !== undefined) {
			this.state.selectedRangeBounds = this.calculateRangeBounds(
				nextState.selectedRange !== undefined ? nextState.selectedRange : prevState.selectedRange
			);
		}

		// Delegate focusedCell and selectedRange syncs to their controllers
		if (nextState.focusedCell !== undefined) {
			if (this.state.focusedCell) {
				this.focusController.setFocusedCell(this.state.focusedCell.rowId, this.state.focusedCell.colField);
			} else {
				this.focusController.setFocusedCell(null, null);
			}
		}
		if (nextState.selectedRange !== undefined) {
			this.selectionController.setSelectedRange(this.state.selectedRange, this.state.selectedRangeBounds);
		}

		// Re-calculate visible ranges if relevant geometry/data properties changed
		const needsRangeUpdate =
			nextState.columns !== undefined ||
			nextState.columnWidths !== undefined ||
			nextState.rowHeights !== undefined ||
			nextState.dataVersion !== undefined ||
			nextState.defaultRowHeight !== undefined ||
			nextState.defaultColWidth !== undefined;

		const affectedKeysList = Object.keys(nextState);
		if (needsRangeUpdate) {
			const nextRowRange = this.viewportController.getVisibleRowRange(this.rowController);
			const nextColRange = this.viewportController.getVisibleColumnRange(this.columnController);

			const rowRangeChanged =
				!prevState.visibleRowRange ||
				prevState.visibleRowRange.startIdx !== nextRowRange.startIdx ||
				prevState.visibleRowRange.endIdx !== nextRowRange.endIdx;
			const colRangeChanged =
				!prevState.visibleColRange ||
				prevState.visibleColRange.startIdx !== nextColRange.startIdx ||
				prevState.visibleColRange.endIdx !== nextColRange.endIdx;

			if (rowRangeChanged || colRangeChanged) {
				this.state.visibleRowRange = nextRowRange;
				this.state.visibleColRange = nextColRange;
				affectedKeysList.push('visibleRowRange', 'visibleColRange');
			}
		}

		this.notifyChanges(prevState, affectedKeysList);
	};

	private notifyChanges(prevState: GridState<TRowData>, affectedKeys: Iterable<string>): void {
		const updatedKeys = new Set<string>();
		for (const key of affectedKeys) {
			if (prevState[key as keyof GridState<TRowData>] !== this.state[key as keyof GridState<TRowData>]) {
				updatedKeys.add(key);
			}
		}

		if (updatedKeys.size === 0) return;

		// Notify global listeners
		this.listeners.forEach((listener) => {
			try {
				listener(this.state);
			} catch (e) {
				console.error('GridEngine: Error in global store listener', e);
			}
		});

		// Notify targeted key listeners
		updatedKeys.forEach((key) => {
			const targeted = this.keyListeners.get(key);
			if (targeted) {
				targeted.forEach((listener) => {
					try {
						listener(this.state);
					} catch (e) {
						console.error(`GridEngine: Error in targeted key listener for ${key}`, e);
					}
				});
			}
		});

		// Trigger targeted coordinate notifications using binary coordinates
		if (updatedKeys.has('focusedCell')) {
			const prev = prevState.focusedCell;
			const curr = this.state.focusedCell;
			if (prev) {
				this.notifyCellChange(prev.rowId, prev.colField);
			}
			if (curr) {
				this.notifyCellChange(curr.rowId, curr.colField);
			}
		}

		if (updatedKeys.has('activeEdit')) {
			const prev = prevState.activeEdit;
			const curr = this.state.activeEdit;
			if (prev) {
				this.notifyCellChange(prev.rowId, prev.colField);
			}
			if (curr) {
				this.notifyCellChange(curr.rowId, curr.colField);
			}
		}

		if (updatedKeys.has('selectedRange')) {
			// Utilize SelectionController's numeric symmetric difference invalidator
			const dirty = this.selectionController.getDirtyCoordinates(prevState.selectedRangeBounds, this.state.selectedRangeBounds);
			const rowModel = this.getRowModel();
			if (dirty.length > 0 && rowModel) {
				for (let i = 0; i < dirty.length; i++) {
					const { rowIdx, colIdx } = dirty[i];
					const row = rowModel.getRow(rowIdx);
					const col = this.state.columns[colIdx];
					if (row && col) {
						const rowId = this.getRowId(row);
						this.notifyCellChange(rowId, col.field);
					}
				}
			}
		}

		if (updatedKeys.has('columnWidths')) {
			const prevWidths = prevState.columnWidths;
			const currWidths = this.state.columnWidths;
			const allCols = new Set([...Object.keys(prevWidths), ...Object.keys(currWidths)]);
			allCols.forEach((colField) => {
				if (prevWidths[colField] !== currWidths[colField]) {
					const listeners = this.keyListeners.get(`colWidth:${colField}`);
					if (listeners) listeners.forEach((l) => l(this.state));

					// DMSR: Notify column width subscriptions
					const colSubs = this.colSubscriptions.get(colField);
					if (colSubs) {
						colSubs.forEach(sub => {
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

		// DMSR: If dataVersion changed, notify ALL active cell subscriptions
		if (updatedKeys.has('dataVersion')) {
			this.cellSubscriptions.forEach(subs => {
				subs.forEach(sub => {
					try {
						sub.onStoreChange();
					} catch (e) {
						console.error(`GridEngine: Error in DMSR dataVersion notification`, e);
					}
				});
			});
		}

		// Auto-dispatch structured core events
		if (updatedKeys.has('focusedCell')) {
			this.dispatchEvent('focusChanged', { focusedCell: this.state.focusedCell });
		}
		if (updatedKeys.has('selectedRange')) {
			this.dispatchEvent('selectionChanged', { selectedRange: this.state.selectedRange });
		}
		if (updatedKeys.has('sortModel')) {
			this.dispatchEvent('sortChanged', { sortModel: this.state.sortModel });
		}
		if (updatedKeys.has('filterModel')) {
			this.dispatchEvent('filterChanged', { filterModel: this.state.filterModel });
		}
	}

	/**
	 * Subscribe globally to any state change.
	 */
	public subscribe = (listener: Listener<TRowData>): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/**
	 * Subscribe targeted listeners to standard string keys.
	 */
	public subscribeToKey = (key: string, listener: Listener<TRowData>): (() => void) => {
		if (!this.keyListeners.has(key)) {
			this.keyListeners.set(key, new Set());
		}

		const set = this.keyListeners.get(key)!;
		set.add(listener);

		return () => {
			set.delete(listener);
			if (set.size === 0) {
				this.keyListeners.delete(key);
			}
		};
	};

	/**
	 * Extensible Event System Methods
	 */
	public addEventListener = <T = unknown>(type: string, callback: GridEventListener<T>): (() => void) => {
		if (!this.eventListeners.has(type)) {
			this.eventListeners.set(type, new Set());
		}
		const set = this.eventListeners.get(type)!;
		set.add(callback as GridEventListener<unknown>);
		return () => {
			set.delete(callback as GridEventListener<unknown>);
			if (set.size === 0) {
				this.eventListeners.delete(type);
			}
		};
	};

	public dispatchEvent = <T = unknown>(type: string, payload: T): void => {
		const set = this.eventListeners.get(type);
		if (set) {
			const event: GridEvent<T> = { type, payload };
			set.forEach((listener) => {
				try {
					listener(event);
				} catch (e) {
					console.error(`GridEngine: Error in event listener for "${type}"`, e);
				}
			});
		}
	};

	/**
	 * Helper to get value of a single cell.
	 */
	public getCellValue = (rowId: string, colField: string): unknown => {
		const getRawValue = (rId: string, cField: string): any => {
			const rowModel = this.getRowModel();
			if (!rowModel) return '';
			const col = this.getColumnDef(cField);
			if (!col) return '';

			const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rId) : null;
			if (!node) {
				const idx = rowModel.getRowIndexById(rId);
				if (idx === -1) return '';
				const row = rowModel.getRow(idx);
				if (!row) return '';
				if (col.valueGetter) {
					const dummyNode = new RowNode<TRowData>(rId, row);
					return col.valueGetter({ node: dummyNode, row, colField: cField });
				}
				const getter = this.compiledGetters.get(cField) || compilePathGetter(cField);
				return getter(row);
			}

			if (col.valueGetter) {
				return col.valueGetter({ node, row: node.data, colField: cField });
			}
			const getter = this.compiledGetters.get(cField) || compilePathGetter(cField);
			return node.getCellValue(cField, getter);
		};

		// Check if the raw value itself is a formula starting with '='
		const rawVal = getRawValue(rowId, colField);
		if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
			if (!this.dagEngine.hasFormula(rowId, colField) || this.dagEngine.getFormula(rowId, colField) !== rawVal) {
				this.dagEngine.registerFormula(rowId, colField, rawVal);
			}
		}

		if (this.dagEngine.hasFormula(rowId, colField)) {
			return this.dagEngine.getCellValue(rowId, colField, getRawValue);
		}

		return rawVal;
	};

	/**
	 * Helper to set value of a single cell and trigger cellValueChanged.
	 * Uses batched notifications for improved performance during bulk updates.
	 */
	public setCellValue = (rowId: string, colField: string, value: unknown): void => {
		const oldValue = this.getCellValue(rowId, colField);
		if (oldValue === value) return;

		if (typeof value === 'string' && value.startsWith('=')) {
			this.dagEngine.registerFormula(rowId, colField, value);
		} else {
			this.dagEngine.clearFormula(rowId, colField);
		}

		const rowModel = this.getRowModel();
		if (rowModel?.setCellValue) {
			rowModel.setCellValue(rowId, colField, value);
		}

		// Invalidate this cell and all its dependents in the DAG engine,
		// and collect all invalidated cell keys so we can notify their subscribers.
		const invalidatedKeys = this.dagEngine.invalidateCell(rowId, colField);

		// Also invalidate any dynamic valueGetter columns on this same row
		for (let i = 0; i < this.state.columns.length; i++) {
			const col = this.state.columns[i];
			if (col.valueGetter) {
				const key = this.createBatchKey(rowId, col.field);
				if (!invalidatedKeys.includes(key)) {
					invalidatedKeys.push(key);
				}
			}
		}

		if (this._batchedUpdates) {
			// Batch cell notifications for better performance
			// Add all affected (invalidated) cells to the batch
			for (const key of invalidatedKeys) {
				this.cellUpdateBatch.add(key);
			}

			// Schedule batched flush on next animation frame if not already scheduled
			if (!this.batchFlushScheduled) {
				this.batchFlushScheduled = true;
				if (typeof requestAnimationFrame !== 'undefined') {
					requestAnimationFrame(() => {
						this.flushCellUpdates();
					});
				} else {
					// Fallback for non-browser environments - use microtask
					Promise.resolve().then(() => {
						this.flushCellUpdates();
					});
				}
			}
		} else {
			// Immediate mode: notify synchronously (for tests or when batching is disabled)
			// Notify subscribers of all affected (invalidated) cells
			for (const key of invalidatedKeys) {
				const [rId, cField] = this.splitBatchKey(key);
				this.notifyCellChange(rId, cField);
			}
		}

		// Trigger cellValueChanged listener
		this.dispatchEvent('cellValueChanged', {
			rowId,
			colField,
			oldValue,
			newValue: value,
		});
	};

	/**
	 * Trigger coordinate-targeted cell value key listeners for all columns on a specific row.
	 */
	public triggerCellNotifications = (rowId: string): void => {
		for (const col of this.state.columns) {
			this.notifyCellChange(rowId, col.field);
		}
	};

	/**
	 * Flush batched cell updates using requestAnimationFrame for optimal performance.
	 */
	private flushCellUpdates(): void {
		this.cellUpdateBatch.forEach((key) => {
			const [rowId, colField] = this.splitBatchKey(key);
			this.notifyCellChange(rowId, colField);
		});
		this.cellUpdateBatch.clear();
		this.batchFlushScheduled = false;
	}

	/**
	 * Flush any pending batched cell updates immediately (synchronous).
	 * Useful for testing or when immediate updates are required.
	 */
	public flushCellUpdatesSync(): void {
		if (this.cellUpdateBatch.size > 0) {
			this.flushCellUpdates();
		}
	}

	/**
	 * Scoped transaction/batching API.
	 * Executes the callback within a batch transaction, collecting all cell updates
	 * and flushing them synchronously exactly once when the callback completes.
	 */
	public batch = (callback: () => void): void => {
		const prev = this._batchedUpdates;
		this._batchedUpdates = true;
		try {
			callback();
		} finally {
			this._batchedUpdates = prev;
			// Always flush synchronously on batch exit to guarantee exactly-once notification semantics
			if (this.cellUpdateBatch.size > 0) {
				this.flushCellUpdatesSync();
			}
		}
	};

	/**
	 * Getter for batched updates configuration.
	 */
	public get batchedUpdates(): boolean {
		return this._batchedUpdates;
	}

	/**
	 * Setter for batched updates configuration.
	 */
	public set batchedUpdates(enabled: boolean) {
		this._batchedUpdates = enabled;
		if (!enabled && this.cellUpdateBatch.size > 0) {
			this.flushCellUpdates();
		}
	}

	/**
	 * Stop editing on the active edit cell, committing or canceling the changes.
	 */
	public stopEditing = (cancel: boolean = false): void => {
		const activeEdit = this.state.activeEdit;
		if (!activeEdit) return;

		const { rowId, colField } = activeEdit;

		this.setState({ activeEdit: null });

		// Trigger selective cell refresh
		this.notifyCellChange(rowId, colField);

		// Dispatch 'editStopped' event
		this.dispatchEvent('editStopped', { rowId, colField, cancel });
	};

	/**
	 * Helper to get cell state safely.
	 */
	public getCellState = (rowId: string, colField: string): CellState => {
		const computedValue = this.getCellValue(rowId, colField);
		const isEditing = this.state.activeEdit?.rowId === rowId && this.state.activeEdit?.colField === colField;

		let value = computedValue;
		if (this.dagEngine.hasFormula(rowId, colField)) {
			value = this.dagEngine.getFormula(rowId, colField);
		} else {
			// Find raw value from row data if it exists
			const rowModel = this.getRowModel();
			if (rowModel) {
				const idx = rowModel.getRowIndexById(rowId);
				if (idx !== -1) {
					const row = rowModel.getRow(idx);
					if (row) {
						const col = this.getColumnDef(colField);
						if (col && !col.valueGetter) {
							const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
							value = getter(row);
						}
					}
				}
			}
		}

		return {
			value,
			computedValue,
			isEditing,
		};
	};

	/**
	 * Helper to set focused cell and trigger focusChanged.
	 */
	public setFocusedCell = (rowId: string | null, colField: string | null): void => {
		const nextFocus = rowId !== null && colField !== null ? { rowId, colField } : null;

		this.setState({
			focusedCell: nextFocus,
		});
	};

	/**
	 * Helper to set selection range and trigger selectionChanged.
	 */
	public setSelectedRange = (start: GridCellPointer | null, end: GridCellPointer | null): void => {
		const nextRange = start !== null && end !== null ? { start, end } : null;

		this.setState({
			selectedRange: nextRange,
		});
	};

	/**
	 * Helper to set column width and trigger columnResized.
	 */
	public setColumnWidth = (colField: string, width: number): void => {
		this.setState((state) => ({
			columnWidths: {
				...state.columnWidths,
				[colField]: width,
			},
		}));

		this.dispatchEvent('columnResized', {
			colField,
			width,
		});
	};

	/**
	 * Helper to set row height and trigger rowResized.
	 */
	public setRowHeight = (rowId: string, height: number): void => {
		this.setState((state) => ({
			rowHeights: {
				...state.rowHeights,
				[rowId]: height,
			},
		}));

		this.dispatchEvent('rowResized', {
			rowId,
			height,
		});
	};

	public setSortModel = (sortModel: SortModel | null): void => {
		this.setState({ sortModel });
	};

	public setFilterModel = (filterModel: FilterModel | null): void => {
		this.setState({ filterModel });
	};

	public registerFeature = (feature: GridFeature<TRowData>): void => {
		if (this.features.has(feature.name)) {
			const existing = this.features.get(feature.name);
			if (existing?.destroy) {
				try {
					existing.destroy();
				} catch (e) {
					console.error(e);
				}
			}
		}
		this.features.set(feature.name, feature);
		(this as unknown as Record<string, unknown>)[feature.name] = feature;
		feature.init(this);

		if (feature.getApiMethods) {
			const methods = feature.getApiMethods();
			for (const [methodName, fn] of Object.entries(methods)) {
				(this as unknown as Record<string, unknown>)[methodName] = fn.bind(feature);
			}
		}
	};

	public getFeature = <T = unknown>(name: string): T | null => {
		return (this.features.get(name) as unknown as T) || null;
	};

	public getColumnIndex = (colField: string): number => {
		return this.columnController.getColumnIndex(colField);
	};

	public getColumnDef = (colField: string): ColumnDef<TRowData> | undefined => {
		return this.columnController.getColumnDef(colField);
	};

	public destroy = (): void => {
		this.features.forEach((feature) => {
			if (feature.destroy) {
				try {
					feature.destroy();
				} catch (e) {
					console.error(e);
				}
			}
		});
		this.features.clear();
		this.listeners.clear();
		this.keyListeners.clear();
		this.eventListeners.clear();

		this.cellSubscriptions.clear();
		this.colSubscriptions.clear();

		// Clean up batched cell updates
		this.cellUpdateBatch.clear();
		this.batchFlushScheduled = false;

		this.scheduler.flushAllSync();
	};

	public startTransaction = (): void => {
		if (!this.isBatching) {
			this.preTransactionState = this.state;
			this.isBatching = true;
		}
	};

	public endTransaction = (): void => {
		if (!this.isBatching) return;
		this.isBatching = false;
		const preState = this.preTransactionState;
		const updates = this.batchedStateUpdates;
		this.preTransactionState = null;
		this.batchedStateUpdates = {};
		if (preState && Object.keys(updates).length > 0) {
			this.notifyChanges(preState, Object.keys(updates));
		}
	};
}
