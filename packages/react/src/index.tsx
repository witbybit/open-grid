import React, { createContext, useContext, useMemo, useSyncExternalStore, useRef, useCallback, useEffect } from 'react';
import { GridStore, GridState, GridNavigationController, GridNavigationOptions, GridApi, CellState } from '@open-grid/core';

// Create Grid Context
const GridContext = createContext<GridStore | null>(null);

export interface GridProviderProps {
	store: GridStore;
	children: React.ReactNode;
}

export function GridProvider({ store, children }: GridProviderProps) {
	return <GridContext.Provider value={store}>{children}</GridContext.Provider>;
}

export function useGridStore(): GridStore {
	const context = useContext(GridContext);
	if (!context) {
		throw new Error('useGridStore must be used within a GridProvider');
	}
	return context;
}

export function useGridApi(): GridApi {
	return useGridStore();
}

/**
 * Custom selector hook utilizing useSyncExternalStore for targeted re-renders.
 */
export function useGridSelector<T>(selector: (state: GridState) => T): T {
	const store = useGridStore();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;

	const getSnapshot = useCallback(() => selectorRef.current(store.getState()), [store]);

	return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Targeted selector for individual keys to achieve optimal performance (e.g. focusedCell, loadedBlocks).
 */
export function useGridKeySelector<T>(key: string, selector: (state: GridState) => T): T {
	const store = useGridStore();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;

	const subscribe = useCallback((onStoreChange: () => void) => store.subscribeToKey(key, onStoreChange), [store, key]);

	const getSnapshot = useCallback(() => selectorRef.current(store.getState()), [store]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * High-performance hook subscribing strictly to a single cell's coordinate changes.
 */
export function useGridCell(row: number, col: number) {
	const store = useGridStore();
	const key = `cell:${row},${col}`;

	const subscribe = useCallback((onStoreChange: () => void) => store.subscribeToKey(key, onStoreChange), [store, key]);

	const getSnapshot = useCallback(() => store.getCellState(row, col), [store, row, col]);

	const cellState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	return cellState;
}

/**
 * Targeted hook for checking dynamic selection boundary states without re-rendering the whole table.
 */
export function useCellSelectionState(row: number, col: number) {
	const isFocused = useGridKeySelector('focusedCell', (s) => s.focusedCell?.row === row && s.focusedCell?.col === col);

	const isSelected = useGridKeySelector('selectedRange', (s) => {
		const range = s.selectedRange;
		if (!range) return false;
		const minRow = Math.min(range.start.row, range.end.row);
		const maxRow = Math.max(range.start.row, range.end.row);
		const minCol = Math.min(range.start.col, range.end.col);
		const maxCol = Math.max(range.start.col, range.end.col);
		return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
	});

	return { isFocused, isSelected };
}

/**
 * React hook yielding custom input and focus bindings for active edit registers.
 */
export function useCellEditState(row: number, col: number) {
	const store = useGridStore();
	const isEditing = useGridKeySelector('activeEditCell', (s) => s.activeEditCell?.row === row && s.activeEditCell?.col === col);

	// Only subscribe to edit value updates when this cell is the active editor, preventing O(N) re-renders on every keystroke
	const value = useGridKeySelector('activeEditValue', (s) =>
		s.activeEditCell?.row === row && s.activeEditCell?.col === col ? s.activeEditValue : ''
	);

	const setValue = (val: string) => {
		store.setState({ activeEditValue: val });
	};

	return { isEditing, value, setValue };
}

/**
 * Controller integration hook mapping standard interaction event handlers.
 */
export function useGridNavigationController(options: GridNavigationOptions = {}) {
	const store = useGridStore();
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const controller = useMemo(() => {
		return new GridNavigationController(store, {
			onCellValueChanged: (row, col, val) => optionsRef.current.onCellValueChanged?.(row, col, val),
			get editTrigger() {
				return optionsRef.current.editTrigger;
			},
			get arrowKeyNavigationEdit() {
				return optionsRef.current.arrowKeyNavigationEdit;
			},
		});
	}, [store]);

	useEffect(() => () => controller.dispose(), [controller]);

	return controller;
}

export interface CellRendererProps {
	row: number;
	col: number;
	value: any;
	computedValue: any;
	api: GridApi;
}

export interface CellEditorProps {
	row: number;
	col: number;
	value: any;
	onChange: (val: any) => void;
	onCommit: () => void;
	onCancel: () => void;
	api: GridApi;
}

export interface UseGridCellPropsOptions {
	row: number;
	col: number;
	navigation: GridNavigationController;
	ref?: React.RefObject<any>;
	className?: string;
	focusedClassName?: string;
	selectedClassName?: string;
}

export interface UseGridCellPropsResult {
	ref: React.RefObject<any>;
	cellState: CellState;
	isFocused: boolean;
	isSelected: boolean;
	isEditing: boolean;
	value: string;
	setValue: (val: string) => void;
	api: GridApi;
	cellProps: {
		ref: React.RefObject<any>;
		tabIndex: number;
		className: string;
		style?: React.CSSProperties;
		onMouseDown: (e: React.MouseEvent) => void;
		onMouseEnter: () => void;
		onDoubleClick: (e: React.MouseEvent) => void;
		onClick: (e: React.MouseEvent) => void;
	};
}

/**
 * Advanced React hook for full rendering customizability. Generates ready-to-spread props
 * handling element focus sync, range selection styles, and drag events out-of-the-box.
 */
export function useGridCellProps(options: UseGridCellPropsOptions): UseGridCellPropsResult {
	const {
		row,
		col,
		navigation,
		ref: userRef,
		className = 'flex items-center px-3 h-full border-r border-slate-800 text-sm select-none relative transition-colors duration-75 outline-none bg-slate-950 text-slate-300',
		focusedClassName = 'bg-slate-900 border-2 border-purple-500 z-10',
		selectedClassName = 'bg-purple-500/10',
	} = options;

	const localRef = useRef<any>(null);
	const cellRef = userRef || localRef;

	const cellState = useGridCell(row, col);
	const { isFocused, isSelected } = useCellSelectionState(row, col);
	const { isEditing, value, setValue } = useCellEditState(row, col);
	const api = useGridApi();

	// Focus synchronization effect
	useEffect(() => {
		if (isFocused && !isEditing) {
			const gridContainer = cellRef.current?.closest('[tabindex]');
			if (document.activeElement === document.body || (gridContainer && gridContainer.contains(document.activeElement))) {
				cellRef.current?.focus();
			}
		}
	}, [isFocused, isEditing]);

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (isEditing) return;
			cellRef.current?.focus();
			navigation.handleMouseDown(row, col, e.nativeEvent);
		},
		[row, col, navigation, isEditing]
	);

	const onMouseEnter = useCallback(() => {
		navigation.handleMouseEnter(row, col);
	}, [row, col, navigation]);

	const onDoubleClick = useCallback(
		(e: React.MouseEvent) => {
			if (isEditing) return;
			navigation.setCellEditing(row, col, true);
		},
		[row, col, navigation, isEditing]
	);

	const onClick = useCallback(
		(e: React.MouseEvent) => {
			if (isEditing) return;
			navigation.handleClick(row, col, e.nativeEvent);
		},
		[row, col, navigation, isEditing]
	);

	const colWidth = useGridSelector((state) => state.colWidths[col] ?? 100);

	const combinedClassName = useMemo(() => {
		let classes = className + ' ';
		if (isFocused) {
			classes += focusedClassName + ' ';
		} else if (isSelected) {
			classes += selectedClassName + ' ';
		}
		return classes.trim();
	}, [isFocused, isSelected, className, focusedClassName, selectedClassName]);

	return {
		ref: cellRef,
		cellState,
		isFocused,
		isSelected,
		isEditing,
		value,
		setValue,
		api,
		cellProps: {
			ref: cellRef,
			tabIndex: -1,
			className: combinedClassName,
			style: { width: colWidth },
			onMouseDown,
			onMouseEnter,
			onDoubleClick,
			onClick,
		},
	};
}

export interface CellProps {
	row: number;
	col: number;
	navigation: GridNavigationController;
	className?: string;
	focusedClassName?: string;
	selectedClassName?: string;
	customEditor?: React.ComponentType<{
		row: number;
		col: number;
		value: string;
		onChange: (val: string) => void;
		api: GridApi;
		onCommit: () => void;
		onCancel: () => void;
	}>;
	renderValue?: (value: any, computedValue: any) => React.ReactNode;
}

/**
 * High-performance, plug-and-play Grid Cell component.
 * Evaluates O(1) state transitions under React Scan, handling inputs, blurs, commits, and style overlays.
 */
export const Cell = React.memo((props: CellProps) => {
	const { row, col, navigation, customEditor: CustomEditor, renderValue } = props;
	const { cellProps, cellState, isEditing, value, setValue, api } = useGridCellProps(props);

	const handleCommit = useCallback(() => {
		api.stopEditing(false);
	}, [api]);

	const handleCancel = useCallback(() => {
		api.stopEditing(true);
	}, [api]);

	return (
		<div {...cellProps}>
			{isEditing ? (
				CustomEditor ? (
					<CustomEditor row={row} col={col} value={value} onChange={setValue} api={api} onCommit={handleCommit} onCancel={handleCancel} />
				) : (
					<input
						autoFocus
						className='absolute inset-0 w-full h-full px-3 text-sm bg-slate-900 text-white border-2 border-purple-500 outline-none z-20'
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onMouseDown={(e) => e.stopPropagation()}
						onDoubleClick={(e) => e.stopPropagation()}
						onBlur={handleCommit}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.stopPropagation();
								handleCommit();
							} else if (e.key === 'Escape') {
								e.stopPropagation();
								handleCancel();
							}
						}}
					/>
				)
			) : renderValue ? (
				renderValue(cellState.value, cellState.computedValue)
			) : (
				<span className='truncate'>{cellState.computedValue ?? cellState.value}</span>
			)}
		</div>
	);
});

Cell.displayName = 'Cell';
