import {
	GridApi,
	GridContextMenuOptions,
	GridContextMenuPlugin,
	GridNavigationController,
	GridNavigationOptions,
	GridState,
	GridStore,
	RenderEngine,
} from '@open-grid/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PortalData, PortalManager } from './GridPortal';
import { createGridApiFacade } from './gridApiFacade';

export const GridStoreContext = createContext<GridStore<unknown> | null>(null);
const GridApiContext = createContext<GridApi<unknown> | null>(null);

export interface GridProviderProps<TRowData = unknown> {
	store: GridStore<TRowData>;
	children: React.ReactNode;
}

export function GridProvider<TRowData = unknown>({ store, children }: GridProviderProps<TRowData>) {
	const api = useMemo(() => createGridApiFacade(store), [store]);
	return (
		<GridStoreContext.Provider value={store as unknown as GridStore<unknown>}>
			<GridApiContext.Provider value={api as unknown as GridApi<unknown>}>{children}</GridApiContext.Provider>
		</GridStoreContext.Provider>
	);
}

export function useGridStore<TRowData = unknown>(): GridStore<TRowData> {
	const context = useContext(GridStoreContext);
	if (!context) {
		throw new Error('useGridStore must be used within a GridProvider');
	}
	return context as unknown as GridStore<TRowData>;
}

export function useGridApi<TRowData = unknown>(): GridApi<TRowData> {
	const context = useContext(GridApiContext);
	if (!context) {
		throw new Error('useGridApi must be used within a GridProvider');
	}
	return context as unknown as GridApi<TRowData>;
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

export interface OpenGridProps<TRowData = unknown> {
	store?: GridStore<TRowData>;
	pinLeftColumns?: number;
	pinRightColumns?: number;
	pinTopRows?: number;
	pinBottomRows?: number;
	enableColumnReorder?: boolean;
	enableNavigation?: boolean;
	enableContextMenu?: boolean;
	contextMenuOptions?: GridContextMenuOptions<TRowData>;
	navigationOptions?: {
		editTrigger?: 'singleClick' | 'doubleClick';
		arrowKeyNavigationEdit?: boolean;
		onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	};
}

export function OpenGrid<TRowData = unknown>(props: OpenGridProps<TRowData>) {
	const contextStore = useContext(GridStoreContext);
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
	enableColumnReorder,
	enableNavigation = true,
	enableContextMenu = true,
	contextMenuOptions,
	navigationOptions = {},
}: OpenGridProps<TRowData> & { store: GridStore<TRowData> }) {
	const [portals, setPortals] = useState<Map<string, PortalData>>(new Map());
	const containerRef = useRef<HTMLDivElement>(null);
	const renderEngineRef = useRef<RenderEngine | null>(null);
	const isGridActiveRef = useRef(false);

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
		if (enableColumnReorder !== undefined) {
			store.setColumnReorderEnabled(enableColumnReorder);
		}
	}, [store, enableColumnReorder]);

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
				store.viewportController.updateVisibleRanges();
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

	// Context Menu plugin controller
	const contextMenu = useMemo(() => {
		if (!enableContextMenu) return null;
		const plugin = new GridContextMenuPlugin<TRowData>(contextMenuOptions);
		store.registerPlugin(plugin);
		return plugin;
	}, [store, enableContextMenu]);

	useEffect(() => {
		if (contextMenu && contextMenuOptions) {
			contextMenu.setOptions(contextMenuOptions);
		}
	}, [contextMenu, contextMenuOptions]);

	useEffect(() => {
		return () => {
			if (contextMenu) {
				contextMenu.onDestroy();
			}
		};
	}, [contextMenu]);

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
			const isInside = !!container && (container.contains(activeEl) || isGridActiveRef.current);
			if (isInside) {
				navigation.handleKeyDown(e);
			}
		};
		const handlePointerDown = (e: MouseEvent) => {
			const container = containerRef.current;
			isGridActiveRef.current = !!container && container.contains(e.target as Node);
		};
		window.addEventListener('keydown', handleGlobalKeyDown);
		window.addEventListener('mouseup', navigation.handleMouseUp);
		document.addEventListener('mousedown', handlePointerDown, true);
		return () => {
			window.removeEventListener('keydown', handleGlobalKeyDown);
			window.removeEventListener('mouseup', navigation.handleMouseUp);
			document.removeEventListener('mousedown', handlePointerDown, true);
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

			isGridActiveRef.current = true;
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

	const handleContextMenu = useCallback(
		(e: MouseEvent) => {
			if (!enableContextMenu || !contextMenu) return;

			const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
			if (!cellEl) return;
			const colField = cellEl.dataset.colField;
			const rowEl = cellEl.closest('.og-row') as HTMLElement;
			const rowId = rowEl?.dataset.rowId;
			if (!colField || !rowId) return;

			e.preventDefault();
			contextMenu.show(rowId, colField, e.clientX, e.clientY);
		},
		[enableContextMenu, contextMenu]
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		container.addEventListener('mousedown', handleMouseDown);
		container.addEventListener('mouseover', handleMouseOver);
		container.addEventListener('click', handleClick);
		container.addEventListener('dblclick', handleDoubleClick);
		container.addEventListener('contextmenu', handleContextMenu);

		return () => {
			container.removeEventListener('mousedown', handleMouseDown);
			container.removeEventListener('mouseover', handleMouseOver);
			container.removeEventListener('click', handleClick);
			container.removeEventListener('dblclick', handleDoubleClick);
			container.removeEventListener('contextmenu', handleContextMenu);
		};
	}, [handleMouseDown, handleMouseOver, handleClick, handleDoubleClick, handleContextMenu]);

	return (
		<div ref={containerRef} tabIndex={-1} style={{ width: '100%', height: '100%', position: 'relative' }}>
			<PortalManager portals={portals} store={store} />
		</div>
	);
}
