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
	const gridState = api.getState();
	const focusedCell = gridState.selection.focus;
	const visualIndex = api.getVisualIndexByRowId(rowId);
	const isSelected =
		visualIndex !== null &&
		!!gridState.selection.bounds &&
		visualIndex >= gridState.selection.bounds.minRow &&
		visualIndex <= gridState.selection.bounds.maxRow;

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
					isFocused: focusedCell?.rowId === rowId && focusedCell?.colField === colField,
					isEditing,
					isSelected,
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
	getSnapshot(): {
		portals: Map<string, PortalData<TRowData>>;
		rowPortals: Map<string, { rowKey: string; container: HTMLElement; visualRow: VisualRow<TRowData> }>;
		menuPortals: Map<string, { colField: string; container: HTMLElement; column: ColumnDef<TRowData>; close: () => void }>;
	};
}

export function createPortalStore<TRowData = unknown>() {
	const portals = new Map<string, PortalData<TRowData>>();
	const rowPortals = new Map<string, { rowKey: string; container: HTMLElement; visualRow: VisualRow<TRowData> }>();
	const menuPortals = new Map<string, { colField: string; container: HTMLElement; column: ColumnDef<TRowData>; close: () => void }>();

	const listeners = new Set<() => void>();
	let snapshot = { portals, rowPortals, menuPortals };
	let scheduled = false;

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
		snapshot = {
			portals: new Map(portals),
			rowPortals: new Map(rowPortals),
			menuPortals: new Map(menuPortals),
		};

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
		mountCell(
			cellKey: string,
			container: HTMLElement,
			value: unknown,
			node: RowNode<TRowData>,
			col: ColumnDef<TRowData>,
			isEditing: boolean,
			isLoading: boolean,
			phase?: CellRendererPhase,
			isScrolling?: boolean
		) {
			const existing = portals.get(cellKey);
			if (
				existing &&
				existing.container === container &&
				existing.isEditing === isEditing &&
				existing.isLoading === isLoading &&
				existing.phase === phase &&
				existing.isScrolling === isScrolling &&
				existing.value === value &&
				existing.node === node &&
				existing.col === col
			) {
				return;
			}

			for (const [existingKey, existingPortal] of portals) {
				if (existingKey !== cellKey && existingPortal.container === container) {
					portals.delete(existingKey);
				}
			}

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
			});
			notify();
		},
		unmountCell(cellKey: string, container?: HTMLElement, sync = false) {
			const existing = portals.get(cellKey);
			if (!existing || (container && existing.container !== container)) return;
			portals.delete(cellKey);
			notify(sync);
		},
		flushCell(sync = false) {
			notify(sync);
		},
		mountRow(rowKey: string, container: HTMLElement, visualRow: VisualRow<TRowData>) {
			const existing = rowPortals.get(rowKey);
			if (existing && existing.container === container && existing.visualRow === visualRow) {
				return;
			}

			for (const [existingKey, existingPortal] of rowPortals) {
				if (existingKey !== rowKey && existingPortal.container === container) {
					rowPortals.delete(existingKey);
				}
			}

			rowPortals.set(rowKey, {
				rowKey,
				container,
				visualRow,
			});
			notify();
		},
		unmountRow(rowKey: string, container?: HTMLElement) {
			const existing = rowPortals.get(rowKey);
			if (!existing || (container && existing.container !== container)) return;
			rowPortals.delete(rowKey);
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
			notify();
		},
		unmountMenu(colField: string, container?: HTMLElement) {
			const existing = menuPortals.get(colField);
			if (!existing || (container && existing.container !== container)) return;
			menuPortals.delete(colField);
			notify();
		},
		clear() {
			portals.clear();
			rowPortals.clear();
			menuPortals.clear();
			notify();
		},
	};
}

export interface PortalManagerProps<TRowData = unknown> {
	portals?: Map<string, PortalData<TRowData>>;
	rowPortals?: Map<string, { rowKey: string; container: HTMLElement; visualRow: VisualRow<TRowData> }>;
	menuPortals?: Map<string, { colField: string; container: HTMLElement; column: ColumnDef<TRowData>; close: () => void }>;
	api: GridApi<TRowData>;
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	store?: PortalStore<TRowData>;
}

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

	const getSnapshot = useCallback((): {
		portals: Map<string, PortalData<TRowData>>;
		rowPortals: Map<string, { rowKey: string; container: HTMLElement; visualRow: VisualRow<TRowData> }>;
		menuPortals: Map<string, { colField: string; container: HTMLElement; column: ColumnDef<TRowData>; close: () => void }>;
	} => {
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
			};
		}
		return fallbackSnapshotRef.current;
	}, [store, directPortals, directRowPortals, directMenuPortals]);

	const state = useSyncExternalStore(store ? store.subscribe : (onStoreChange) => () => {}, getSnapshot, getSnapshot);

	const cellPortals = latestPortalsByContainer(state.portals);
	const visualRowPortals = latestRowPortalsByContainer(state.rowPortals);

	return (
		<>
			{cellPortals.map((p) => {
				return createPortal(
					<GridProvider api={api} key={p.cellKey}>
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
						/>
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
			{Array.from(state.menuPortals.values()).map((mp) => {
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
