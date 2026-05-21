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
	ServerRowModelController,
	ViewportRange,
	CellSubscription,
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
			const sub = { rowId, colField, onStoreChange };
			store.registerCellSubscription(sub);
			const unsubData = store.subscribeToKey('dataVersion', onStoreChange);
			return () => {
				store.unregisterCellSubscription(sub);
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
			const sub = { rowId, colField, onStoreChange };
			store.registerCellSubscription(sub);
			return () => {
				store.unregisterCellSubscription(sub);
			};
		},
		[store, rowId, colField]
	);

	const prevRef = useRef<{ isFocused: boolean; isSelected: boolean } | null>(null);

	const getSnapshot = useCallback(() => {
		const s = store.getState();
		const isFocused = s.focusedCell?.rowId === rowId && s.focusedCell?.colField === colField;

		let isSelected = false;
		const bounds = s.selectedRangeBounds;
		if (bounds) {
			const rowModel = store.getRowModel();
			if (rowModel) {
				// Optimized: Try to get cached row index from RowNode first
				let currentIdx = -1;
				if (rowModel.getRowNodeById) {
					const node = rowModel.getRowNodeById(rowId);
					if (node && node.rowIndex !== -1) {
						currentIdx = node.rowIndex;
					}
				}
				
				// Fallback to index lookup if node not available
				if (currentIdx === -1) {
					currentIdx = rowModel.getRowIndexById(rowId);
				}
				
				const currentColIdx = store.getColumnIndex(colField);

				if (currentIdx !== -1 && currentColIdx !== -1) {
					isSelected = currentIdx >= bounds.minRow && currentIdx <= bounds.maxRow && currentColIdx >= bounds.minCol && currentColIdx <= bounds.maxCol;
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
		(onStoreChange: () => void) => {
			const sub = { rowId, colField, onStoreChange };
			store.registerCellSubscription(sub);
			return () => {
				store.unregisterCellSubscription(sub);
			};
		},
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

	// Opt-out options for custom visualization behaviors
	disableFocusSync?: boolean;
	disableMouseDown?: boolean;
	disableMouseEnter?: boolean;
	disableDoubleClick?: boolean;
	disableClick?: boolean;
}

export interface UseGridCellPropsResult<TRowData = unknown> {
	ref: React.RefObject<HTMLDivElement>;
	cellState: CellState;
	isFocused: boolean;
	isSelected: boolean;
	isEditing: boolean;
	isLoading: boolean;
	api: GridApi<TRowData>;
	cellProps: {
		ref: React.RefObject<HTMLDivElement>;
		tabIndex: number;
		className: string;
		'data-col-field': string;
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
		disableFocusSync = false,
		disableMouseDown = false,
		disableMouseEnter = false,
		disableDoubleClick = false,
		disableClick = false,
	} = options;

	const localRef = useRef<HTMLDivElement>(null);
	const cellRef = (userRef || localRef) as React.RefObject<HTMLDivElement>;

	const contextApi = useContext(GridContext);
	const api = propApi || (contextApi as unknown as GridApi<TRowData>);
	if (!api) {
		throw new Error('GridApi must be provided either via props or GridProvider context.');
	}

	const prevSnapshotRef = useRef<{
		cellState: CellState;
		isFocused: boolean;
		isSelected: boolean;
		isEditing: boolean;
		colWidth: number;
	} | null>(null);

	const prevCoordsRef = useRef({ rowId, colField });
	const onStoreChangeRef = useRef<() => void>();

	const cellSub = useMemo(() => {
		const sub: CellSubscription = {
			rowId,
			colField,
			onStoreChange: () => {
				onStoreChangeRef.current?.();
			}
		};
		return sub;
	}, [api]);

	// Synchronously track coordinate shifts during render without side-effects warning
	if (prevCoordsRef.current.rowId !== rowId || prevCoordsRef.current.colField !== colField) {
		const oldRowId = prevCoordsRef.current.rowId;
		const oldColField = prevCoordsRef.current.colField;
		cellSub.rowId = rowId;
		cellSub.colField = colField;
		api.updateCellSubscription(cellSub, oldRowId, oldColField, rowId, colField);
		prevCoordsRef.current = { rowId, colField };
	}

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			onStoreChangeRef.current = onStoreChange;
			api.registerCellSubscription(cellSub);
			return () => {
				api.unregisterCellSubscription(cellSub);
			};
		},
		[api, cellSub]
	);
 
	const getSnapshot = useCallback(() => {
		const state = api.getState();
		const cellState = api.getCellState(rowId, colField);
		const isFocused = state.focusedCell?.rowId === rowId && state.focusedCell?.colField === colField;
 
		let isSelected = false;
		const bounds = state.selectedRangeBounds;
		if (bounds) {
			const rowModel = api.getRowModel();
			if (rowModel) {
				// Optimized: Try to get cached row index from RowNode first
				let currentIdx = -1;
				if (rowModel.getRowNodeById) {
					const node = rowModel.getRowNodeById(rowId);
					if (node && node.rowIndex !== -1) {
						currentIdx = node.rowIndex;
					}
				}
				
				// Fallback to index lookup if node not available
				if (currentIdx === -1) {
					currentIdx = rowModel.getRowIndexById(rowId);
				}
				
				const currentColIdx = api.getColumnIndex(colField);
 
				if (currentIdx !== -1 && currentColIdx !== -1) {
					isSelected = currentIdx >= bounds.minRow && currentIdx <= bounds.maxRow && currentColIdx >= bounds.minCol && currentColIdx <= bounds.maxCol;
				}
			}
		}
 
		const isEditing = state.activeEdit?.rowId === rowId && state.activeEdit?.colField === colField;
		const colWidth = state.columnWidths[colField] ?? 100;
 
		const nextSnapshot = { cellState, isFocused, isSelected, isEditing, colWidth };

		// Ref-based shallow equality memoization
		if (
			prevSnapshotRef.current &&
			prevSnapshotRef.current.cellState.value === cellState.value &&
			prevSnapshotRef.current.cellState.computedValue === cellState.computedValue &&
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
	const { cellState, isFocused, isSelected, isEditing, colWidth } = snapshot;

	const navigation = propNavigation || api.getFeature<GridNavigationController<TRowData>>('navigation');
	if (!navigation) {
		throw new Error('GridNavigationController feature is not registered on the store');
	}

	// Focus synchronization effect
	useEffect(() => {
		if (disableFocusSync) return;
		if (isFocused && !isEditing) {
			const gridContainer = cellRef.current?.closest('[tabindex]');
			if (document.activeElement === document.body || (gridContainer && gridContainer.contains(document.activeElement))) {
				cellRef.current?.focus();
			}
		}
	}, [isFocused, isEditing, cellRef, disableFocusSync]);

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (disableMouseDown) return;
			if (isEditing) return;
			cellRef.current?.focus();
			navigation.handleMouseDown(rowId, colField, e.nativeEvent);
		},
		[rowId, colField, navigation, isEditing, cellRef, disableMouseDown]
	);

	const onMouseEnter = useCallback(() => {
		if (disableMouseEnter) return;
		navigation.handleMouseEnter(rowId, colField);
	}, [rowId, colField, navigation, disableMouseEnter]);

	const onDoubleClick = useCallback(() => {
		if (disableDoubleClick) return;
		if (isEditing) return;
		navigation.setCellEditing(rowId, colField, true);
	}, [rowId, colField, navigation, isEditing, disableDoubleClick]);

	const onClick = useCallback(
		(e: React.MouseEvent) => {
			if (disableClick) return;
			if (isEditing) return;
			navigation.handleClick(rowId, colField, e.nativeEvent);
		},
		[rowId, colField, navigation, isEditing, disableClick]
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

	return {
		ref: cellRef,
		cellState,
		isFocused,
		isSelected,
		isEditing,
		isLoading: api.isRowLoading(rowId),
		api,
		cellProps: {
			ref: cellRef,
			tabIndex: -1,
			className: combinedClassName,
			'data-col-field': colField,
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
	isLoading?: boolean;
	renderValue?: (value: unknown, computedValue: unknown) => React.ReactNode;
}

/**
 * High-performance, plug-and-play Grid Cell component.
 * Evaluates O(1) state transitions under React Scan, handling inputs, blurs, commits, and style overlays.
 */
const CellComponent = <TRowData,>(props: CellProps<TRowData>) => {
	const { rowId, colField, renderValue } = props;
	const { cellProps, cellState, isEditing, api, isLoading } = useGridCellProps<TRowData>(props);

	if (isLoading) {
		return (
			<div className='flex items-center px-3 h-full border-r border-slate-800 text-sm select-none relative transition-colors duration-75 outline-none bg-slate-950 text-slate-300 w-full'>
				<div className='h-3 w-4/5 bg-slate-800/40 rounded animate-pulse' />
			</div>
		);
	}

	// Tiny, fast, isolated typing state
	const [localValue, setLocalValue] = useState<unknown>(cellState.value);

	const localValueRef = useRef(localValue);
	localValueRef.current = localValue;

	const isCancelledRef = useRef(false);
	const isCommittedRef = useRef(!isEditing);

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
		return api.getColumnDef(colField);
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

// ============================================================================
// Unified & Modular Headless Grid Dimensions Hook
// ============================================================================

export interface UseGridDimensionsOptions<TRowData = any> {
	// Pinned configuration (0 = disabled)
	pinLeftColumns?: number;
	pinRightColumns?: number;
	pinTopRows?: number;
	pinBottomRows?: number;

	// Server-side loader controller (optional)
	serverController?: ServerRowModelController<TRowData>;

	// Feature opt-in / opt-out controls
	enableNavigation?: boolean; // Default true
	navigationOptions?: {
		editTrigger?: 'singleClick' | 'doubleClick';
		arrowKeyNavigationEdit?: boolean;
		onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	};
}

export interface UseGridDimensionsResult<TRowData = unknown> {
	viewportRef: React.RefObject<HTMLDivElement>;
	scrollerRef: React.RefObject<HTMLDivElement>;
	containerRef: React.RefObject<HTMLDivElement>; // Legacy alias to scrollerRef
	headerRef: React.RefObject<HTMLDivElement>;
	pinnedLeftRef: React.RefObject<HTMLDivElement>;
	pinnedRightRef: React.RefObject<HTMLDivElement>;
	horizontalScrollerRef: React.RefObject<HTMLDivElement>;
	totalWidth: number;
	totalHeight: number;
	leftPinnedWidth: number;
	rightPinnedWidth: number;
	columns: ColumnDef<TRowData>[];
	scrollState: { scrollTop: number; scrollLeft: number };
	dimensions: { width: number; height: number };
	leftPinnedCols: Array<{ index: number; field: string; header: string; left: number; width: number }>;
	rightPinnedCols: Array<{ index: number; field: string; header: string; left: number; width: number }>;
	centerCols: Array<{ index: number; field: string; header: string; left: number; width: number }>;
	visibleRows: Array<{ index: number; id: string; top: number; height: number }>;
	api: GridApi<TRowData>;
	navigation: GridNavigationController<TRowData>;
	handleHeaderResizeMouseDown: (colField: string, currentWidth: number, e: React.MouseEvent) => void;
}

/**
 * Headless hook coordinating grid size, scroll synchronization, pinned lanes, overscan queries,
 * header resizes, and arrow navigation key hooks, fully supporting custom custom styles.
 */
export function useGridDimensions<TRowData = unknown>(options: UseGridDimensionsOptions<TRowData> = {}): UseGridDimensionsResult<TRowData> {
	const {
		pinLeftColumns = 0,
		pinRightColumns = 0,
		pinTopRows = 0,
		pinBottomRows = 0,
		serverController,
		enableNavigation = true,
		navigationOptions = {},
	} = options;

	const viewportRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const containerRef = scrollerRef; // Legacy alias
	const headerRef = useRef<HTMLDivElement>(null);
	const pinnedLeftRef = useRef<HTMLDivElement>(null);
	const pinnedRightRef = useRef<HTMLDivElement>(null);
	const horizontalScrollerRef = useRef<HTMLDivElement>(null);
	// Scroll position kept in a ref — scroll alone never causes a React re-render.
	// Only visible range crossings (stored in GridState) trigger re-renders.
	const scrollStateRef = useRef({ scrollTop: 0, scrollLeft: 0 });
	const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

	const api = useGridApi<TRowData>();
	const store = useGridStore<TRowData>();

	// Sync pin configuration with ViewportController
	useEffect(() => {
		store.viewportController.pinLeftColumns = pinLeftColumns;
		store.viewportController.pinRightColumns = pinRightColumns;
		store.viewportController.pinTopRows = pinTopRows;
		store.viewportController.pinBottomRows = pinBottomRows;
	}, [store, pinLeftColumns, pinRightColumns, pinTopRows, pinBottomRows]);

	// ResizeObserver: track container dimensions
	useEffect(() => {
		const target = viewportRef.current || scrollerRef.current;
		if (!target) return;

		const rect = target.getBoundingClientRect();
		store.viewportController.setViewportSize(rect.width, rect.height);
		store.viewportController.updateVisibleRanges(store);
		setDimensions({ width: rect.width, height: rect.height });

		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver((entries) => {
			if (!entries || entries.length === 0) return;
			const { width, height } = entries[0].contentRect;
			if (store.viewportController.setViewportSize(width, height)) {
				store.viewportController.updateVisibleRanges(store);
				setDimensions({ width, height });
			}
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, [store]);

	// Scroll handler: pure DOM work + viewport range update.
	// scrollStateRef update is a ref mutation — zero React renders from scroll events.
	// Re-renders happen only when visibleRowRange/visibleColRange change (store key notification).
	const handleScroll = useCallback(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;

		const hScroller = horizontalScrollerRef.current;
		const sTop = scroller.scrollTop;
		const sLeft = hScroller ? hScroller.scrollLeft : scroller.scrollLeft;

		// Sync header scroll position directly (DOM mutation, no React)
		if (headerRef.current) headerRef.current.scrollLeft = sLeft;

		// Update velocity + scroll position in the viewport controller
		store.viewportController.setScrollPosition(sTop, sLeft, performance.now());

		// Update scroll ref (no re-render)
		scrollStateRef.current = { scrollTop: sTop, scrollLeft: sLeft };

		// Update visible ranges — this fires store notifications which drive re-renders
		// only when a range boundary is crossed (not every scroll pixel)
		store.viewportController.updateVisibleRanges(store);
	}, [store]);

	useEffect(() => {
		const scroller = scrollerRef.current;
		const hScroller = horizontalScrollerRef.current;
		if (!scroller) return;
		scroller.addEventListener('scroll', handleScroll, { passive: true });
		if (hScroller) hScroller.addEventListener('scroll', handleScroll, { passive: true });
		return () => {
			scroller.removeEventListener('scroll', handleScroll);
			if (hScroller) hScroller.removeEventListener('scroll', handleScroll);
		};
	}, [handleScroll]);

	// Navigation controller
	const navigation = useGridNavigationController<TRowData>({
		onCellValueChanged: (rowId, colField, val) => {
			if (enableNavigation) navigationOptions.onCellValueChanged?.(rowId, colField, val);
		},
		editTrigger: navigationOptions.editTrigger ?? 'doubleClick',
		arrowKeyNavigationEdit: navigationOptions.arrowKeyNavigationEdit ?? false,
	});

	useEffect(() => {
		if (!enableNavigation) return;
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			const activeEl = document.activeElement;
			const isInside = containerRef.current?.contains(activeEl) || activeEl === document.body;
			if (isInside) navigation.handleKeyDown(e);
		};
		window.addEventListener('keydown', handleGlobalKeyDown);
		window.addEventListener('mouseup', navigation.handleMouseUp);
		return () => {
			window.removeEventListener('keydown', handleGlobalKeyDown);
			window.removeEventListener('mouseup', navigation.handleMouseUp);
		};
	}, [navigation, enableNavigation]);

	// Reactive subscriptions that drive re-renders
	const columns = useGridKeySelector<ColumnDef<TRowData>[], TRowData>('columns', (state) => state.columns as ColumnDef<TRowData>[]);
	const dataVersion = useGridKeySelector<number, TRowData>('dataVersion', (state) => state.dataVersion);
	const columnWidths = useGridKeySelector<Record<string, number>, TRowData>('columnWidths', (state) => state.columnWidths);

	// Visible range subscriptions: re-render only when range boundaries are crossed
	const visibleRowRange = useGridKeySelector<ViewportRange, TRowData>('visibleRowRange', (state) => state.visibleRowRange);
	const visibleColRange = useGridKeySelector<ViewportRange, TRowData>('visibleColRange', (state) => state.visibleColRange);

	const rowModel = store.getRowModel();
	const rowCount = rowModel ? rowModel.getRowCount() : 0;
	const colCount = columns.length;

	// Derive layout values from columnWidths (stable reference from store, changes only on resize commit)
	const totalWidth = useMemo(() => store.columnController.getTotalWidth(), [columnWidths, colCount]);
	const totalHeight = useMemo(() => store.rowController.getTotalHeight(), [dataVersion, rowCount]);

	const leftPinnedWidth = useMemo(() => {
		let w = 0;
		for (let i = 0; i < pinLeftColumns && i < colCount; i++) w += store.columnController.getColWidth(i);
		return w;
	}, [columnWidths, pinLeftColumns, colCount]);

	const rightPinnedWidth = useMemo(() => {
		let w = 0;
		for (let i = 0; i < pinRightColumns && i < colCount; i++) w += store.columnController.getColWidth(colCount - 1 - i);
		return w;
	}, [columnWidths, pinRightColumns, colCount]);

	const leftPinnedCols = useMemo(() => {
		const cols = [];
		for (let i = 0; i < pinLeftColumns && i < colCount; i++) {
			cols.push({
				index: i,
				field: columns[i].field,
				header: columns[i].header,
				left: store.columnController.getColLeft(i),
				width: store.columnController.getColWidth(i),
			});
		}
		return cols;
	}, [columnWidths, pinLeftColumns, colCount, columns]);

	const rightPinnedCols = useMemo(() => {
		const cols = [];
		const startIdx = colCount - pinRightColumns;
		let cumulativeLeft = 0;
		for (let i = startIdx; i < colCount && i >= 0; i++) {
			const width = store.columnController.getColWidth(i);
			cols.push({
				index: i,
				field: columns[i].field,
				header: columns[i].header,
				left: cumulativeLeft,
				width,
			});
			cumulativeLeft += width;
		}
		return cols;
	}, [columnWidths, pinRightColumns, colCount, columns]);

	const centerCols = useMemo(() => {
		const cols = [];
		const start = Math.max(pinLeftColumns, visibleColRange.startIdx);
		const end = Math.min(colCount - 1 - pinRightColumns, visibleColRange.endIdx);
		// Overscan: 3 columns each side for smoother horizontal scrolling
		const overscanStart = Math.max(start - 3, pinLeftColumns);
		const overscanEnd = Math.min(end + 3, colCount - 1 - pinRightColumns);
		for (let i = overscanStart; i <= overscanEnd && i < colCount; i++) {
			if (i < pinLeftColumns || i >= colCount - pinRightColumns) continue;
			cols.push({
				index: i,
				field: columns[i].field,
				header: columns[i].header,
				left: store.columnController.getColLeft(i),
				width: store.columnController.getColWidth(i),
			});
		}
		return cols;
	}, [columnWidths, visibleColRange.startIdx, visibleColRange.endIdx, pinLeftColumns, pinRightColumns, colCount, columns]);

	const visibleRows = useMemo(() => {
		if (!rowModel) return [];
		const rows = [];
		const { startIdx, endIdx } = visibleRowRange;
		for (let i = startIdx; i <= endIdx && i < rowCount; i++) {
			const node = rowModel.getRowNode(i);
			const id = node ? node.id : `__loading_${i}__`;
			rows.push({
				index: i,
				id,
				top: store.rowController.getRowTop(i),
				height: store.rowController.getRowHeight(i),
			});
		}
		return rows;
	}, [rowModel, visibleRowRange, rowCount, dataVersion]);

	useEffect(() => {
		if (serverController && visibleRows.length > 0) {
			serverController.loadVisibleBlocks(visibleRows.map((row) => row.index));
		}
	}, [visibleRows, serverController]);

	// -------------------------------------------------------------------------
	// DOM-first column resize (AG-Grid / TanStack approach)
	// During drag: inject a <style> rule targeting [data-col-field] attributes.
	// Zero React re-renders during drag. Single setColumnWidth commit on mouseup.
	// -------------------------------------------------------------------------
	const resizeStyleRef = useRef<HTMLStyleElement | null>(null);

	const handleHeaderResizeMouseDown = useCallback(
		(colField: string, currentWidth: number, e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			// Lazily create the style element once
			if (!resizeStyleRef.current) {
				const style = document.createElement('style');
				document.head.appendChild(style);
				resizeStyleRef.current = style;
			}

			const startX = e.clientX;
			const startWidth = currentWidth;
			let liveWidth = startWidth;

			// Apply resize cursor to body during drag
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const deltaX = moveEvent.clientX - startX;
				liveWidth = Math.max(60, startWidth + deltaX);
				const activeDeltaX = liveWidth - startWidth;

				let css = `[data-col-field] [data-col-field] { left: auto !important; right: auto !important; width: 100% !important; min-width: 0 !important; max-width: none !important; }\n`;
				css += `[data-col-field="${colField}"] { width: ${liveWidth}px !important; min-width: ${liveWidth}px !important; max-width: ${liveWidth}px !important; }\n`;

				const colIndex = columns.findIndex((c) => c.field === colField);
				if (colIndex === -1) return;

				const isLeftPinned = colIndex < pinLeftColumns;
				const isRightPinned = colIndex >= columns.length - pinRightColumns;
				const isCenter = !isLeftPinned && !isRightPinned;
				const innerCenterWidth = Math.max(0, totalWidth - leftPinnedWidth - rightPinnedWidth);

				if (isLeftPinned) {
					// 1. Shift subsequent left pinned columns
					leftPinnedCols.forEach((col) => {
						if (col.index > colIndex) {
							css += `[data-col-field="${col.field}"] { left: ${col.left + activeDeltaX}px !important; }\n`;
						}
					});
					// 2. Adjust left pinned lanes width
					css += `[data-pinned-lane="left"] { width: ${leftPinnedWidth + activeDeltaX}px !important; }\n`;
					// 3. Shift center header lane left style
					css += `[data-lane="center-header"] { left: ${leftPinnedWidth + activeDeltaX}px !important; }\n`;
				} else if (isCenter) {
					// 1. Shift subsequent center columns
					centerCols.forEach((col) => {
						if (col.index > colIndex) {
							css += `[data-col-field="${col.field}"] { left: ${col.left - leftPinnedWidth + activeDeltaX}px !important; }\n`;
						}
					});
					// 2. Adjust center lane widths
					css += `[data-lane="center-header-inner"] { width: ${innerCenterWidth + activeDeltaX}px !important; }\n`;
					css += `[data-lane="center-cells"] { width: ${innerCenterWidth + activeDeltaX}px !important; }\n`;
				} else if (isRightPinned) {
					// 1. Shift subsequent right pinned columns
					rightPinnedCols.forEach((col) => {
						if (col.index > colIndex) {
							css += `[data-col-field="${col.field}"] { left: ${col.left + activeDeltaX}px !important; }\n`;
						}
					});
					// 2. Adjust right pinned lanes width
					css += `[data-pinned-lane="right"] { width: ${rightPinnedWidth + activeDeltaX}px !important; }\n`;
					// 3. Adjust center header lane right style
					css += `[data-lane="center-header"] { right: ${rightPinnedWidth + activeDeltaX}px !important; }\n`;
				}

				// Adjust the total width of the scroller's child container
				css += `[data-grid-scroller-child] { width: ${totalWidth + activeDeltaX}px !important; }\n`;

				resizeStyleRef.current!.textContent = css;
			};

			const handleMouseUp = () => {
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				// Clear the CSS override
				if (resizeStyleRef.current) resizeStyleRef.current.textContent = '';
				// Commit final width to store exactly once
				if (liveWidth !== startWidth) store.setColumnWidth(colField, liveWidth);
			};

			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		},
		[
			store,
			columns,
			leftPinnedCols,
			centerCols,
			rightPinnedCols,
			leftPinnedWidth,
			rightPinnedWidth,
			totalWidth,
			pinLeftColumns,
			pinRightColumns,
		]
	);

	// Cleanup style element on unmount
	useEffect(() => {
		return () => {
			if (resizeStyleRef.current) {
				resizeStyleRef.current.remove();
				resizeStyleRef.current = null;
			}
		};
	}, []);

	return {
		viewportRef,
		scrollerRef,
		containerRef,
		headerRef,
		pinnedLeftRef,
		pinnedRightRef,
		horizontalScrollerRef,
		totalWidth,
		totalHeight,
		leftPinnedWidth,
		rightPinnedWidth,
		columns,
		scrollState: scrollStateRef.current,
		dimensions,
		leftPinnedCols,
		rightPinnedCols,
		centerCols,
		visibleRows,
		api,
		navigation,
		handleHeaderResizeMouseDown,
	};
}
