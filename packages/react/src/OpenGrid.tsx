import {
	GridApi,
	GridCellClickParams,
	GridCellPointer,
	ColumnDef,
	GridState,
	RowNode,
	GridContextMenuOptions,
	GridContextMenuHandle,
	GridHost,
	GridNavigationHandle,
	GridNavigationOptions,
	mountGridHost,
	registerGridContextMenu,
	registerGridNavigation,
} from '@open-grid/core';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PortalData, PortalManager } from './GridPortal.js';

const GridApiContext = createContext<GridApi<unknown> | null>(null);

export interface GridProviderProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	children: React.ReactNode;
}

export function GridProvider<TRowData = unknown>({ api, children }: GridProviderProps<TRowData>) {
	return <GridApiContext.Provider value={api as unknown as GridApi<unknown>}>{children}</GridApiContext.Provider>;
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
export function useGridSelector<T, TRowData = unknown>(selector: (state: GridState<TRowData>) => T, isEqual?: (left: T, right: T) => boolean): T {
	return useGridSelectorWithEquality(selector, isEqual);
}

export function useGridSelectorWithEquality<T, TRowData = unknown>(
	selector: (state: GridState<TRowData>) => T,
	isEqual: (left: T, right: T) => boolean = Object.is
): T {
	const api = useGridApi<TRowData>();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const isEqualRef = useRef(isEqual);
	isEqualRef.current = isEqual;
	const snapshotRef = useRef<{ hasValue: boolean; value: T }>({ hasValue: false, value: undefined as T });

	const getSnapshot = useCallback(() => {
		const next = selectorRef.current(api.getState());
		const previous = snapshotRef.current;
		if (previous.hasValue && isEqualRef.current(previous.value, next)) {
			return previous.value;
		}
		snapshotRef.current = { hasValue: true, value: next };
		return next;
	}, [api]);

	return useSyncExternalStore(api.subscribe, getSnapshot, getSnapshot);
}

/**
 * Targeted selector for individual keys to achieve optimal performance.
 */
export function useGridKeySelector<T, TRowData = unknown>(
	key: string,
	selector: (state: GridState<TRowData>) => T,
	isEqual?: (left: T, right: T) => boolean
): T {
	return useGridKeySelectorWithEquality(key, selector, isEqual);
}

export function useGridKeySelectorWithEquality<T, TRowData = unknown>(
	key: string,
	selector: (state: GridState<TRowData>) => T,
	isEqual: (left: T, right: T) => boolean = Object.is
): T {
	const api = useGridApi<TRowData>();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const isEqualRef = useRef(isEqual);
	isEqualRef.current = isEqual;
	const snapshotRef = useRef<{ hasValue: boolean; value: T }>({ hasValue: false, value: undefined as T });

	const subscribe = useCallback((onStoreChange: () => void) => api.subscribeToKey(key, onStoreChange), [api, key]);

	const getSnapshot = useCallback(() => {
		const next = selectorRef.current(api.getState());
		const previous = snapshotRef.current;
		if (previous.hasValue && isEqualRef.current(previous.value, next)) {
			return previous.value;
		}
		snapshotRef.current = { hasValue: true, value: next };
		return next;
	}, [api]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Controller integration hook mapping standard interaction event handlers.
 */
export function useGridNavigationController<TRowData = unknown>(options: GridNavigationOptions = {}, enabled = true) {
	const api = useGridApi<TRowData>();
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const [controller, setController] = useState<GridNavigationHandle | null>(null);

	useEffect(() => {
		if (!enabled) {
			setController(null);
			return;
		}
		const nav = registerGridNavigation<TRowData>(api, {
			onCellValueChanged: (rowId, colField, val) => optionsRef.current.onCellValueChanged?.(rowId, colField, val),
			get editTrigger() {
				return optionsRef.current.editTrigger;
			},
			get arrowKeyNavigationEdit() {
				return optionsRef.current.arrowKeyNavigationEdit;
			},
		});
		setController(nav);

		return () => {
			nav.dispose();
			setController(null);
		};
	}, [api, enabled]);

	return controller;
}

export interface OpenGridProps<TRowData = unknown> {
	api?: GridApi<TRowData>;
	pinLeftColumns?: number;
	pinRightColumns?: number;
	pinTopRows?: number;
	pinBottomRows?: number;
	enableColumnReorder?: boolean;
	enableNavigation?: boolean;
	enableContextMenu?: boolean;
	contextMenuOptions?: GridContextMenuOptions<TRowData>;
	onCellClick?: (params: GridCellClickParams<TRowData>) => void;
	navigationOptions?: {
		editTrigger?: 'singleClick' | 'doubleClick';
		arrowKeyNavigationEdit?: boolean;
		onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	};
	groupRowRenderer?: (props: { visualRow: any; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: any; api: GridApi<TRowData> }) => React.ReactNode;
}

export function OpenGrid<TRowData = unknown>(props: OpenGridProps<TRowData>) {
	const contextApi = useContext(GridApiContext);
	const api = props.api ?? (contextApi as GridApi<TRowData> | null);

	if (!api) {
		throw new Error('OpenGrid must be provided an api either via props or GridProvider context.');
	}

	return (
		<GridProvider api={api}>
			<OpenGridInner {...props} api={api} />
		</GridProvider>
	);
}

function OpenGridInner<TRowData = unknown>({
	api,
	pinLeftColumns = 0,
	pinRightColumns = 0,
	pinTopRows = 0,
	pinBottomRows = 0,
	enableColumnReorder,
	enableNavigation = true,
	enableContextMenu = true,
	contextMenuOptions,
	onCellClick,
	navigationOptions = {},
	groupRowRenderer,
	detailRowRenderer,
}: OpenGridProps<TRowData> & { api: GridApi<TRowData> }) {
	const portalsRef = useRef<Map<string, PortalData<TRowData>>>(new Map());
	const rowPortalsRef = useRef<Map<string, { rowKey: string; container: HTMLElement; visualRow: any }>>(new Map());
	const portalFlushScheduledRef = useRef(false);
	const [, setPortalVersion] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<GridHost | null>(null);
	const isGridActiveRef = useRef(false);

	const schedulePortalFlush = useCallback(() => {
		if (portalFlushScheduledRef.current) return;
		portalFlushScheduledRef.current = true;
		queueMicrotask(() => {
			portalFlushScheduledRef.current = false;
			setPortalVersion((version) => version + 1);
		});
	}, []);

	const mountPortal = useCallback(
		(
			cellKey: string,
			container: HTMLElement,
			value: unknown,
			node: RowNode<TRowData>,
			col: ColumnDef<TRowData>,
			isEditing: boolean,
			isLoading: boolean
		) => {
			const existing = portalsRef.current.get(cellKey);
			if (existing && existing.container === container && existing.isEditing === isEditing && existing.isLoading === isLoading) {
				return;
			}

			// Intercept and patch removeChild to safely prevent React unmounting crashes on recycled elements
			if (container && !(container as any).__patchedRemoveChild) {
				(container as any).__patchedRemoveChild = true;
				const originalRemove = container.removeChild;
				container.removeChild = function <T extends Node>(child: T): T {
					if (child.parentNode === container) {
						return originalRemove.call(this, child) as T;
					}
					return child;
				};
			}

			portalsRef.current.set(cellKey, {
				cellKey,
				container,
				value,
				node,
				col,
				isEditing,
				isLoading,
			});
			schedulePortalFlush();
		},
		[schedulePortalFlush]
	);

	const unmountPortal = useCallback(
		(cellKey: string, container?: HTMLElement) => {
			const existing = portalsRef.current.get(cellKey);
			if (!existing || (container && existing.container !== container)) return;
			portalsRef.current.delete(cellKey);
			schedulePortalFlush();
		},
		[schedulePortalFlush]
	);

	const mountRowPortal = useCallback(
		(rowKey: string, container: HTMLElement, visualRow: any) => {
			const existing = rowPortalsRef.current.get(rowKey);
			if (existing && existing.container === container && existing.visualRow === visualRow) {
				return;
			}

			// Intercept and patch removeChild to safely prevent React unmounting crashes on recycled elements
			if (container && !(container as any).__patchedRemoveChild) {
				(container as any).__patchedRemoveChild = true;
				const originalRemove = container.removeChild;
				container.removeChild = function <T extends Node>(child: T): T {
					if (child.parentNode === container) {
						return originalRemove.call(this, child) as T;
					}
					return child;
				};
			}

			rowPortalsRef.current.set(rowKey, {
				rowKey,
				container,
				visualRow,
			});
			schedulePortalFlush();
		},
		[schedulePortalFlush]
	);

	const unmountRowPortal = useCallback(
		(rowKey: string) => {
			if (!rowPortalsRef.current.has(rowKey)) return;
			rowPortalsRef.current.delete(rowKey);
			schedulePortalFlush();
		},
		[schedulePortalFlush]
	);

	useEffect(() => {
		hostRef.current?.setViewportPins({
			left: pinLeftColumns,
			right: pinRightColumns,
			top: pinTopRows,
			bottom: pinBottomRows,
		});
	}, [pinLeftColumns, pinRightColumns, pinTopRows, pinBottomRows]);

	useEffect(() => {
		if (enableColumnReorder !== undefined) {
			api.setColumnReorderEnabled(enableColumnReorder);
		}
	}, [api, enableColumnReorder]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const host = mountGridHost(api, container, {
			pins: {
				left: pinLeftColumns,
				right: pinRightColumns,
				top: pinTopRows,
				bottom: pinBottomRows,
			},
			cellContent: {
				mountCellContent: (mount) => {
					mountPortal(mount.cellKey, mount.container, mount.value, mount.node, mount.col, mount.isEditing, mount.isLoading);
				},
				unmountCellContent: (unmount) => {
					unmountPortal(unmount.cellKey, unmount.container);
				},
			},
			rowContent: {
				mountRowContent: (mount) => {
					mountRowPortal(mount.rowKey, mount.container, mount.visualRow);
				},
				unmountRowContent: (unmount) => {
					unmountRowPortal(unmount.rowKey);
				},
			},
		});
		hostRef.current = host;

		return () => {
			host.destroy();
			hostRef.current = null;
			portalsRef.current.clear();
			rowPortalsRef.current.clear();
			setPortalVersion((version) => version + 1);
		};
	}, [api, mountPortal, unmountPortal, mountRowPortal, unmountRowPortal]);

	// Context Menu plugin controller
	const [contextMenu, setContextMenu] = useState<GridContextMenuHandle<TRowData> | null>(null);
	const contextMenuOptionsRef = useRef(contextMenuOptions);
	contextMenuOptionsRef.current = contextMenuOptions;

	useEffect(() => {
		if (!enableContextMenu) {
			setContextMenu(null);
			return;
		}
		const plugin = registerGridContextMenu<TRowData>(api, contextMenuOptions);
		setContextMenu(plugin);

		return () => {
			plugin.dispose();
			setContextMenu(null);
		};
	}, [api, enableContextMenu]);

	useEffect(() => {
		if (contextMenu && contextMenuOptionsRef.current) {
			contextMenu.setOptions(contextMenuOptionsRef.current);
		}
	}, [contextMenu, contextMenuOptions]);

	// Navigation controller
	const navigation = useGridNavigationController<TRowData>(
		{
			onCellValueChanged: (rowId, colField, val) => {
				if (enableNavigation) navigationOptions.onCellValueChanged?.(rowId, colField, val);
			},
			editTrigger: navigationOptions.editTrigger ?? 'doubleClick',
			arrowKeyNavigationEdit: navigationOptions.arrowKeyNavigationEdit ?? false,
		},
		enableNavigation
	);

	useEffect(() => {
		if (!enableNavigation) return;
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			const activeEl = document.activeElement;
			const container = containerRef.current;
			const isInside = !!container && (container.contains(activeEl) || isGridActiveRef.current);
			if (isInside && navigation) {
				navigation.handleKeyDown(e);
			}
		};
		const handlePointerDown = (e: MouseEvent) => {
			const container = containerRef.current;
			isGridActiveRef.current = !!container && container.contains(e.target as Node);
		};
		window.addEventListener('keydown', handleGlobalKeyDown);
		if (navigation) window.addEventListener('mouseup', navigation.handleMouseUp);
		document.addEventListener('mousedown', handlePointerDown, true);
		return () => {
			window.removeEventListener('keydown', handleGlobalKeyDown);
			if (navigation) window.removeEventListener('mouseup', navigation.handleMouseUp);
			document.removeEventListener('mousedown', handlePointerDown, true);
		};
	}, [navigation, enableNavigation]);

	const getCellPointerFromEvent = useCallback((e: MouseEvent): { cellEl: HTMLElement; pointer: GridCellPointer } | null => {
		const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
		if (!cellEl) return null;
		const colField = cellEl.dataset.colField;
		const rowEl = cellEl.closest('.og-row') as HTMLElement;
		const rowId = rowEl?.dataset.rowId;
		if (!colField || !rowId) return null;
		return { cellEl, pointer: { rowId, colField } };
	}, []);

	const getCellClickParams = useCallback(
		(pointer: GridCellPointer, event: MouseEvent): GridCellClickParams<TRowData> | null => {
			const access = api.getCellAccess(pointer.rowId, pointer.colField);
			if (!access) return null;
			return {
				rowId: access.rowId,
				rowIndex: access.rowIndex,
				row: access.row,
				node: access.node,
				colField: access.colField,
				colIndex: access.colIndex,
				column: access.column,
				value: access.value,
				api,
				event,
			};
		},
		[api]
	);

	const handleMouseDown = useCallback(
		(e: MouseEvent) => {
			if (!navigation) return;
			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { cellEl, pointer } = target;

			isGridActiveRef.current = true;
			const state = api.getState();
			const isEditing = state.activeEdit?.rowId === pointer.rowId && state.activeEdit?.colField === pointer.colField;
			if (isEditing) return;

			cellEl.focus();
			navigation.handleMouseDown(pointer.rowId, pointer.colField, e);
		},
		[api, navigation, getCellPointerFromEvent]
	);

	const handleMouseOver = useCallback(
		(e: MouseEvent) => {
			if (!navigation) return;
			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { cellEl, pointer } = target;

			if (e.relatedTarget && cellEl.contains(e.relatedTarget as Node)) return;

			navigation.handleMouseEnter(pointer.rowId, pointer.colField);
		},
		[navigation, getCellPointerFromEvent]
	);

	const handleClick = useCallback(
		(e: MouseEvent) => {
			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { pointer } = target;

			const clickParams = getCellClickParams(pointer, e);
			if (clickParams) {
				onCellClick?.(clickParams);
				api.dispatchEvent('cellClicked', clickParams);
			}

			if (!navigation) return;

			const state = api.getState();
			const isEditing = state.activeEdit?.rowId === pointer.rowId && state.activeEdit?.colField === pointer.colField;
			if (isEditing) return;

			navigation.handleClick(pointer.rowId, pointer.colField, e);
		},
		[api, navigation, getCellPointerFromEvent, getCellClickParams, onCellClick]
	);

	const handleDoubleClick = useCallback(
		(e: MouseEvent) => {
			if (!navigation) return;
			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { pointer } = target;

			const state = api.getState();
			const isEditing = state.activeEdit?.rowId === pointer.rowId && state.activeEdit?.colField === pointer.colField;
			if (isEditing) return;

			navigation.setCellEditing(pointer.rowId, pointer.colField, true);
		},
		[api, navigation, getCellPointerFromEvent]
	);

	const handleContextMenu = useCallback(
		(e: MouseEvent) => {
			if (!enableContextMenu || !contextMenu) return;

			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { pointer } = target;

			e.preventDefault();
			contextMenu.show(pointer.rowId, pointer.colField, e.clientX, e.clientY);
		},
		[enableContextMenu, contextMenu, getCellPointerFromEvent]
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
			<PortalManager
				portals={portalsRef.current}
				rowPortals={rowPortalsRef.current}
				api={api}
				groupRowRenderer={groupRowRenderer}
				detailRowRenderer={detailRowRenderer}
			/>
		</div>
	);
}
