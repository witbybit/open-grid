import React, { createContext, useContext, useMemo, useSyncExternalStore, useRef, useCallback, useEffect, useState } from 'react';
import {
	GridStore,
	GridState,
	GridNavigationController,
	GridNavigationOptions,
	GridApi,
	CellState,
	GridCellPointer,
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
} from '@open-grid/core';

// Create Grid Context
const GridContext = createContext<GridStore<unknown> | null>(null);

export interface GridProviderProps<TRowData = unknown> {
	store: GridStore<TRowData>;
	children: React.ReactNode;
}

export function GridProvider<TRowData = unknown>({ store, children }: GridProviderProps<TRowData>) {
	return <GridContext.Provider value={store as unknown as GridStore<unknown>}>{children}</GridContext.Provider>;
}

export function useGridStore<TRowData = unknown>(): GridStore<TRowData> {
	const context = useContext(GridContext);
	if (!context) {
		throw new Error('useGridStore must be used within a GridProvider');
	}
	return context as unknown as GridStore<TRowData>;
}

export function useGridApi<TRowData = unknown>(): GridApi<TRowData> {
	return useGridStore<TRowData>();
}

/**
 * Custom selector hook utilizing useSyncExternalStore for targeted re-renders.
 */
export function useGridSelector<T, TRowData = unknown>(selector: (state: GridState<TRowData>) => T): T {
	const store = useGridStore<TRowData>();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;

	const getSnapshot = useCallback(() => selectorRef.current(store.getState()), [store]);

	return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Targeted selector for individual keys to achieve optimal performance.
 */
export function useGridKeySelector<T, TRowData = unknown>(key: string, selector: (state: GridState<TRowData>) => T): T {
	const store = useGridStore<TRowData>();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;

	const subscribe = useCallback((onStoreChange: () => void) => store.subscribeToKey(key, onStoreChange), [store, key]);

	const getSnapshot = useCallback(() => selectorRef.current(store.getState()), [store]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * High-performance hook subscribing strictly to a single cell's coordinate changes.
 * Employs stable primitive snapshot resolution to prevent React render loops.
 */
export function useGridCell<TRowData = unknown>(rowId: string, colField: string): unknown {
	const store = useGridStore<TRowData>();

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const unsubVal = store.subscribeToKey(`cell:value:${rowId}:${colField}`, onStoreChange);
			const unsubData = store.subscribeToKey('dataVersion', onStoreChange);
			return () => {
				unsubVal();
				unsubData();
			};
		},
		[store, rowId, colField]
	);

	const getSnapshot = useCallback(() => {
		return store.getCellValue(rowId, colField);
	}, [store, rowId, colField]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Targeted hook for checking dynamic selection boundary states without re-rendering the whole table.
 */
export function useCellSelectionState<TRowData = unknown>(rowId: string, colField: string) {
	const store = useGridStore<TRowData>();

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const unsubFocus = store.subscribeToKey(`cell:focus:${rowId}:${colField}`, onStoreChange);
			const unsubSelect = store.subscribeToKey(`cell:select:${rowId}:${colField}`, onStoreChange);
			return () => {
				unsubFocus();
				unsubSelect();
			};
		},
		[store, rowId, colField]
	);

	const prevRef = useRef<{ isFocused: boolean; isSelected: boolean } | null>(null);

	const getSnapshot = useCallback(() => {
		const s = store.getState();
		const isFocused = s.focusedCell?.rowId === rowId && s.focusedCell?.colField === colField;

		let isSelected = false;
		const range = s.selectedRange;
		if (range) {
			const rowModel = store.getRowModel();
			if (rowModel) {
				const startIdx = rowModel.getRowIndexById(range.start.rowId);
				const endIdx = rowModel.getRowIndexById(range.end.rowId);
				const currentIdx = rowModel.getRowIndexById(rowId);

				const startColIdx = s.columns.findIndex((c) => c.field === range.start.colField);
				const endColIdx = s.columns.findIndex((c) => c.field === range.end.colField);
				const currentColIdx = s.columns.findIndex((c) => c.field === colField);

				if (startIdx !== -1 && endIdx !== -1 && currentIdx !== -1 && startColIdx !== -1 && endColIdx !== -1 && currentColIdx !== -1) {
					const minRow = Math.min(startIdx, endIdx);
					const maxRow = Math.max(startIdx, endIdx);
					const minCol = Math.min(startColIdx, endColIdx);
					const maxCol = Math.max(startColIdx, endColIdx);
					isSelected = currentIdx >= minRow && currentIdx <= maxRow && currentColIdx >= minCol && currentColIdx <= maxCol;
				}
			}
		}

		const next = { isFocused, isSelected };
		if (prevRef.current && prevRef.current.isFocused === isFocused && prevRef.current.isSelected === isSelected) {
			return prevRef.current;
		}
		prevRef.current = next;
		return next;
	}, [store, rowId, colField]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * React hook yielding custom focus bindings for active edit registers.
 */
export function useCellEditState<TRowData = unknown>(rowId: string, colField: string) {
	const store = useGridStore<TRowData>();

	const subscribe = useCallback(
		(onStoreChange: () => void) => store.subscribeToKey(`cell:edit:${rowId}:${colField}`, onStoreChange),
		[store, rowId, colField]
	);

	const getSnapshot = useCallback(() => {
		const s = store.getState();
		return s.activeEdit?.rowId === rowId && s.activeEdit?.colField === colField;
	}, [store, rowId, colField]);

	const isEditing = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	return { isEditing };
}

/**
 * Controller integration hook mapping standard interaction event handlers.
 */
export function useGridNavigationController<TRowData = unknown>(options: GridNavigationOptions = {}) {
	const store = useGridStore<TRowData>();
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const controller = useMemo(() => {
		const nav = new GridNavigationController<TRowData>({
			onCellValueChanged: (rowId, colField, val) => optionsRef.current.onCellValueChanged?.(rowId, colField, val),
			get editTrigger() {
				return optionsRef.current.editTrigger;
			},
			get arrowKeyNavigationEdit() {
				return optionsRef.current.arrowKeyNavigationEdit;
			},
		});
		store.registerFeature(nav);
		return nav;
	}, [store]);

	useEffect(() => () => controller.dispose(), [controller]);

	return controller;
}

export interface UseGridCellPropsOptions<TRowData = unknown> {
	rowId: string;
	colField: string;
	navigation?: GridNavigationController<TRowData>;
	ref?: React.RefObject<HTMLDivElement>;
	className?: string;
	focusedClassName?: string;
	selectedClassName?: string;
	api?: GridApi<TRowData>;
}

export interface UseGridCellPropsResult<TRowData = unknown> {
	ref: React.RefObject<HTMLDivElement>;
	cellState: CellState;
	isFocused: boolean;
	isSelected: boolean;
	isEditing: boolean;
	api: GridApi<TRowData>;
	cellProps: {
		ref: React.RefObject<HTMLDivElement>;
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
export function useGridCellProps<TRowData = unknown>(options: UseGridCellPropsOptions<TRowData>): UseGridCellPropsResult<TRowData> {
	const {
		rowId,
		colField,
		navigation: propNavigation,
		ref: userRef,
		className = 'flex items-center px-3 h-full border-r border-slate-800 text-sm select-none relative transition-colors duration-75 outline-none bg-slate-950 text-slate-300',
		focusedClassName = 'bg-slate-900 border-2 border-purple-500 z-10',
		selectedClassName = 'bg-purple-500/10',
		api: propApi,
	} = options;

	const localRef = useRef<HTMLDivElement>(null);
	const cellRef = (userRef || localRef) as React.RefObject<HTMLDivElement>;

	const contextApi = useContext(GridContext);
	const api = propApi || (contextApi as unknown as GridApi<TRowData>);
	if (!api) {
		throw new Error('GridApi must be provided either via props or GridProvider context.');
	}

	const prevSnapshotRef = useRef<{
		value: unknown;
		isFocused: boolean;
		isSelected: boolean;
		isEditing: boolean;
		colWidth: number;
	} | null>(null);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const unsubCellFocus = api.subscribeToKey(`cell:focus:${rowId}:${colField}`, onStoreChange);
			const unsubCellSelect = api.subscribeToKey(`cell:select:${rowId}:${colField}`, onStoreChange);
			const unsubCellEdit = api.subscribeToKey(`cell:edit:${rowId}:${colField}`, onStoreChange);
			const unsubCellVal = api.subscribeToKey(`cell:value:${rowId}:${colField}`, onStoreChange);
			const unsubData = api.subscribeToKey('dataVersion', onStoreChange);
			const unsubWidth = api.subscribeToKey(`colWidth:${colField}`, onStoreChange);
			return () => {
				unsubCellFocus();
				unsubCellSelect();
				unsubCellEdit();
				unsubCellVal();
				unsubData();
				unsubWidth();
			};
		},
		[api, rowId, colField]
	);

	const getSnapshot = useCallback(() => {
		const state = api.getState();
		const value = api.getCellValue(rowId, colField);
		const isFocused = state.focusedCell?.rowId === rowId && state.focusedCell?.colField === colField;

		let isSelected = false;
		const range = state.selectedRange;
		if (range) {
			const rowModel = api.getRowModel();
			if (rowModel) {
				const startIdx = rowModel.getRowIndexById(range.start.rowId);
				const endIdx = rowModel.getRowIndexById(range.end.rowId);
				const currentIdx = rowModel.getRowIndexById(rowId);

				const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
				const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);
				const currentColIdx = state.columns.findIndex((c) => c.field === colField);

				if (startIdx !== -1 && endIdx !== -1 && currentIdx !== -1 && startColIdx !== -1 && endColIdx !== -1 && currentColIdx !== -1) {
					const minRow = Math.min(startIdx, endIdx);
					const maxRow = Math.max(startIdx, endIdx);
					const minCol = Math.min(startColIdx, endColIdx);
					const maxCol = Math.max(startColIdx, endColIdx);
					isSelected = currentIdx >= minRow && currentIdx <= maxRow && currentColIdx >= minCol && currentColIdx <= maxCol;
				}
			}
		}

		const isEditing = state.activeEdit?.rowId === rowId && state.activeEdit?.colField === colField;
		const colWidth = state.columnWidths[colField] ?? 100;

		const nextSnapshot = { value, isFocused, isSelected, isEditing, colWidth };

		// Ref-based shallow equality memoization
		if (
			prevSnapshotRef.current &&
			prevSnapshotRef.current.value === value &&
			prevSnapshotRef.current.isFocused === isFocused &&
			prevSnapshotRef.current.isSelected === isSelected &&
			prevSnapshotRef.current.isEditing === isEditing &&
			prevSnapshotRef.current.colWidth === colWidth
		) {
			return prevSnapshotRef.current;
		}

		prevSnapshotRef.current = nextSnapshot;
		return nextSnapshot;
	}, [api, rowId, colField]);

	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const { value: cellValue, isFocused, isSelected, isEditing, colWidth } = snapshot;

	const navigation = propNavigation || api.getFeature<GridNavigationController<TRowData>>('navigation');
	if (!navigation) {
		throw new Error('GridNavigationController feature is not registered on the store');
	}

	// Focus synchronization effect
	useEffect(() => {
		if (isFocused && !isEditing) {
			const gridContainer = cellRef.current?.closest('[tabindex]');
			if (document.activeElement === document.body || (gridContainer && gridContainer.contains(document.activeElement))) {
				cellRef.current?.focus();
			}
		}
	}, [isFocused, isEditing, cellRef]);

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (isEditing) return;
			cellRef.current?.focus();
			navigation.handleMouseDown(rowId, colField, e.nativeEvent);
		},
		[rowId, colField, navigation, isEditing, cellRef]
	);

	const onMouseEnter = useCallback(() => {
		navigation.handleMouseEnter(rowId, colField);
	}, [rowId, colField, navigation]);

	const onDoubleClick = useCallback(() => {
		if (isEditing) return;
		navigation.setCellEditing(rowId, colField, true);
	}, [rowId, colField, navigation, isEditing]);

	const onClick = useCallback(
		(e: React.MouseEvent) => {
			if (isEditing) return;
			navigation.handleClick(rowId, colField, e.nativeEvent);
		},
		[rowId, colField, navigation, isEditing]
	);

	const combinedClassName = useMemo(() => {
		let classes = className + ' ';
		if (isFocused) {
			classes += focusedClassName + ' ';
		} else if (isSelected) {
			classes += selectedClassName + ' ';
		}
		return classes.trim();
	}, [isFocused, isSelected, className, focusedClassName, selectedClassName]);

	const cellState = useMemo<CellState>(() => {
		return {
			value: cellValue,
			computedValue: cellValue,
			isEditing,
		};
	}, [cellValue, isEditing]);

	return {
		ref: cellRef,
		cellState,
		isFocused,
		isSelected,
		isEditing,
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

export interface CellProps<TRowData = unknown> {
	rowId: string;
	colField: string;
	api?: GridApi<TRowData>;
	navigation?: GridNavigationController<TRowData>;
	className?: string;
	focusedClassName?: string;
	selectedClassName?: string;
	renderValue?: (value: unknown, computedValue: unknown) => React.ReactNode;
}

/**
 * High-performance, plug-and-play Grid Cell component.
 * Evaluates O(1) state transitions under React Scan, handling inputs, blurs, commits, and style overlays.
 */
const CellComponent = <TRowData,>(props: CellProps<TRowData>) => {
	const { rowId, colField, renderValue } = props;
	const { cellProps, cellState, isEditing, api } = useGridCellProps<TRowData>(props);

	// Tiny, fast, isolated typing state
	const [localValue, setLocalValue] = useState<unknown>(cellState.value);

	const localValueRef = useRef(localValue);
	localValueRef.current = localValue;

	const isCancelledRef = useRef(false);
	const isCommittedRef = useRef(false);

	useEffect(() => {
		const unsubscribe = api.addEventListener<{ rowId: string; colField: string; cancel: boolean }>('editStopped', (event) => {
			if (event.payload.rowId === rowId && event.payload.colField === colField) {
				if (event.payload.cancel) {
					isCancelledRef.current = true;
				}
			}
		});

		if (isEditing) {
			isCancelledRef.current = false;
			isCommittedRef.current = false;
			setLocalValue(cellState.value);
		} else {
			// Editing stopped! Check if we need to auto-commit
			if (!isCancelledRef.current && !isCommittedRef.current) {
				isCommittedRef.current = true;
				api.setCellValue(rowId, colField, localValueRef.current);
			}
		}

		return () => {
			unsubscribe();
			if (isEditing && !isCancelledRef.current && !isCommittedRef.current) {
				isCommittedRef.current = true;
				api.setCellValue(rowId, colField, localValueRef.current);
			}
		};
	}, [isEditing, cellState.value, api, rowId, colField]);

	const handleCommit = useCallback(
		(finalValue?: unknown) => {
			isCommittedRef.current = true;
			const isEvent = finalValue && typeof finalValue === 'object' && ('nativeEvent' in finalValue || 'target' in finalValue);
			const valToCommit = finalValue !== undefined && !isEvent ? finalValue : localValue;
			api.setCellValue(rowId, colField, valToCommit);
			api.stopEditing();
		},
		[api, rowId, colField, localValue]
	);

	const handleCancel = useCallback(() => {
		isCancelledRef.current = true;
		api.stopEditing();
	}, [api]);

	// Find the column definition to check for custom editors or renderers
	const colDef = useMemo(() => {
		return api.getState().columns.find((c) => c.field === colField);
	}, [api, colField]);

	const rowData = (() => {
		const rowModel = api.getRowModel();
		if (!rowModel) return null;
		if (rowModel.getRowNodeById) {
			const node = rowModel.getRowNodeById(rowId);
			return node ? node.data : null;
		}
		const idx = rowModel.getRowIndexById(rowId);
		if (idx === -1) return null;
		return rowModel.getRow(idx);
	})();

	const CustomEditor = colDef?.cellEditor as React.ComponentType<CellEditorProps<TRowData>> | undefined;
	const CustomRenderer = colDef?.cellRenderer as React.ComponentType<CellRendererProps<TRowData>> | undefined;

	return (
		<div {...cellProps}>
			{isEditing ? (
				CustomEditor ? (
					<CustomEditor
						rowId={rowId}
						colField={colField}
						value={localValue}
						onChange={setLocalValue}
						api={api}
						onCommit={handleCommit}
						onCancel={handleCancel}
					/>
				) : (
					<input
						autoFocus
						className='absolute inset-0 w-full h-full px-3 text-sm bg-slate-900 text-white border-2 border-purple-500 outline-none z-20'
						value={typeof localValue === 'string' || typeof localValue === 'number' ? String(localValue) : ''}
						onChange={(e) => setLocalValue(e.target.value)}
						onMouseDown={(e) => e.stopPropagation()}
						onDoubleClick={(e) => e.stopPropagation()}
						onBlur={() => handleCommit()}
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
			) : CustomRenderer && rowData ? (
				<CustomRenderer
					value={cellState.value}
					computedValue={cellState.computedValue}
					row={rowData}
					rowId={rowId}
					colField={colField}
					api={api}
				/>
			) : renderValue ? (
				renderValue(cellState.value, cellState.computedValue)
			) : (
				<span className='truncate'>
					{typeof cellState.computedValue === 'string' || typeof cellState.computedValue === 'number'
						? String(cellState.computedValue)
						: typeof cellState.value === 'string' || typeof cellState.value === 'number'
							? String(cellState.value)
							: ''}
				</span>
			)}
		</div>
	);
};

export const Cell = React.memo(CellComponent) as (<TRowData>(props: CellProps<TRowData>) => React.ReactElement | null) & { displayName?: string };

Cell.displayName = 'Cell';
