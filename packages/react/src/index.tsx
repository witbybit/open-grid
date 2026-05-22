import React, { createContext, useContext, useMemo, useSyncExternalStore, useRef, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { GridStore, GridState, GridNavigationController, GridNavigationOptions, GridApi, RenderEngine } from '@open-grid/core';

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
		store.registerPlugin(nav);
		return nav;
	}, [store]);

	useEffect(() => () => controller.dispose(), [controller]);

	return controller;
}

export interface PortalCellProps {
	rowId: string;
	colField: string;
	value: unknown;
	col: any;
	node: any;
	isEditing: boolean;
	isLoading: boolean;
}

/**
 * Clean React Portal cell adapter that mounts only custom renderers & custom editors.
 */
export function PortalCell({ rowId, colField, value, col, node, isEditing, isLoading }: PortalCellProps) {
	const api = useGridApi();

	const [localValue, setLocalValue] = useState<unknown>(value);

	const localValueRef = useRef(localValue);
	localValueRef.current = localValue;

	const isCancelledRef = useRef(false);
	const isCommittedRef = useRef(!isEditing);

	useEffect(() => {
		if (isEditing) {
			isCancelledRef.current = false;
			isCommittedRef.current = false;
			setLocalValue(value);
		}
	}, [isEditing, value]);

	useEffect(() => {
		const unsubscribe = api.addEventListener<{ rowId: string; colField: string; cancel: boolean }>('editStopped', (event) => {
			if (event.payload.rowId === rowId && event.payload.colField === colField) {
				if (event.payload.cancel) {
					isCancelledRef.current = true;
				}
			}
		});
		return () => {
			unsubscribe();
			if (isEditing && !isCancelledRef.current && !isCommittedRef.current) {
				isCommittedRef.current = true;
				api.setCellValue(rowId, colField, localValueRef.current);
			}
		};
	}, [isEditing, api, rowId, colField]);

	const handleCommit = useCallback(
		(finalValue?: unknown) => {
			isCommittedRef.current = true;
			const isEvent = finalValue && typeof finalValue === 'object' && ('nativeEvent' in finalValue || 'target' in finalValue);
			const valToCommit = finalValue !== undefined && !isEvent ? finalValue : localValueRef.current;
			api.setCellValue(rowId, colField, valToCommit);
			api.stopEditing();
		},
		[api, rowId, colField]
	);

	const handleCancel = useCallback(() => {
		isCancelledRef.current = true;
		api.stopEditing(true);
	}, [api]);

	if (isLoading) {
		return (
			<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
				<div style={{ height: '12px', width: '80%', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '4px' }} />
			</div>
		);
	}

	const rowData = node?.data;

	const CustomEditor = col?.cellEditor;
	const CustomRenderer = col?.cellRenderer;

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
			{isEditing ? (
				CustomEditor ? (
					<CustomEditor
						rowId={rowId}
						colField={colField}
						value={localValue}
						onChange={(val: any) => {
							setLocalValue(val);
							localValueRef.current = val;
						}}
						api={api}
						onCommit={handleCommit}
						onCancel={handleCancel}
					/>
				) : (
					<input
						autoFocus
						className='absolute inset-0 w-full h-full px-3 text-sm bg-slate-900 text-white border-2 border-purple-500 outline-none z-20'
						value={typeof localValue === 'string' || typeof localValue === 'number' ? String(localValue) : ''}
						onChange={(e) => {
							setLocalValue(e.target.value);
							localValueRef.current = e.target.value;
						}}
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
				<CustomRenderer value={value} computedValue={value} row={rowData} rowId={rowId} colField={colField} api={api} />
			) : null}
		</div>
	);
}

export interface PortalData {
	cellKey: string;
	container: HTMLElement;
	value: unknown;
	node: any;
	col: any;
	isEditing: boolean;
	isLoading: boolean;
}

export interface PortalManagerProps {
	portals: Map<string, PortalData>;
	store: GridStore<any>;
}

export function PortalManager({ portals, store }: PortalManagerProps) {
	return (
		<>
			{Array.from(portals.values()).map((p) => {
				return createPortal(
					<GridProvider store={store} key={p.cellKey}>
						<PortalCell
							rowId={p.node.id}
							colField={p.col.field}
							value={p.value}
							col={p.col}
							node={p.node}
							isEditing={p.isEditing}
							isLoading={p.isLoading}
						/>
					</GridProvider>,
					p.container
				);
			})}
		</>
	);
}

export interface OpenGridProps<TRowData = unknown> {
	store?: GridStore<TRowData>;
	pinLeftColumns?: number;
	pinRightColumns?: number;
	pinTopRows?: number;
	pinBottomRows?: number;
	enableNavigation?: boolean;
	navigationOptions?: {
		editTrigger?: 'singleClick' | 'doubleClick';
		arrowKeyNavigationEdit?: boolean;
		onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	};
}

export function OpenGrid<TRowData = unknown>(props: OpenGridProps<TRowData>) {
	const contextStore = useContext(GridContext);
	const store = props.store || (contextStore as unknown as GridStore<TRowData>);

	if (!store) {
		throw new Error('OpenGrid must be provided a store either via props or GridProvider context.');
	}

	return (
		<GridProvider store={store}>
			<OpenGridInner {...props} store={store} />
		</GridProvider>
	);
}

function OpenGridInner<TRowData = unknown>({
	store,
	pinLeftColumns = 0,
	pinRightColumns = 0,
	pinTopRows = 0,
	pinBottomRows = 0,
	enableNavigation = true,
	navigationOptions = {},
}: OpenGridProps<TRowData> & { store: GridStore<TRowData> }) {
	const [portals, setPortals] = useState<Map<string, PortalData>>(new Map());
	const containerRef = useRef<HTMLDivElement>(null);
	const renderEngineRef = useRef<RenderEngine | null>(null);

	const mountPortal = useCallback(
		(cellKey: string, container: HTMLElement, value: unknown, node: any, col: any, isEditing: boolean, isLoading: boolean) => {
			setPortals((prev) => {
				const existing = prev.get(cellKey);
				if (
					existing &&
					existing.container === container &&
					existing.value === value &&
					existing.node === node &&
					existing.col === col &&
					existing.isEditing === isEditing &&
					existing.isLoading === isLoading
				) {
					return prev;
				}
				const next = new Map(prev);
				next.set(cellKey, { cellKey, container, value, node, col, isEditing, isLoading });
				return next;
			});
		},
		[]
	);

	const unmountPortal = useCallback((cellKey: string) => {
		setPortals((prev) => {
			if (!prev.has(cellKey)) return prev;
			const next = new Map(prev);
			next.delete(cellKey);
			return next;
		});
	}, []);

	// Sync pin configuration with ViewportController
	useEffect(() => {
		store.viewportController.pinLeftColumns = pinLeftColumns;
		store.viewportController.pinRightColumns = pinRightColumns;
		store.viewportController.pinTopRows = pinTopRows;
		store.viewportController.pinBottomRows = pinBottomRows;
	}, [store, pinLeftColumns, pinRightColumns, pinTopRows, pinBottomRows]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Create and mount RenderEngine
		const renderEngine = new RenderEngine(store.engine);
		renderEngineRef.current = renderEngine;

		// Bind portal callbacks
		renderEngine.onMountReactPortal = mountPortal;
		renderEngine.onUnmountReactPortal = unmountPortal;

		// Mount the engine
		renderEngine.mount(container);

		// Handle resize observer
		const observer = new ResizeObserver((entries) => {
			if (!entries || entries.length === 0) return;
			const { width, height } = entries[0].contentRect;
			if (store.viewportController.setViewportSize(width, height)) {
				store.viewportController.updateVisibleRanges(store);
				renderEngine.schedulePaint();
			}
		});
		observer.observe(container);

		return () => {
			observer.disconnect();
			renderEngine.unmount();
			renderEngineRef.current = null;
		};
	}, [store, mountPortal, unmountPortal]);

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
			const container = containerRef.current;
			const isInside = container?.contains(activeEl) || activeEl === document.body;
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

	const handleMouseDown = useCallback(
		(e: MouseEvent) => {
			const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
			if (!cellEl) return;
			const colField = cellEl.dataset.colField;
			const rowEl = cellEl.closest('.og-row') as HTMLElement;
			const rowId = rowEl?.dataset.rowId;
			if (!colField || !rowId) return;

			const state = store.getState();
			const isEditing = state.activeEdit?.rowId === rowId && state.activeEdit?.colField === colField;
			if (isEditing) return;

			cellEl.focus();
			navigation.handleMouseDown(rowId, colField, e);
		},
		[store, navigation]
	);

	const handleMouseOver = useCallback(
		(e: MouseEvent) => {
			const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
			if (!cellEl) return;
			const colField = cellEl.dataset.colField;
			const rowEl = cellEl.closest('.og-row') as HTMLElement;
			const rowId = rowEl?.dataset.rowId;
			if (!colField || !rowId) return;

			if (e.relatedTarget && cellEl.contains(e.relatedTarget as Node)) return;

			navigation.handleMouseEnter(rowId, colField);
		},
		[navigation]
	);

	const handleClick = useCallback(
		(e: MouseEvent) => {
			const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
			if (!cellEl) return;
			const colField = cellEl.dataset.colField;
			const rowEl = cellEl.closest('.og-row') as HTMLElement;
			const rowId = rowEl?.dataset.rowId;
			if (!colField || !rowId) return;

			const state = store.getState();
			const isEditing = state.activeEdit?.rowId === rowId && state.activeEdit?.colField === colField;
			if (isEditing) return;

			navigation.handleClick(rowId, colField, e);
		},
		[store, navigation]
	);

	const handleDoubleClick = useCallback(
		(e: MouseEvent) => {
			const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
			if (!cellEl) return;
			const colField = cellEl.dataset.colField;
			const rowEl = cellEl.closest('.og-row') as HTMLElement;
			const rowId = rowEl?.dataset.rowId;
			if (!colField || !rowId) return;

			const state = store.getState();
			const isEditing = state.activeEdit?.rowId === rowId && state.activeEdit?.colField === colField;
			if (isEditing) return;

			navigation.setCellEditing(rowId, colField, true);
		},
		[store, navigation]
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		container.addEventListener('mousedown', handleMouseDown);
		container.addEventListener('mouseover', handleMouseOver);
		container.addEventListener('click', handleClick);
		container.addEventListener('dblclick', handleDoubleClick);

		return () => {
			container.removeEventListener('mousedown', handleMouseDown);
			container.removeEventListener('mouseover', handleMouseOver);
			container.removeEventListener('click', handleClick);
			container.removeEventListener('dblclick', handleDoubleClick);
		};
	}, [handleMouseDown, handleMouseOver, handleClick, handleDoubleClick]);

	return (
		<div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
			<PortalManager portals={portals} store={store} />
		</div>
	);
}
