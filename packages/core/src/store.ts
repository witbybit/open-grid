import type { FilterModel, SortModel } from './rowModel.js';

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
	public rowTop: number = 0;     // Computed absolute vertical pixel coordinate
	public rowHeight: number = 40;  // Explicit height tracker
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
	onChange: (value: unknown) => void;
	api: GridApi<TRowData>;
	onCommit: (finalValue?: unknown) => void;
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
	rowIdField: keyof TRowData & string;
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
}

export type GridStateUpdater<TRowData = unknown> = Partial<GridState<TRowData>> | ((state: GridState<TRowData>) => Partial<GridState<TRowData>>);

export type Listener<TRowData = unknown> = (state: GridState<TRowData>) => void;

export interface GridApi<TRowData = unknown> {
	getState(): GridState<TRowData>;
	setState(updater: GridStateUpdater<TRowData>): void;
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
	destroy(): void;
}

export class GridStore<TRowData = unknown> implements GridApi<TRowData> {
	private state: GridState<TRowData>;
	private listeners = new Set<Listener<TRowData>>();
	private keyListeners = new Map<string, Set<Listener<TRowData>>>();
	private eventListeners = new Map<string, Set<GridEventListener<unknown>>>();
	private rowModel: RowModel<TRowData> | null = null;
	private features = new Map<string, GridFeature<TRowData>>();

	private compiledGetters = new Map<string, (data: TRowData) => any>();
	private isBatching = false;
	private batchedStateUpdates: Partial<GridState<TRowData>> = {};
	private preTransactionState: GridState<TRowData> | null = null;

	constructor(initialState: Partial<GridState<TRowData>> = {}) {
		this.state = {
			rowIdField: 'id' as keyof TRowData & string,
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
			...initialState,
		};
		if (this.state.columns) {
			this.updateCompiledGetters(this.state.columns);
		}
	}

	private updateCompiledGetters(columns: ColumnDef<TRowData>[]): void {
		this.compiledGetters.clear();
		for (const col of columns) {
			if (col.field) {
				this.compiledGetters.set(col.field, compilePathGetter(col.field));
			}
		}
	}


	public registerRowModel = (rowModel: RowModel<TRowData>): void => {
		this.rowModel = rowModel;
		this.setState({ dataVersion: this.state.dataVersion + 1 });
	};

	public getRowModel = (): RowModel<TRowData> | null => {
		return this.rowModel;
	};

	public getState = (): GridState<TRowData> => {
		return this.state;
	};

	private getCellsInRange(range: GridCellRange | null): Set<string> {
		const cells = new Set<string>();
		if (!range || !this.rowModel) return cells;

		const startIdx = this.rowModel.getRowIndexById(range.start.rowId);
		const endIdx = this.rowModel.getRowIndexById(range.end.rowId);
		if (startIdx === -1 || endIdx === -1) return cells;

		const startColIdx = this.state.columns.findIndex((c) => c.field === range.start.colField);
		const endColIdx = this.state.columns.findIndex((c) => c.field === range.end.colField);
		if (startColIdx === -1 || endColIdx === -1) return cells;

		const minRow = Math.min(startIdx, endIdx);
		const maxRow = Math.max(startIdx, endIdx);
		const minCol = Math.min(startColIdx, endColIdx);
		const maxCol = Math.max(startColIdx, endColIdx);

		for (let r = minRow; r <= maxRow; r++) {
			const row = this.rowModel.getRow(r);
			if (!row) continue;
			const rowId = String(row[this.state.rowIdField]);
			for (let c = minCol; c <= maxCol; c++) {
				const colField = this.state.columns[c].field;
				cells.add(`${rowId}:${colField}`);
			}
		}
		return cells;
	}

	/**
	 * Update the store state and selectively trigger listeners for modified keys.
	 */
	public setState = (updater: GridStateUpdater<TRowData>): void => {
		const nextState = typeof updater === 'function' ? updater(this.state) : updater;

		if (this.isBatching) {
			this.batchedStateUpdates = { ...this.batchedStateUpdates, ...nextState };
			this.state = { ...this.state, ...nextState };
			if (nextState.columns) {
				this.updateCompiledGetters(nextState.columns);
			}
			return;
		}

		if (nextState.columns) {
			this.updateCompiledGetters(nextState.columns);
		}

		const prevState = this.state;

		// Construct new state
		this.state = { ...prevState, ...nextState };

		this.notifyChanges(prevState, Object.keys(nextState));
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
		this.listeners.forEach((listener) => listener(this.state));

		// Notify targeted key listeners
		updatedKeys.forEach((key) => {
			const targeted = this.keyListeners.get(key);
			if (targeted) {
				targeted.forEach((listener) => listener(this.state));
			}
		});

		// Trigger targeted coordinate notifications
		if (updatedKeys.has('focusedCell')) {
			const prev = prevState.focusedCell;
			const curr = this.state.focusedCell;
			if (prev) {
				const listeners = this.keyListeners.get(`cell:focus:${prev.rowId}:${prev.colField}`);
				if (listeners) listeners.forEach((l) => l(this.state));
			}
			if (curr) {
				const listeners = this.keyListeners.get(`cell:focus:${curr.rowId}:${curr.colField}`);
				if (listeners) listeners.forEach((l) => l(this.state));
			}
		}

		if (updatedKeys.has('activeEdit')) {
			const prev = prevState.activeEdit;
			const curr = this.state.activeEdit;
			if (prev) {
				const listeners = this.keyListeners.get(`cell:edit:${prev.rowId}:${prev.colField}`);
				if (listeners) listeners.forEach((l) => l(this.state));
			}
			if (curr) {
				const listeners = this.keyListeners.get(`cell:edit:${curr.rowId}:${curr.colField}`);
				if (listeners) listeners.forEach((l) => l(this.state));
			}
		}

		if (updatedKeys.has('selectedRange')) {
			const prevCells = this.getCellsInRange(prevState.selectedRange);
			const currCells = this.getCellsInRange(this.state.selectedRange);

			// Symmetric difference: cells in one range but not both
			const symDiff = new Set<string>();
			prevCells.forEach((c) => {
				if (!currCells.has(c)) symDiff.add(c);
			});
			currCells.forEach((c) => {
				if (!prevCells.has(c)) symDiff.add(c);
			});

			symDiff.forEach((cellKey) => {
				const [rowId, colField] = cellKey.split(':');
				const listeners = this.keyListeners.get(`cell:select:${rowId}:${colField}`);
				if (listeners) listeners.forEach((l) => l(this.state));
			});
		}

		if (updatedKeys.has('columnWidths')) {
			const prevWidths = prevState.columnWidths;
			const currWidths = this.state.columnWidths;
			const allCols = new Set([...Object.keys(prevWidths), ...Object.keys(currWidths)]);
			allCols.forEach((colField) => {
				if (prevWidths[colField] !== currWidths[colField]) {
					const listeners = this.keyListeners.get(`colWidth:${colField}`);
					if (listeners) listeners.forEach((l) => l(this.state));
				}
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
	 * Subscribe to a targeted key or location
	 */
	public subscribeToKey = (key: string, listener: Listener<TRowData>): (() => void) => {
		console.log('SUBSCRIBE TO KEY:', key);
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
		if (!this.rowModel) return '';
		const col = this.state.columns.find((c) => c.field === colField);
		if (!col) return '';

		const node = this.rowModel.getRowNodeById ? this.rowModel.getRowNodeById(rowId) : null;
		if (!node) {
			const idx = this.rowModel.getRowIndexById(rowId);
			if (idx === -1) return '';
			const row = this.rowModel.getRow(idx);
			if (!row) return '';
			if (col.valueGetter) {
				const dummyNode = new RowNode<TRowData>(rowId, row);
				return col.valueGetter({ node: dummyNode, row, colField });
			}
			const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
			return getter(row);
		}

		if (col.valueGetter) {
			return col.valueGetter({ node, row: node.data, colField });
		}
		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		return node.getCellValue(colField, getter);
	};

	/**
	 * Helper to set value of a single cell and trigger cellValueChanged.
	 */
	public setCellValue = (rowId: string, colField: string, value: unknown): void => {
		const oldValue = this.getCellValue(rowId, colField);
		if (oldValue === value) return;

		if (this.rowModel?.setCellValue) {
			this.rowModel.setCellValue(rowId, colField, value);
		}

		// Trigger coordinate-targeted cell value key listener for ALL columns on this row,
		// ensuring calculated columns (with valueGetters depending on other row data) also update.
		this.triggerCellNotifications(rowId);

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
			const cellValKey = `cell:value:${rowId}:${col.field}`;
			const targeted = this.keyListeners.get(cellValKey);
			if (targeted) {
				targeted.forEach((listener) => listener(this.state));
			}
		}
	};

	/**
	 * Stop editing on the active edit cell, committing or canceling the changes.
	 */
	public stopEditing = (cancel: boolean = false): void => {
		const activeEdit = this.state.activeEdit;
		if (!activeEdit) return;

		const { rowId, colField } = activeEdit;

		this.setState({ activeEdit: null });

		// Trigger selective cell refresh
		const targeted = this.keyListeners.get(`cell:edit:${rowId}:${colField}`);
		if (targeted) {
			targeted.forEach((listener) => listener(this.state));
		}

		// Dispatch 'editStopped' event
		this.dispatchEvent('editStopped', { rowId, colField, cancel });
	};


	/**
	 * Helper to get cell state safely.
	 */
	public getCellState = (rowId: string, colField: string): CellState => {
		const value = this.getCellValue(rowId, colField);
		const isEditing = this.state.activeEdit?.rowId === rowId && this.state.activeEdit?.colField === colField;

		return {
			value,
			computedValue: value,
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
				try { existing.destroy(); } catch (e) { console.error(e); }
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

	public destroy = (): void => {
		this.features.forEach((feature) => {
			if (feature.destroy) {
				try { feature.destroy(); } catch (e) { console.error(e); }
			}
		});
		this.features.clear();
		this.listeners.clear();
		this.keyListeners.clear();
		this.eventListeners.clear();
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

