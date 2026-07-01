import {
	GridApi,
	GridEventName,
	GridCellClickParams,
	GridCellPointer,
	GridContextMenuOptions,
	GridContextMenuHandle,
	type GridEventPayloadMap,
	registerGridContextMenu,
	VisualRow,
} from '@open-grid/core';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GridAdapterContext } from './gridContext.js';
import { GridHostWithAdapter, GridAdapterHandle, hasImperativeRendererCapability, mountGridHost } from './reactHostBridge.js';
import { PortalManager, createPortalStore } from './GridPortal.js';
import { flashCopiedCells } from './cellFlash.js';
import { useGridNavigationController } from './hooks.js';
import { GridSidebar, GridSidebarConfig } from './sidebar/GridSidebar.js';
import { GridChartOverlay } from './chart/GridChartOverlay.js';

export interface GridViewProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	pinLeftColumns?: number;
	pinRightColumns?: number;
	pinTopRows?: number;
	pinBottomRows?: number;
	enableColumnReorder?: boolean;
	enableNavigation?: boolean;
	enableContextMenu?: boolean;
	contextMenuOptions?: GridContextMenuOptions<TRowData>;
	onCellClick?: (params: GridCellClickParams<TRowData>) => void;
	onWriteBlocked?: (event: GridEventPayloadMap<TRowData>[GridEventName.writeBlocked]) => void;
	onCellValueChanged?: (event: GridEventPayloadMap<TRowData>[GridEventName.cellValueChanged]) => void;
	navigationOptions?: {
		editTrigger?: 'singleClick' | 'doubleClick';
		arrowKeyNavigationEdit?: boolean;
	};
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => ReactNode;
	footerRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => ReactNode;
	sidebar?: GridSidebarConfig<TRowData>;
	enableChart?: boolean;
	autoRowHeight?: boolean;
}

function warnInitialOnlyGridViewProp(propName: string): void {
	console.warn(
		`[open-grid/react] Prop "${propName}" is initial-only for the current grid instance. ` +
			'Changing it after mount does not reconfigure the existing runtime. Remount or replace the grid api if you need the new value to take effect.'
	);
}

export function GridView<TRowData = unknown>({
	api,
	pinLeftColumns,
	pinRightColumns,
	pinTopRows = 0,
	pinBottomRows = 0,
	enableColumnReorder,
	enableNavigation = true,
	enableContextMenu = true,
	contextMenuOptions,
	onCellClick,
	onWriteBlocked,
	onCellValueChanged,
	navigationOptions = {},
	groupRowRenderer,
	detailRowRenderer,
	footerRowRenderer,
	sidebar,
	enableChart = false,
	autoRowHeight,
}: GridViewProps<TRowData>) {
	const portalStore = useMemo(() => createPortalStore<TRowData>(), []);
	const containerRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<GridHostWithAdapter<TRowData> | null>(null);
	const apiRef = useRef(api);
	apiRef.current = api;
	const [adapterHandle, setAdapterHandle] = useState<GridAdapterHandle<unknown> | null>(null);
	const isGridActiveRef = useRef(false);
	const warnedInitialOnlyPropsRef = useRef(new Set<string>());
	const sidebarDefaultOpenRef = useRef(sidebar?.defaultOpen);
	const sidebarInitialApiRef = useRef(api);

	if (sidebarInitialApiRef.current !== api) {
		sidebarInitialApiRef.current = api;
		sidebarDefaultOpenRef.current = sidebar?.defaultOpen;
		warnedInitialOnlyPropsRef.current.clear();
	}

	useEffect(() => {
		if (pinLeftColumns !== undefined || pinRightColumns !== undefined) {
			hostRef.current?.setViewportPins({
				left: pinLeftColumns ?? 0,
				right: pinRightColumns ?? 0,
				top: pinTopRows,
				bottom: pinBottomRows,
			});
		}
	}, [pinLeftColumns, pinRightColumns, pinTopRows, pinBottomRows]);

	useEffect(() => {
		if (enableColumnReorder !== undefined) {
			api.setColumnReorderEnabled(enableColumnReorder);
		}
	}, [api, enableColumnReorder]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const storePins = api.getPinnedColumns();
		const host = mountGridHost(api, container, {
			pins: {
				left: pinLeftColumns !== undefined ? pinLeftColumns : storePins.left,
				right: pinRightColumns !== undefined ? pinRightColumns : storePins.right,
				top: pinTopRows,
				bottom: pinBottomRows,
			},
			cellContent: {
				mountCellContent: (mount) => {
					if (hasImperativeRendererCapability(mount.col) && !mount.isEditing) {
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
								mount.isSelected,
								{
									cellInstanceId: mount.cellInstanceId ?? '',
									rowSlotId: mount.rowSlotId,
									slotGeneration: mount.slotGeneration,
									rowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
									portalHostId: mount.portalHostId ?? '',
								}
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
						mount.isSelected,
						{
							cellInstanceId: mount.cellInstanceId ?? '',
							rowSlotId: mount.rowSlotId,
							slotGeneration: mount.slotGeneration,
							rowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
							portalHostId: mount.portalHostId ?? '',
						}
					);
				},
				unmountCellContent: (unmount) => {
					portalStore.unmountCell(unmount.cellKey, unmount.container, unmount.flushSync ?? false, {
						cellInstanceId: unmount.cellInstanceId ?? '',
						rowSlotId: unmount.rowSlotId,
						slotGeneration: unmount.slotGeneration,
						rowBindingGeneration: unmount.cellRowBindingGeneration ?? 0,
						portalHostId: unmount.portalHostId ?? '',
					});
				},
				flushCellContent: () => {},
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
			autoRowHeight,
		});
		hostRef.current = host;
		setAdapterHandle(host.adapterHandle as GridAdapterHandle<unknown>);

		return () => {
			hostRef.current = null;
			setAdapterHandle(null);
			isGridActiveRef.current = false;
			host.destroy();
			portalStore.clear(true);
		};
	}, [api, portalStore]);

	const contextMenuOptionsRef = useRef(contextMenuOptions);
	contextMenuOptionsRef.current = contextMenuOptions;
	const contextMenuRef = useRef<GridContextMenuHandle<TRowData> | null>(null);

	useEffect(() => {
		if (!enableContextMenu) {
			contextMenuRef.current = null;
			return;
		}
		const plugin = registerGridContextMenu<TRowData>(api, contextMenuOptions);
		contextMenuRef.current = plugin;

		return () => {
			if (contextMenuRef.current === plugin) {
				contextMenuRef.current = null;
			}
			plugin.dispose();
		};
	}, [api, enableContextMenu]);

	useEffect(() => {
		contextMenuRef.current?.setOptions(contextMenuOptionsRef.current ?? {});
	}, [contextMenuOptions]);

	const navigation = useGridNavigationController<TRowData>(
		{
			editTrigger: navigationOptions.editTrigger ?? 'doubleClick',
			arrowKeyNavigationEdit: navigationOptions.arrowKeyNavigationEdit ?? false,
		},
		enableNavigation
	);
	const navigationRef = useRef(navigation);
	navigationRef.current = navigation;
	const onCellClickRef = useRef(onCellClick);
	onCellClickRef.current = onCellClick;
	const enableContextMenuRef = useRef(enableContextMenu);
	enableContextMenuRef.current = enableContextMenu;

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
			if (isInside) {
				navigationRef.current?.handleKeyDown(e);
			}
		};
		const handleGlobalMouseUp = () => {
			navigationRef.current?.handleMouseUp();
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
		window.addEventListener('mouseup', handleGlobalMouseUp);
		document.addEventListener('mousedown', handlePointerDown, true);
		return () => {
			window.removeEventListener('keydown', handleGlobalKeyDown);
			window.removeEventListener('mouseup', handleGlobalMouseUp);
			document.removeEventListener('mousedown', handlePointerDown, true);
			if (container) {
				container.removeEventListener('focusin', handleFocusIn);
				container.removeEventListener('focusout', handleFocusOut);
			}
		};
	}, [enableNavigation]);

	const getCellPointerFromEvent = useCallback((e: MouseEvent): { cellEl: HTMLElement; pointer: GridCellPointer } | null => {
		const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
		if (!cellEl) return null;
		if (cellEl.closest('.og-grid-container') !== containerRef.current) return null;
		const pointer = hostRef.current?.adapterHandle.getCellPointerFromElement(cellEl) ?? null;
		if (!pointer) return null;
		return { cellEl, pointer };
	}, []);

	const handleMouseDown = useCallback(
		(e: MouseEvent) => {
			const nav = navigationRef.current;
			if (!nav) return;
			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { cellEl, pointer } = target;

			isGridActiveRef.current = true;
			const state = apiRef.current.getStateSnapshot();
			const isEditing = state.activeEdit?.rowId === pointer.rowId && state.activeEdit?.colField === pointer.colField;
			if (isEditing) return;

			// Skip range selection for columns that have canDrag (drag handle) or disableCellRangeSelection set.
			const colDef = apiRef.current.getColumnDef(pointer.colField);
			if (colDef && (colDef.canDrag !== undefined || colDef.disableCellRangeSelection)) return;

			cellEl.tabIndex = -1;
			cellEl.focus();
			nav.handleMouseDown(pointer.rowId, pointer.colField, e);
		},
		[getCellPointerFromEvent]
	);

	const handleMouseOver = useCallback(
		(e: MouseEvent) => {
			const nav = navigationRef.current;
			if (!nav) return;
			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { cellEl, pointer } = target;

			if (e.relatedTarget && cellEl.contains(e.relatedTarget as Node)) return;

			nav.handleMouseEnter(pointer.rowId, pointer.colField);
		},
		[getCellPointerFromEvent]
	);

	const handleClick = useCallback(
		(e: MouseEvent) => {
			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { pointer } = target;

			const access = hostRef.current?.adapterHandle.getCellAccess(pointer.rowId, pointer.colField) ?? null;
			const clickParams = access
				? {
						rowId: access.rowId,
						rowIndex: access.rowIndex,
						row: access.row,
						node: access.node,
						colField: access.colField,
						colIndex: access.colIndex,
						column: access.column,
						value: access.value,
						api: apiRef.current,
						event: e,
					}
				: null;
			if (clickParams) {
				onCellClickRef.current?.(clickParams as GridCellClickParams<TRowData>);
				apiRef.current.dispatchEvent(GridEventName.cellClicked, clickParams as GridCellClickParams<TRowData>);
			}

			const nav = navigationRef.current;
			if (!nav) return;

			const state = apiRef.current.getStateSnapshot();
			const isEditing = state.activeEdit?.rowId === pointer.rowId && state.activeEdit?.colField === pointer.colField;
			if (isEditing) return;

			nav.handleClick(pointer.rowId, pointer.colField, e);
		},
		[getCellPointerFromEvent]
	);

	const handleDoubleClick = useCallback(
		(e: MouseEvent) => {
			const nav = navigationRef.current;
			if (!nav) return;
			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { pointer } = target;

			const state = apiRef.current.getStateSnapshot();
			const isEditing = state.activeEdit?.rowId === pointer.rowId && state.activeEdit?.colField === pointer.colField;
			if (isEditing) return;

			nav.setCellEditing(pointer.rowId, pointer.colField, true);
		},
		[getCellPointerFromEvent]
	);

	const handleContextMenu = useCallback(
		(e: MouseEvent) => {
			if (!enableContextMenuRef.current || !contextMenuRef.current) return;

			const target = getCellPointerFromEvent(e);
			if (!target) return;
			const { pointer } = target;

			e.preventDefault();
			contextMenuRef.current.show(pointer.rowId, pointer.colField, e.clientX, e.clientY);
		},
		[getCellPointerFromEvent]
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

	useEffect(() => {
		let cancelFlash: (() => void) | undefined;
		const unsub = api.addEventListener(GridEventName.cellsCopied, ({ payload }) => {
			const container = containerRef.current;
			if (!container) return;
			cancelFlash?.();
			cancelFlash = flashCopiedCells(container, payload.cells);
		});
		return () => {
			unsub();
			cancelFlash?.();
		};
	}, [api]);

	useEffect(() => {
		if (!onWriteBlocked) return;
		return api.addEventListener(GridEventName.writeBlocked, ({ payload }) => {
			onWriteBlocked(payload);
		});
	}, [api, onWriteBlocked]);

	useEffect(() => {
		if (!onCellValueChanged) return;
		return api.addEventListener(GridEventName.cellValueChanged, ({ payload }) => {
			onCellValueChanged(payload);
		});
	}, [api, onCellValueChanged]);

	useEffect(() => {
		if (sidebarDefaultOpenRef.current != null) api.openPanel(sidebarDefaultOpenRef.current);
	}, [api]);

	useEffect(() => {
		const initialValue = sidebarDefaultOpenRef.current;
		const currentValue = sidebar?.defaultOpen;
		if (Object.is(initialValue, currentValue)) return;
		if (warnedInitialOnlyPropsRef.current.has('sidebar.defaultOpen')) return;
		warnedInitialOnlyPropsRef.current.add('sidebar.defaultOpen');
		warnInitialOnlyGridViewProp('sidebar.defaultOpen');
	}, [api, sidebar?.defaultOpen]);

	const hasSidebar = sidebar != null;
	const sidebarPosition = sidebar?.position ?? 'right';

	const gridPane = (
		<div
			ref={containerRef}
			tabIndex={-1}
			style={{
				flex: hasSidebar ? 1 : undefined,
				width: hasSidebar ? undefined : '100%',
				height: '100%',
				position: 'relative',
				minWidth: hasSidebar ? 0 : undefined,
			}}
		>
			<PortalManager
				store={portalStore}
				api={api}
				groupRowRenderer={groupRowRenderer}
				detailRowRenderer={detailRowRenderer}
				footerRowRenderer={footerRowRenderer}
			/>
		</div>
	);

	return (
		<GridAdapterContext.Provider value={adapterHandle}>
			{hasSidebar ? (
				<div
					style={{
						width: '100%',
						height: '100%',
						display: 'flex',
						flexDirection: sidebarPosition === 'left' ? 'row-reverse' : 'row',
					}}
				>
					{gridPane}
					<GridSidebar<TRowData> api={api} config={sidebar!} />
				</div>
			) : (
				gridPane
			)}
			{enableChart && <GridChartOverlay api={api} />}
		</GridAdapterContext.Provider>
	);
}
