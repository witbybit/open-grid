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
		const bounds = s.selectedRangeBounds;
		if (bounds) {
			const rowModel = store.getRowModel();
			if (rowModel) {
				const currentIdx = rowModel.getRowIndexById(rowId);
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
		const cellState = api.getCellState(rowId, colField);
		const isFocused = state.focusedCell?.rowId === rowId && state.focusedCell?.colField === colField;

		let isSelected = false;
		const bounds = state.selectedRangeBounds;
		if (bounds) {
			const rowModel = api.getRowModel();
			if (rowModel) {
				const currentIdx = rowModel.getRowIndexById(rowId);
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
	const containerRef = scrollerRef; // Legacy alias to scrollerRef
	const headerRef = useRef<HTMLDivElement>(null);
	const pinnedLeftRef = useRef<HTMLDivElement>(null);
	const pinnedRightRef = useRef<HTMLDivElement>(null);
	const horizontalScrollerRef = useRef<HTMLDivElement>(null);
	const scrollTimeoutRef = useRef<any>(null);

	const api = useGridApi<TRowData>();
	const store = useGridStore<TRowData>();

	const [scrollState, setScrollState] = useState({ scrollTop: 0, scrollLeft: 0 });
	const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

	// Sync pin configuration with ViewportController
	useEffect(() => {
		store.viewportController.pinLeftColumns = pinLeftColumns;
		store.viewportController.pinRightColumns = pinRightColumns;
		store.viewportController.pinTopRows = pinTopRows;
		store.viewportController.pinBottomRows = pinBottomRows;
	}, [store, pinLeftColumns, pinRightColumns, pinTopRows, pinBottomRows]);

	// Setup ResizeObserver to track container viewport size
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
			const sizeChanged = store.viewportController.setViewportSize(width, height);
			if (sizeChanged) {
				store.viewportController.updateVisibleRanges(store);
			}
			setDimensions({ width, height });
		});

		observer.observe(target);
		return () => observer.disconnect();
	}, [store]);

	// Handle scroll events synchronously to prevent blank pages on scroll
	const handleScroll = useCallback(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;

		const hScroller = horizontalScrollerRef.current;
		const sTop = scroller.scrollTop;
		const sLeft = hScroller ? hScroller.scrollLeft : scroller.scrollLeft;

		// 1. Direct DOM Update for horizontal header scroll synchronization
		if (headerRef.current) {
			headerRef.current.scrollLeft = sLeft;
		}

		// 2. Core viewport state update (synchronous)
		store.viewportController.setScrollPosition(sTop, sLeft);

		// 3. Update visible ranges in core and notify subscribers if boundary crossed
		const rangeChanged = store.viewportController.updateVisibleRanges(store);

		// 4. Update React scrollState to trigger re-renders only on boundary crossing, otherwise debounce
		if (rangeChanged) {
			setScrollState({ scrollTop: sTop, scrollLeft: sLeft });
		} else {
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}
			scrollTimeoutRef.current = setTimeout(() => {
				setScrollState({ scrollTop: sTop, scrollLeft: sLeft });
			}, 150);
		}
	}, [store]);

	// Listen to scroll events on both vertical (outer) and horizontal (center) scrollers
	useEffect(() => {
		const scroller = scrollerRef.current;
		const hScroller = horizontalScrollerRef.current;
		if (!scroller) return;

		scroller.addEventListener('scroll', handleScroll, { passive: true });
		if (hScroller) {
			hScroller.addEventListener('scroll', handleScroll, { passive: true });
		}

		return () => {
			scroller.removeEventListener('scroll', handleScroll);
			if (hScroller) {
				hScroller.removeEventListener('scroll', handleScroll);
			}
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}
		};
	}, [handleScroll]);

	// Setup navigation controller (opt-in / opt-out)
	const navigation = useGridNavigationController<TRowData>({
		onCellValueChanged: (rowId, colField, val) => {
			if (enableNavigation) {
				navigationOptions.onCellValueChanged?.(rowId, colField, val);
			}
		},
		editTrigger: navigationOptions.editTrigger ?? 'doubleClick',
		arrowKeyNavigationEdit: navigationOptions.arrowKeyNavigationEdit ?? false,
	});

	// Keyboard and mouse navigation listeners (opt-in / opt-out)
	useEffect(() => {
		if (!enableNavigation) return;

		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			const activeEl = document.activeElement;
			const isInside = containerRef.current?.contains(activeEl) || activeEl === document.body;
			if (isInside) {
				navigation.handleKeyDown(e);
			}
		};

		window.addEventListener('keydown', handleGlobalKeyDown);
		window.addEventListener('mouseup', navigation.handleMouseUp);
		return () => {
			window.removeEventListener('keydown', handleGlobalKeyDown);
			window.removeEventListener('mouseup', navigation.handleMouseUp);
		};
	}, [navigation, enableNavigation]);

	// Subscribe to store key changes so we re-render on grid structural updates
	const columns = useGridKeySelector<ColumnDef<TRowData>[], TRowData>('columns', (state) => state.columns as ColumnDef<TRowData>[]);
	const dataVersion = useGridKeySelector<number, TRowData>('dataVersion', (state) => state.dataVersion);
	const columnWidths = useGridKeySelector<Record<string, number>, TRowData>('columnWidths', (state) => state.columnWidths);
	const rowHeights = useGridKeySelector<Record<string, number>, TRowData>('rowHeights', (state) => state.rowHeights);

	// Subscribe to visible index ranges from core GridState to limit React re-renders strictly to range crossings
	const visibleRowRange = useGridKeySelector<ViewportRange, TRowData>('visibleRowRange', (state) => state.visibleRowRange);
	const visibleColRange = useGridKeySelector<ViewportRange, TRowData>('visibleColRange', (state) => state.visibleColRange);

	const rowModel = store.getRowModel();
	const rowCount = rowModel ? rowModel.getRowCount() : 0;
	const colCount = columns.length;

	// Calculate total sizes
	const totalWidth = useMemo(() => store.columnController.getTotalWidth(), [columns, columnWidths, dataVersion, store]);
	const totalHeight = useMemo(() => store.rowController.getTotalHeight(), [rowCount, rowHeights, dataVersion, store]);

	// Calculate width occupied by pinned columns
	const leftPinnedWidth = useMemo(() => {
		let w = 0;
		for (let i = 0; i < pinLeftColumns && i < colCount; i++) {
			w += store.columnController.getColWidth(i);
		}
		return w;
	}, [columns, columnWidths, pinLeftColumns, colCount, dataVersion, store]);

	const rightPinnedWidth = useMemo(() => {
		let w = 0;
		for (let i = 0; i < pinRightColumns && i < colCount; i++) {
			w += store.columnController.getColWidth(colCount - 1 - i);
		}
		return w;
	}, [columns, columnWidths, pinRightColumns, colCount, dataVersion, store]);

	// Generate Pinned Left Columns
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
	}, [columns, columnWidths, pinLeftColumns, colCount, dataVersion, store]);

	// Generate Pinned Right Columns
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
	}, [columns, columnWidths, pinRightColumns, colCount, dataVersion, store]);

	// Generate scrollable center columns inside center range (excluding left/right pinned)
	const centerCols = useMemo(() => {
		const cols = [];
		const start = Math.max(pinLeftColumns, visibleColRange.startIdx);
		const end = Math.min(colCount - 1 - pinRightColumns, visibleColRange.endIdx);
		for (let i = start; i <= end && i < colCount; i++) {
			if (i < 0) continue;
			cols.push({
				index: i,
				field: columns[i].field,
				header: columns[i].header,
				left: store.columnController.getColLeft(i),
				width: store.columnController.getColWidth(i),
			});
		}
		return cols;
	}, [columns, columnWidths, visibleColRange.startIdx, visibleColRange.endIdx, pinLeftColumns, pinRightColumns, colCount, dataVersion, store]);

	// Generate visible rows inside row range
	const visibleRows = useMemo(() => {
		const rows = [];
		if (rowModel) {
			for (let i = visibleRowRange.startIdx; i <= visibleRowRange.endIdx && i < rowCount; i++) {
				const row = rowModel.getRow(i);
				const id = row ? store.getRowId(row) : `__loading_${i}__`;
				rows.push({
					index: i,
					id,
					top: store.rowController.getRowTop(i),
					height: store.rowController.getRowHeight(i),
				});
			}
		}
		return rows;
	}, [rowModel, rowHeights, visibleRowRange.startIdx, visibleRowRange.endIdx, rowCount, store, dataVersion]);

	// Notify server block loader on scrolling visible row indexes
	useEffect(() => {
		if (serverController && visibleRows.length > 0) {
			serverController.loadVisibleBlocks(visibleRows.map((row) => row.index));
		}
	}, [visibleRows, serverController]);

	// Handle column resizing mouse down
	const handleHeaderResizeMouseDown = useCallback(
		(colField: string, currentWidth: number, e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			const startX = e.clientX;
			const startWidth = currentWidth;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const deltaX = moveEvent.clientX - startX;
				const nextWidth = Math.max(60, startWidth + deltaX);
				store.setColumnWidth(colField, nextWidth);
			};

			const handleMouseUp = () => {
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			};

			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		},
		[store]
	);

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
		scrollState,
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
