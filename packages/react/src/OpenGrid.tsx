import {
	GridApi,
	GridCellClickParams,
	GridCellPointer,
	ColumnDef,
	InternalColumnDef,
	RowNode,
	GridContextMenuOptions,
	GridContextMenuHandle,
	GridHost,
	mountGridHost,
	registerGridContextMenu,
	VisualRow,
} from '@open-grid/core';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react';
import { PortalManager, createPortalStore } from './GridPortal.js';
import { useGridNavigationController } from './hooks.js';

export const GridApiContext = createContext<GridApi<unknown> | null>(null);

export interface GridProviderProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	children: React.ReactNode;
}

export function GridProvider<TRowData = unknown>({ api, children }: GridProviderProps<TRowData>) {
	return <GridApiContext.Provider value={api as unknown as GridApi<unknown>}>{children}</GridApiContext.Provider>;
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
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
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
	const portalStore = useMemo(() => createPortalStore<TRowData>(), []);
	const containerRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<GridHost | null>(null);
	const isGridActiveRef = useRef(false);

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
				// All custom cell mounts flow through the shared portal store.
				// CellPortalPool renders portals into the cell containers; PortalCellWrapper
				// subscribes per-cell so only the changed cell re-renders on data updates.
				// No N separate React roots — one shared tree, one React scheduler task.
				mountCellContent: (mount) => {
					// Imperative fast path — renderer exposes ref.current.update(), bypasses
					// React scheduler entirely. Zero reconciler overhead for live price feeds.
					if ((mount.col as InternalColumnDef)?.cellRendererCapabilities?.imperativeUpdate && !mount.isEditing) {
						if (
							portalStore.tryImperativeUpdate(
								mount.cellKey,
								mount.value,
								mount.node,
								mount.col,
								mount.isEditing,
								mount.isLoading,
								mount.phase,
								mount.isScrolling,
								mount.isFocused,
								mount.isSelected
							)
						)
							return;
					}
					portalStore.mountCell(
						mount.cellKey,
						mount.container,
						mount.value,
						mount.node,
						mount.col,
						mount.isEditing,
						mount.isLoading,
						mount.phase,
						mount.isScrolling,
						mount.isFocused,
						mount.isSelected
					);
				},
				unmountCellContent: (unmount) => {
					portalStore.unmountCell(unmount.cellKey, unmount.container, unmount.flushSync ?? false);
				},
				flushCellContent: () => {
					// portalStore coalesces notifications internally via queueMicrotask
				},
			},
			rowContent: {
				mountRowContent: (mount) => {
					portalStore.mountRow(mount.rowKey, mount.container, mount.visualRow);
				},
				unmountRowContent: (unmount) => {
					portalStore.unmountRow(unmount.rowKey, unmount.container);
				},
			},
			headerMenu: {
				mountHeaderMenu: (mount) => {
					portalStore.mountMenu(mount.colField, mount.container, mount.column, mount.close);
				},
				unmountHeaderMenu: (unmount) => {
					portalStore.unmountMenu(unmount.colField, unmount.container);
				},
			},
		});
		hostRef.current = host;

		return () => {
			hostRef.current = null;
			host.destroy();
			portalStore.clear();
		};
	}, [api, portalStore]);

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
		const isWithinThisGrid = (target: EventTarget | null): boolean => {
			const container = containerRef.current;
			if (!container || !(target instanceof HTMLElement)) return false;
			return target.closest('.og-grid-container') === container;
		};
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			const activeEl = document.activeElement;
			const isInside = isWithinThisGrid(activeEl) || isGridActiveRef.current;
			if (isInside && navigation) {
				navigation.handleKeyDown(e);
			}
		};
		const handlePointerDown = (e: MouseEvent) => {
			isGridActiveRef.current = isWithinThisGrid(e.target);
		};
		const handleFocusIn = (e: FocusEvent) => {
			if (isWithinThisGrid(e.target)) {
				isGridActiveRef.current = true;
			}
		};
		const handleFocusOut = (e: FocusEvent) => {
			const related = e.relatedTarget;
			if (related instanceof HTMLElement && !isWithinThisGrid(related)) {
				isGridActiveRef.current = false;
			}
		};
		const container = containerRef.current;
		if (container) {
			container.addEventListener('focusin', handleFocusIn);
			container.addEventListener('focusout', handleFocusOut);
		}
		window.addEventListener('keydown', handleGlobalKeyDown);
		if (navigation) window.addEventListener('mouseup', navigation.handleMouseUp);
		document.addEventListener('mousedown', handlePointerDown, true);
		return () => {
			window.removeEventListener('keydown', handleGlobalKeyDown);
			if (navigation) window.removeEventListener('mouseup', navigation.handleMouseUp);
			document.removeEventListener('mousedown', handlePointerDown, true);
			if (container) {
				container.removeEventListener('focusin', handleFocusIn);
				container.removeEventListener('focusout', handleFocusOut);
			}
		};
	}, [navigation, enableNavigation]);

	const getCellPointerFromEvent = useCallback(
		(e: MouseEvent): { cellEl: HTMLElement; pointer: GridCellPointer } | null => {
			const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
			if (!cellEl) return null;
			if (cellEl.closest('.og-grid-container') !== containerRef.current) return null;
			const colField = cellEl.dataset.colField;
			const rowEl = cellEl.closest('.og-row') as HTMLElement;
			const rowIndex = Number(rowEl?.dataset.rowIndex);
			const visualRow = Number.isFinite(rowIndex) ? api.getVisualRow(rowIndex) : null;
			const rowId = visualRow?.kind === 'data' ? visualRow.rowId : undefined;
			if (!colField || !rowId) return null;
			return { cellEl, pointer: { rowId, colField } };
		},
		[api]
	);

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
			<PortalManager store={portalStore} api={api} groupRowRenderer={groupRowRenderer} detailRowRenderer={detailRowRenderer} />
		</div>
	);
}
