import {
	GridApi,
	GridEventName,
	GridCellClickParams,
	GridCellPointer,
	GridContextMenuOptions,
	GridContextMenuHandle,
	registerGridContextMenu,
	VisualRow,
	ColumnDef,
	GridState,
	GridPersistenceAdapter,
} from '@open-grid/core';
import type { ColumnTypeDefinition } from './renderers/CellTypes.js';
import type { StyleRule } from './styleRules.js';
import { useCallback, useContext, useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { useClientGrid } from './useGrid.js';
import { GridProvider, GridApiContext, GridAdapterContext } from './gridContext.js';
import { GridHostWithAdapter, GridAdapterHandle, hasImperativeRendererCapability, mountGridHost } from './reactHostBridge.js';

declare const process: { env: { NODE_ENV: string } } | undefined;
const DEV = typeof process === 'undefined' || process.env.NODE_ENV !== 'production';
import { PortalManager, createPortalStore } from './GridPortal.js';
import { flashCopiedCells } from './cellFlash.js';
import { useGridNavigationController } from './hooks.js';
import { GridSidebar, GridSidebarConfig } from './sidebar/GridSidebar.js';
import { GridChartOverlay } from './chart/GridChartOverlay.js';
export interface OpenGridProps<TRowData = unknown> {
	// ─── Inline data mode ────────────────────────────────────────────────────
	// Pass rows + columns directly — no separate hook needed for simple client grids.
	// OpenGrid creates and owns the grid instance internally.
	// For server grids or when you need the api object from sibling/parent components,
	// use `useClientGrid` / `useServerGrid` and pass the resulting `api` instead.
	rows?: TRowData[];
	columns?: ColumnDef<TRowData>[];
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
	persistence?: GridPersistenceAdapter;
	rowOverscanPx?: number;
	colBuffer?: number;
	overscanAdaptive?: boolean;
	runtimeLimits?: GridState<TRowData>['runtimeLimits'];
	/** Shortcut for `initialState.detailRowHeight`. Height in px for expanded master-detail rows. */
	detailRowHeight?: number;
	/** Named column types resolved against the `type` field on ColumnDef. See `ClientGridOptions.columnTypes`. */
	columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
	/** Declarative style rules. See `ClientGridOptions.styleRules`. */
	styleRules?: StyleRule<TRowData>[];

	// ─── External api mode ───────────────────────────────────────────────────
	// Pass a pre-created GridApi from `useClientGrid()` or `useServerGrid()`.
	// Required for server grids; also use when multiple components share the same grid.
	// Alternatively, wrap in `<GridProvider api={api}>` and omit this prop entirely.
	api?: GridApi<TRowData>;

	// ─── Display / behaviour ─────────────────────────────────────────────────
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
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => ReactNode;
	footerRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => ReactNode;
	/** Attach a built-in animated sidebar panel strip inside the grid. */
	sidebar?: GridSidebarConfig<TRowData>;
	/**
	 * Enable the built-in chart overlay (triggered via `api.openChart()` or the
	 * default "Chart Selection" context-menu item).  Default: false.
	 */
	enableChart?: boolean;
}

export type GridViewProps<TRowData = unknown> = Omit<
	OpenGridProps<TRowData>,
	| 'rows'
	| 'columns'
	| 'getRowId'
	| 'initialState'
	| 'persistence'
	| 'rowOverscanPx'
	| 'colBuffer'
	| 'overscanAdaptive'
	| 'runtimeLimits'
	| 'detailRowHeight'
	| 'columnTypes'
	| 'styleRules'
	| 'api'
> & {
	api: GridApi<TRowData>;
};

export function OpenGrid<TRowData = unknown>(props: OpenGridProps<TRowData>) {
	const contextApi = useContext(GridApiContext) as GridApi<TRowData> | null;

	// Inline mode: rows provided without a pre-created api — create and own the grid internally.
	if (!props.api && props.rows !== undefined) {
		return <OpenGridManagedClient {...props} rows={props.rows} />;
	}

	const api = props.api ?? contextApi;
	if (!api) {
		throw new Error(
			'OpenGrid requires one of: (1) `rows` + `columns` props for a self-contained grid, ' +
				'(2) an `api` prop from `useClientGrid` / `useServerGrid`, or ' +
				'(3) a parent `<GridProvider api={...}>` wrapper.'
		);
	}

	return (
		<GridProvider api={api}>
			<GridView {...props} api={api} />
		</GridProvider>
	);
}

// Internal: manages the grid lifecycle when rows/columns are passed directly to <OpenGrid>.
function OpenGridManagedClient<TRowData = unknown>({
	rows,
	columns,
	columnTypes,
	styleRules,
	getRowId,
	initialState,
	persistence,
	rowOverscanPx,
	colBuffer,
	overscanAdaptive,
	runtimeLimits,
	detailRowHeight,
	...rest
}: OpenGridProps<TRowData> & { rows: TRowData[] }) {
	if (DEV && (!columns || columns.length === 0)) {
		console.warn(
			'[open-grid] <OpenGrid> received `rows` but no `columns`. ' + 'Pass a `columns` prop alongside `rows`, or the grid will render empty.'
		);
	}
	const mergedInitialState = detailRowHeight != null ? { detailRowHeight, ...initialState } : initialState;
	const api = useClientGrid<TRowData>({
		rows: rows!,
		columns: columns ?? [],
		columnTypes,
		styleRules,
		getRowId,
		initialState: mergedInitialState,
		persistence,
		rowOverscanPx,
		colBuffer,
		overscanAdaptive,
		runtimeLimits,
	});
	return (
		<GridProvider api={api}>
			<GridView {...rest} api={api} />
		</GridProvider>
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
	navigationOptions = {},
	groupRowRenderer,
	detailRowRenderer,
	footerRowRenderer,
	sidebar,
	enableChart = false,
}: GridViewProps<TRowData>) {
	const portalStore = useMemo(() => createPortalStore<TRowData>(), []);
	const containerRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<GridHostWithAdapter<TRowData> | null>(null);
	const [adapterHandle, setAdapterHandle] = useState<GridAdapterHandle<unknown> | null>(null);
	const isGridActiveRef = useRef(false);

	// Only push pin values when they are explicitly provided as props.
	// If undefined, the grid keeps whatever pin state was set by createClientGrid
	// (e.g. auto-pinned by rowSelection: 'multiple') instead of being overridden to 0.
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

		// Read the pin state already set in the store (e.g. auto-pinned by rowSelection: 'multiple')
		// so we don't accidentally override it with 0 when the prop is not passed.
		const storePins = api.getPinnedColumns();
		const host = mountGridHost(api, container, {
			pins: {
				left: pinLeftColumns !== undefined ? pinLeftColumns : storePins.left,
				right: pinRightColumns !== undefined ? pinRightColumns : storePins.right,
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
		setAdapterHandle(host.adapterHandle as GridAdapterHandle<unknown>);

		return () => {
			hostRef.current = null;
			setAdapterHandle(null);
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

	const getCellPointerFromEvent = useCallback((e: MouseEvent): { cellEl: HTMLElement; pointer: GridCellPointer } | null => {
		const cellEl = (e.target as HTMLElement).closest('.og-cell') as HTMLElement;
		if (!cellEl) return null;
		if (cellEl.closest('.og-grid-container') !== containerRef.current) return null;
		const pointer = hostRef.current?.adapterHandle.getCellPointerFromElement(cellEl) ?? null;
		if (!pointer) return null;
		return { cellEl, pointer };
	}, []);

	const getCellClickParams = useCallback(
		(pointer: GridCellPointer, event: MouseEvent): GridCellClickParams<TRowData> | null => {
			const access = hostRef.current?.adapterHandle.getCellAccess(pointer.rowId, pointer.colField) ?? null;
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

			cellEl.tabIndex = -1;
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
				api.dispatchEvent(GridEventName.cellClicked, clickParams);
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

	// Flash copied cells when a copy event fires. cancelFlash holds the active
	// cleanup so a rapid second copy cancels the first timer before starting a new one.
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

	// Initialize sidebar default open panel on mount
	const sidebarDefaultOpenRef = useRef(sidebar?.defaultOpen);
	useEffect(() => {
		if (sidebarDefaultOpenRef.current != null) api.openPanel(sidebarDefaultOpenRef.current);
	}, []); // intentional: mount-only

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
