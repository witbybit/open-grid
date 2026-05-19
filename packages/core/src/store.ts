export interface GridCellCoordinate {
	row: number;
	col: number;
}

export interface GridCellRange {
	start: GridCellCoordinate;
	end: GridCellCoordinate;
}

export interface CellState {
	value: any;
	computedValue?: any;
	isEditing?: boolean;
}

export interface GridEvent<T = any> {
	type: string;
	payload: T;
}

export type GridEventListener<T = any> = (event: GridEvent<T>) => void;

export interface GridState {
	rowCount: number;
	colCount: number;
	focusedCell: GridCellCoordinate | null;
	selectedRange: GridCellRange | null;
	cells: Record<string, CellState>; // Keyed as "r,c"
	rowHeights: Record<number, number>; // row index -> height in px
	colWidths: Record<number, number>; // col index -> width in px
	defaultRowHeight: number;
	defaultColWidth: number;

	// Model-specific states
	loadingBlocks: Record<number, boolean>; // blockIndex -> isFetching
	loadedBlocks: Record<number, any[]>; // blockIndex -> rows
	rowModelType: 'client' | 'server';

	// Active edit state registers
	activeEditCell: GridCellCoordinate | null;
	activeEditValue: string;

	// Sorting & Filtering State
	sortModel: any;
	filterModel: any;
}

export type GridStateUpdater = Partial<GridState> | ((state: GridState) => Partial<GridState>);

export type Listener = (state: GridState) => void;

export interface GridApi {
	getState(): GridState;
	setState(updater: GridStateUpdater): void;
	setCellValue(row: number, col: number, value: any, computedValue?: any): void;
	getCellState(row: number, col: number): CellState;
	setFocusedCell(row: number | null, col: number | null): void;
	setSelectedRange(start: GridCellCoordinate | null, end: GridCellCoordinate | null): void;
	setColumnWidth(col: number, width: number): void;
	setRowHeight(row: number, height: number): void;
	addEventListener<T = any>(type: string, callback: GridEventListener<T>): () => void;
	dispatchEvent<T = any>(type: string, payload: T): void;
	stopEditing(cancel?: boolean): void;
}

export class GridStore implements GridApi {
	private state: GridState;
	private listeners = new Set<Listener>();
	private keyListeners = new Map<string, Set<Listener>>();
	private eventListeners = new Map<string, Set<GridEventListener>>();

	constructor(initialState: Partial<GridState> = {}) {
		this.state = {
			rowCount: 0,
			colCount: 0,
			focusedCell: null,
			selectedRange: null,
			cells: {},
			rowHeights: {},
			colWidths: {},
			defaultRowHeight: 40,
			defaultColWidth: 100,
			loadingBlocks: {},
			loadedBlocks: {},
			rowModelType: 'client',
			activeEditCell: null,
			activeEditValue: '',
			sortModel: null,
			filterModel: null,
			...initialState,
		};
	}

	public getState = (): GridState => {
		return this.state;
	};

	/**
	 * Update the store state and selectively trigger listeners for modified keys.
	 */
	public setState = (updater: GridStateUpdater): void => {
		const nextState = typeof updater === 'function' ? updater(this.state) : updater;

		// Quick diff of updated keys
		const updatedKeys = new Set<string>();
		const prevState = this.state;

		// Construct new state
		this.state = { ...prevState, ...nextState };

		// Identify changed root-level state keys
		for (const key of Object.keys(nextState) as Array<keyof GridState>) {
			if (prevState[key] !== this.state[key]) {
				updatedKeys.add(key);
			}
		}

		// Special deep checking for 'cells' additions/updates
		if (nextState.cells) {
			const prevCells = prevState.cells;
			const nextCells = this.state.cells;

			for (const coordKey of Object.keys(nextCells)) {
				if (prevCells[coordKey] !== nextCells[coordKey]) {
					updatedKeys.add(`cell:${coordKey}`);
				}
			}
		}

		// Notify global listeners
		if (updatedKeys.size > 0) {
			this.listeners.forEach((listener) => listener(this.state));
		}

		// Notify targeted key listeners
		updatedKeys.forEach((key) => {
			const targeted = this.keyListeners.get(key);
			if (targeted) {
				targeted.forEach((listener) => listener(this.state));
			}
		});

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
	};

	/**
	 * Subscribe globally to any state change.
	 */
	public subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/**
	 * Subscribe to a targeted key or coordinate (e.g. "focusedCell" or "cell:0,0")
	 */
	public subscribeToKey = (key: string, listener: Listener): (() => void) => {
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
	public addEventListener = <T = any>(type: string, callback: GridEventListener<T>): (() => void) => {
		if (!this.eventListeners.has(type)) {
			this.eventListeners.set(type, new Set());
		}
		const set = this.eventListeners.get(type)!;
		set.add(callback as GridEventListener);
		return () => {
			set.delete(callback as GridEventListener);
			if (set.size === 0) {
				this.eventListeners.delete(type);
			}
		};
	};

	public dispatchEvent = <T = any>(type: string, payload: T): void => {
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
	 * Helper to set value of a single cell and trigger cellValueChanged.
	 */
	public setCellValue = (row: number, col: number, value: any, computedValue?: any): void => {
		const key = `${row},${col}`;
		const oldState = this.getCellState(row, col);
		const oldValue = oldState.value;

		this.setState((state) => ({
			cells: {
				...state.cells,
				[key]: {
					...state.cells[key],
					value,
					computedValue: computedValue ?? value,
				},
			},
		}));

		// Trigger pluggable cellValueChanged event
		this.dispatchEvent('cellValueChanged', {
			row,
			col,
			oldValue,
			newValue: value,
		});
	};

	/**
	 * Stop editing on the active edit cell, committing or canceling the changes.
	 */
	public stopEditing = (cancel: boolean = false): void => {
		const state = this.state;
		const active = state.activeEditCell;
		const focus = state.focusedCell;

		if (!active && (!focus || !this.getCellState(focus.row, focus.col).isEditing)) return;

		const nextCells = { ...state.cells };

		if (active) {
			const { row, col } = active;
			const key = `${row},${col}`;
			const cell = this.getCellState(row, col);

			if (cancel) {
				nextCells[key] = {
					...cell,
					isEditing: false,
				};
			} else {
				const activeEditValue = state.activeEditValue;
				this.dispatchEvent('cellValueChanged', {
					row,
					col,
					oldValue: cell.value,
					newValue: activeEditValue,
				});

				nextCells[key] = {
					...cell,
					value: activeEditValue,
					computedValue: activeEditValue,
					isEditing: false,
				};
			}
		}

		if (focus) {
			const { row, col } = focus;
			const key = `${row},${col}`;
			const cell = nextCells[key] || this.getCellState(row, col);
			if (cell.isEditing) {
				nextCells[key] = {
					...cell,
					isEditing: false,
				};
			}
		}

		this.setState({
			cells: nextCells,
			activeEditCell: null,
			activeEditValue: '',
		});
	};

	/**
	 * Helper to get cell state safely.
	 */
	public getCellState = (row: number, col: number): CellState => {
		return this.state.cells[`${row},${col}`] || { value: '', computedValue: '', isEditing: false };
	};

	/**
	 * Helper to set focused cell and trigger focusChanged.
	 */
	public setFocusedCell = (row: number | null, col: number | null): void => {
		const nextFocus = row !== null && col !== null ? { row, col } : null;

		this.setState({
			focusedCell: nextFocus,
		});
	};

	/**
	 * Helper to set selection range and trigger selectionChanged.
	 */
	public setSelectedRange = (start: GridCellCoordinate | null, end: GridCellCoordinate | null): void => {
		const nextRange = start !== null && end !== null ? { start, end } : null;

		this.setState({
			selectedRange: nextRange,
		});
	};

	/**
	 * Helper to set column width and trigger columnResized.
	 */
	public setColumnWidth = (col: number, width: number): void => {
		this.setState((state) => ({
			colWidths: {
				...state.colWidths,
				[col]: width,
			},
		}));

		this.dispatchEvent('columnResized', {
			col,
			width,
		});
	};

	/**
	 * Helper to set row height and trigger rowResized.
	 */
	public setRowHeight = (row: number, height: number): void => {
		this.setState((state) => ({
			rowHeights: {
				...state.rowHeights,
				[row]: height,
			},
		}));

		this.dispatchEvent('rowResized', {
			row,
			height,
		});
	};
}
