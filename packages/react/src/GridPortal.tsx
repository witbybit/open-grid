import { useCallback, useEffect, useRef, useState, useSyncExternalStore, memo } from 'react';
import { ColumnDef, GridApi, RowNode, VisualRow, type CellRendererPhase } from '@open-grid/core';
import { createPortal } from 'react-dom';
import { flushSync } from 'react-dom';
import { GridProvider } from './OpenGrid.js';
import { useGridApi } from './hooks.js';
import type { ReactNode } from 'react';

export interface PortalCellProps<TRowData = unknown> {
	rowId: string;
	colField: string;
	value: unknown;
	col: ColumnDef<TRowData>;
	node: RowNode<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase?: CellRendererPhase;
	isScrolling?: boolean;
	isFocused?: boolean;
	isSelected?: boolean;
}

/**
 * Clean React Portal cell adapter that mounts only custom renderers & custom editors.
 */
function PortalCellInner<TRowData = unknown>({
	rowId,
	colField,
	value,
	col,
	node,
	isEditing,
	isLoading,
	phase,
	isScrolling,
	isFocused,
	isSelected,
}: PortalCellProps<TRowData>) {
	const api = useGridApi<TRowData>();

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
				} else if (isEditing && !isCommittedRef.current) {
					isCommittedRef.current = true;
					api.setCellValue(rowId, colField, localValueRef.current);
				}
			}
		});
		return () => {
			unsubscribe();
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
				<div className='og-cell-loading-skeleton' style={{ height: '16px', width: '80%', borderRadius: '4px' }} />
			</div>
		);
	}

	const rowData = node?.data;

	const CustomEditor = col?.cellEditor as ((props: Record<string, unknown>) => ReactNode) | undefined;
	const CustomRenderer = col?.cellRenderer as ((props: Record<string, unknown>) => ReactNode) | undefined;

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
			{isEditing ? (
				CustomEditor ? (
					<div
						style={{ width: '100%', height: '100%' }}
						onMouseDown={(e) => e.stopPropagation()}
						onDoubleClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.defaultPrevented) return;
							if (e.key === 'Enter') {
								e.stopPropagation();
								handleCommit();
							} else if (e.key === 'Escape') {
								e.stopPropagation();
								handleCancel();
							}
						}}
					>
						{CustomEditor({
							rowId,
							colField,
							value: localValue,
							onChange: (val: unknown) => {
								setLocalValue(val);
								localValueRef.current = val;
							},
							api,
							onCommit: handleCommit,
							onCancel: handleCancel,
						})}
					</div>
				) : (
					<input
						autoFocus
						className='og-cell-editor'
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
				CustomRenderer({
					value,
					computedValue: value,
					row: rowData,
					rowId,
					colField,
					colId: colField,
					isScrolling: !!isScrolling,
					phase: phase ?? 'initial',
					isFocused: !!isFocused,
					isEditing,
					isSelected: !!isSelected,
					api,
				})
			) : null}
		</div>
	);
}

export const PortalCell = memo(PortalCellInner) as typeof PortalCellInner;

export interface PortalData<TRowData = unknown> {
	cellKey: string;
	container: HTMLElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase?: CellRendererPhase;
	isScrolling?: boolean;
	isFocused?: boolean;
	isSelected?: boolean;
}

function DefaultGroupRowRendererInner<TRowData = unknown>({ visualRow, api }: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) {
	if (visualRow.kind !== 'group') return null;
	const expanded = visualRow.expanded;
	const depth = visualRow.depth;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		api.toggleGroupExpanded(visualRow.id);
	};

	return (
		<div className='og-group-row-content' style={{ paddingLeft: `${depth * 20 + 8}px` }} onClick={handleToggle}>
			<span className={`og-group-row-toggle ${expanded ? 'og-group-row-toggle-expanded' : ''}`}>▶</span>
			<span className='og-group-row-label-prefix'>{visualRow.field}:</span>
			<span>{String(visualRow.key)}</span>
			<span className='og-group-count'>{visualRow.childCount} items</span>
		</div>
	);
}

export const DefaultGroupRowRenderer = memo(DefaultGroupRowRendererInner) as typeof DefaultGroupRowRendererInner;

function DefaultDetailRowRendererInner<TRowData = unknown>({ visualRow }: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) {
	if (visualRow.kind !== 'detail') return null;
	return <div className='og-detail-row-content'>Nested detail view for parent row: {visualRow.parentId}</div>;
}

export const DefaultDetailRowRenderer = memo(DefaultDetailRowRendererInner) as typeof DefaultDetailRowRendererInner;

export interface PortalStore<TRowData = unknown> {
	subscribe(onStoreChange: () => void): () => void;
	getSnapshot(): PortalSnapshot<TRowData>;
	subscribeToCell?(cellKey: string, listener: () => void): () => void;
	getCellData?(cellKey: string): PortalData<TRowData> | undefined;
}

interface RowPortalData<TRowData = unknown> {
	rowKey: string;
	container: HTMLElement;
	visualRow: VisualRow<TRowData>;
}

interface MenuPortalData<TRowData = unknown> {
	colField: string;
	container: HTMLElement;
	column: ColumnDef<TRowData>;
	close: () => void;
}

interface PortalSnapshot<TRowData = unknown> {
	portals: Map<string, PortalData<TRowData>>;
	rowPortals: Map<string, RowPortalData<TRowData>>;
	menuPortals: Map<string, MenuPortalData<TRowData>>;
	cellPortalList: PortalData<TRowData>[];
	rowPortalList: RowPortalData<TRowData>[];
	menuPortalList: MenuPortalData<TRowData>[];
}

export function createPortalStore<TRowData = unknown>() {
	const portals = new Map<string, PortalData<TRowData>>();
	const rowPortals = new Map<string, RowPortalData<TRowData>>();
	const menuPortals = new Map<string, MenuPortalData<TRowData>>();
	const cellPortalKeyByContainer = new Map<HTMLElement, string>();
	const rowPortalKeyByContainer = new Map<HTMLElement, string>();

	const cellListeners = new Map<string, Set<() => void>>();
	const listeners = new Set<() => void>();
	let snapshot = createSnapshot();
	let scheduled = false;

	function createSnapshot(): PortalSnapshot<TRowData> {
		return {
			portals: new Map(portals),
			rowPortals: new Map(rowPortals),
			menuPortals: new Map(menuPortals),
			cellPortalList: Array.from(portals.values()),
			rowPortalList: Array.from(rowPortals.values()).filter(
				(portal) => !portal.container.classList.contains('og-row-portal-host') || portal.container.dataset.rowKey === portal.rowKey
			),
			menuPortalList: Array.from(menuPortals.values()),
		};
	}

	function subscribe(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function getSnapshot() {
		return snapshot;
	}

	function notify(sync = false) {
		if (sync) {
			scheduled = false;
			flushSync(() => {
				for (const l of listeners) l();
			});
			return;
		}

		if (scheduled) return;
		scheduled = true;
		queueMicrotask(() => {
			scheduled = false;
			for (const l of listeners) l();
		});
	}

	return {
		subscribe,
		getSnapshot,
		subscribeToCell(cellKey: string, listener: () => void) {
			let list = cellListeners.get(cellKey);
			if (!list) {
				list = new Set();
				cellListeners.set(cellKey, list);
			}
			list.add(listener);
			return () => {
				const list = cellListeners.get(cellKey);
				if (list) {
					list.delete(listener);
					if (list.size === 0) {
						cellListeners.delete(cellKey);
					}
				}
			};
		},
		getCellData(cellKey: string) {
			return portals.get(cellKey);
		},
		mountCell(
			cellKey: string,
			container: HTMLElement,
			value: unknown,
			node: RowNode<TRowData>,
			col: ColumnDef<TRowData>,
			isEditing: boolean,
			isLoading: boolean,
			phase?: CellRendererPhase,
			isScrolling?: boolean,
			isFocused?: boolean,
			isSelected?: boolean
		) {
			const existing = portals.get(cellKey);
			if (
				existing &&
				existing.container === container &&
				existing.isEditing === isEditing &&
				existing.isLoading === isLoading &&
				existing.phase === phase &&
				existing.isScrolling === isScrolling &&
				existing.isFocused === isFocused &&
				existing.isSelected === isSelected &&
				existing.value === value &&
				existing.node === node &&
				existing.col === col
			) {
				cellPortalKeyByContainer.set(container, cellKey);
				return;
			}
			if (existing && existing.container !== container && cellPortalKeyByContainer.get(existing.container) === cellKey) {
				cellPortalKeyByContainer.delete(existing.container);
			}

			const existingKeyForContainer = cellPortalKeyByContainer.get(container);
			if (existingKeyForContainer && existingKeyForContainer !== cellKey) {
				portals.delete(existingKeyForContainer);
			}

			const isStructuralChange =
				!existing || existing.container !== container || (existingKeyForContainer && existingKeyForContainer !== cellKey);

			portals.set(cellKey, {
				cellKey,
				container,
				value,
				node,
				col,
				isEditing,
				isLoading,
				phase,
				isScrolling,
				isFocused,
				isSelected,
			});
			cellPortalKeyByContainer.set(container, cellKey);
			snapshot = createSnapshot();

			if (isStructuralChange) {
				notify();
			} else {
				const list = cellListeners.get(cellKey);
				if (list) {
					for (const l of list) l();
				}
			}
		},
		unmountCell(cellKey: string, container?: HTMLElement, sync = false) {
			const existing = portals.get(cellKey);
			if (!existing || (container && existing.container !== container)) return;
			portals.delete(cellKey);
			if (cellPortalKeyByContainer.get(existing.container) === cellKey) {
				cellPortalKeyByContainer.delete(existing.container);
			}
			snapshot = createSnapshot();
			notify(sync);
		},
		flushCell(sync = false) {
			snapshot = createSnapshot();
			notify(sync);
		},
		mountRow(rowKey: string, container: HTMLElement, visualRow: VisualRow<TRowData>) {
			const existing = rowPortals.get(rowKey);
			if (existing && existing.container === container && existing.visualRow === visualRow) {
				rowPortalKeyByContainer.set(container, rowKey);
				return;
			}
			if (existing && existing.container !== container && rowPortalKeyByContainer.get(existing.container) === rowKey) {
				rowPortalKeyByContainer.delete(existing.container);
			}

			const existingKeyForContainer = rowPortalKeyByContainer.get(container);
			if (existingKeyForContainer && existingKeyForContainer !== rowKey) {
				rowPortals.delete(existingKeyForContainer);
			}

			rowPortals.set(rowKey, {
				rowKey,
				container,
				visualRow,
			});
			rowPortalKeyByContainer.set(container, rowKey);
			snapshot = createSnapshot();
			notify();
		},
		unmountRow(rowKey: string, container?: HTMLElement) {
			const existing = rowPortals.get(rowKey);
			if (!existing || (container && existing.container !== container)) return;
			rowPortals.delete(rowKey);
			if (rowPortalKeyByContainer.get(existing.container) === rowKey) {
				rowPortalKeyByContainer.delete(existing.container);
			}
			snapshot = createSnapshot();
			notify();
		},
		mountMenu(colField: string, container: HTMLElement, column: ColumnDef<TRowData>, close: () => void) {
			const existing = menuPortals.get(colField);
			if (existing && existing.container === container && existing.column === column) {
				return;
			}

			menuPortals.set(colField, {
				colField,
				container,
				column,
				close,
			});
			snapshot = createSnapshot();
			notify();
		},
		unmountMenu(colField: string, container?: HTMLElement) {
			const existing = menuPortals.get(colField);
			if (!existing || (container && existing.container !== container)) return;
			menuPortals.delete(colField);
			snapshot = createSnapshot();
			notify();
		},
		clear() {
			portals.clear();
			rowPortals.clear();
			menuPortals.clear();
			cellPortalKeyByContainer.clear();
			rowPortalKeyByContainer.clear();
			snapshot = createSnapshot();
			notify();
		},
	};
}

export interface PortalManagerProps<TRowData = unknown> {
	portals?: Map<string, PortalData<TRowData>>;
	rowPortals?: Map<string, RowPortalData<TRowData>>;
	menuPortals?: Map<string, MenuPortalData<TRowData>>;
	api: GridApi<TRowData>;
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	store?: PortalStore<TRowData>;
}

interface PortalCellWrapperProps<TRowData = unknown> {
	cellKey: string;
	store: PortalStore<TRowData>;
}

function PortalCellWrapperInner<TRowData = unknown>({ cellKey, store }: PortalCellWrapperProps<TRowData>) {
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			if (store.subscribeToCell) {
				return store.subscribeToCell(cellKey, onStoreChange);
			}
			return () => {};
		},
		[store, cellKey]
	);

	const getSnapshot = useCallback(() => {
		if (store.getCellData) {
			return store.getCellData(cellKey);
		}
		return undefined;
	}, [store, cellKey]);

	const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	if (!data) return null;

	return (
		<PortalCell<TRowData>
			rowId={data.node.id}
			colField={data.col.field}
			value={data.value}
			col={data.col}
			node={data.node}
			isEditing={data.isEditing}
			isLoading={data.isLoading}
			phase={data.phase}
			isScrolling={data.isScrolling}
			isFocused={data.isFocused}
			isSelected={data.isSelected}
		/>
	);
}

const PortalCellWrapper = memo(PortalCellWrapperInner) as typeof PortalCellWrapperInner;

export function PortalManager<TRowData = unknown>({
	portals: directPortals,
	rowPortals: directRowPortals,
	menuPortals: directMenuPortals,
	api,
	groupRowRenderer,
	detailRowRenderer,
	store,
}: PortalManagerProps<TRowData>) {
	const fallbackSnapshotRef = useRef<any>(null);
	const prevPropsRef = useRef<any>(null);

	const getSnapshot = useCallback((): PortalSnapshot<TRowData> => {
		if (store) {
			return store.getSnapshot();
		}
		if (
			!fallbackSnapshotRef.current ||
			!prevPropsRef.current ||
			prevPropsRef.current.portals !== directPortals ||
			prevPropsRef.current.rowPortals !== directRowPortals ||
			prevPropsRef.current.menuPortals !== directMenuPortals
		) {
			prevPropsRef.current = {
				portals: directPortals,
				rowPortals: directRowPortals,
				menuPortals: directMenuPortals,
			};
			fallbackSnapshotRef.current = {
				portals: directPortals || new Map(),
				rowPortals: directRowPortals || new Map(),
				menuPortals: directMenuPortals || new Map(),
				cellPortalList: latestPortalsByContainer(directPortals || new Map()),
				rowPortalList: latestRowPortalsByContainer(directRowPortals || new Map()),
				menuPortalList: Array.from((directMenuPortals || new Map()).values()),
			};
		}
		return fallbackSnapshotRef.current;
	}, [store, directPortals, directRowPortals, directMenuPortals]);

	const state = useSyncExternalStore(store ? store.subscribe : (onStoreChange) => () => {}, getSnapshot, getSnapshot);

	const cellPortals = state.cellPortalList;
	const visualRowPortals = state.rowPortalList;

	return (
		<>
			{cellPortals.map((p) => {
				const content = store ? (
					<PortalCellWrapper<TRowData> cellKey={p.cellKey} store={store} />
				) : (
					<PortalCell<TRowData>
						rowId={p.node.id}
						colField={p.col.field}
						value={p.value}
						col={p.col}
						node={p.node}
						isEditing={p.isEditing}
						isLoading={p.isLoading}
						phase={p.phase}
						isScrolling={p.isScrolling}
						isFocused={p.isFocused}
						isSelected={p.isSelected}
					/>
				);
				return createPortal(
					<GridProvider api={api} key={p.cellKey}>
						{content}
					</GridProvider>,
					p.container
				);
			})}
			{visualRowPortals.map((rp) => {
				const { rowKey, container, visualRow } = rp;
				let content: React.ReactNode = null;
				if (visualRow.kind === 'group') {
					content = groupRowRenderer ? groupRowRenderer({ visualRow, api }) : <DefaultGroupRowRenderer visualRow={visualRow} api={api} />;
				} else if (visualRow.kind === 'detail') {
					content = detailRowRenderer ? (
						detailRowRenderer({ visualRow, api })
					) : (
						<DefaultDetailRowRenderer visualRow={visualRow} api={api} />
					);
				}
				return createPortal(
					<GridProvider api={api} key={rowKey}>
						{content}
					</GridProvider>,
					container
				);
			})}
			{state.menuPortalList.map((mp) => {
				const { colField, container, column, close } = mp;
				const CustomComponent = column.headerMenuComponent;
				if (!CustomComponent) return null;
				return createPortal(
					<GridProvider api={api} key={`menu-${colField}`}>
						<CustomComponent colField={colField} column={column} api={api} close={close} />
					</GridProvider>,
					container
				);
			})}
		</>
	);
}

function latestPortalsByContainer<TPortal extends { container: HTMLElement }>(portals: Map<string, TPortal>): TPortal[] {
	const byContainer = new Map<HTMLElement, TPortal>();
	for (const portal of portals.values()) {
		byContainer.set(portal.container, portal);
	}
	return Array.from(byContainer.values());
}

function latestRowPortalsByContainer<TRowData>(
	portals: Map<string, { rowKey: string; container: HTMLElement; visualRow: VisualRow<TRowData> }>
): Array<{ rowKey: string; container: HTMLElement; visualRow: VisualRow<TRowData> }> {
	const byContainer = new Map<HTMLElement, { rowKey: string; container: HTMLElement; visualRow: VisualRow<TRowData> }>();
	for (const portal of portals.values()) {
		if (portal.container.classList.contains('og-row-portal-host') && portal.container.dataset.rowKey !== portal.rowKey) {
			continue;
		}
		byContainer.set(portal.container, portal);
	}
	return Array.from(byContainer.values());
}
