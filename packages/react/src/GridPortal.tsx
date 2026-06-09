import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	memo,
	forwardRef,
	useImperativeHandle,
	createElement,
	type ComponentType,
} from 'react';
import { ColumnDef, GridApi, RowNode, VisualRow, type CellRendererPhase, type ImperativeCellHandle, isDomCellRenderer } from '@open-grid/core';
import type { InternalColumnDef } from '@open-grid/core/internal';
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

	const CustomEditor = col?.cellEditor as ComponentType<Record<string, unknown>> | undefined;
	// DomCellRenderer is an object ({mount}), memo/forwardRef are exotic objects — use isDomCellRenderer guard
	const iCol = col as InternalColumnDef | undefined;
	const CustomRenderer =
		iCol?.cellRenderer && !isDomCellRenderer(iCol.cellRenderer)
			? (iCol.cellRenderer as unknown as ComponentType<Record<string, unknown>>)
			: undefined;

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
						{createElement(CustomEditor, {
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
				createElement(CustomRenderer, {
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

function DefaultFooterRowRendererInner<TRowData = unknown>({ visualRow }: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) {
	if (visualRow.kind !== 'footer') return null;
	const agg = visualRow.aggregateValues;
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				height: '100%',
				paddingLeft: 12,
				gap: 12,
				fontSize: 11,
				color: 'var(--og-header-text)',
				fontWeight: 600,
			}}
		>
			<span style={{ color: 'rgba(167,139,250,0.6)', fontWeight: 700, fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
				Subtotal
			</span>
			{agg &&
				Object.entries(agg).map(([field, value]) =>
					value != null ? (
						<span key={field} style={{ color: '#94a3b8' }}>
							<span style={{ opacity: 0.6 }}>{field}: </span>
							<span style={{ color: '#e2e8f0' }}>
								{typeof value === 'number' && value > 1000 ? `$${value.toLocaleString()}` : String(value)}
							</span>
						</span>
					) : null
				)}
		</div>
	);
}

export const DefaultFooterRowRenderer = memo(DefaultFooterRowRendererInner) as typeof DefaultFooterRowRendererInner;

// ─── Snapshot types ───────────────────────────────────────────────────────────

/** Snapshot used by the optimised CellPortalPool — rebuilt only on structural changes (add/remove). */
export interface CellPortalSnapshot<TRowData = unknown> {
	cellPortalList: PortalData<TRowData>[];
}

/** Snapshot used by the RowMenuPortalPool — rebuilt only on row/menu structural changes. */
export interface RowMenuPortalSnapshot<TRowData = unknown> {
	rowPortalList: RowPortalData<TRowData>[];
	menuPortalList: MenuPortalData<TRowData>[];
}

// Imperative updater fn type — registered by ImperativePortalCellWrapper, called from OpenGrid
type ImperativeUpdaterFn<TRowData> = (
	value: unknown,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	isEditing: boolean,
	isLoading: boolean,
	phase: CellRendererPhase | undefined,
	isScrolling: boolean | undefined,
	isFocused: boolean | undefined,
	isSelected: boolean | undefined
) => boolean;

export interface PortalStore<TRowData = unknown> {
	subscribeToCell?(cellKey: string, listener: () => void): () => void;
	getCellData?(cellKey: string): PortalData<TRowData> | undefined;
	// Optimised split subscriptions — implemented by createPortalStore
	subscribeCells?(listener: () => void): () => void;
	getCellSnapshot?(): CellPortalSnapshot<TRowData>;
	subscribeRowsMenus?(listener: () => void): () => void;
	getRowMenuSnapshot?(): RowMenuPortalSnapshot<TRowData>;
	// Imperative update protocol
	registerImperativeUpdater?(cellKey: string, fn: ImperativeUpdaterFn<TRowData>): void;
	unregisterImperativeUpdater?(cellKey: string): void;
	tryImperativeUpdate?(
		cellKey: string,
		value: unknown,
		node: RowNode<TRowData>,
		col: ColumnDef<TRowData>,
		isEditing: boolean,
		isLoading: boolean,
		phase: CellRendererPhase | undefined,
		isScrolling: boolean | undefined,
		isFocused: boolean | undefined,
		isSelected: boolean | undefined
	): boolean;
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

// ─── Portal store ─────────────────────────────────────────────────────────────

export function createPortalStore<TRowData = unknown>() {
	// Mutable maps — source of truth
	const portals = new Map<string, PortalData<TRowData>>();
	const rowPortals = new Map<string, RowPortalData<TRowData>>();
	const menuPortals = new Map<string, MenuPortalData<TRowData>>();
	const cellPortalKeyByContainer = new Map<HTMLElement, string>();
	const rowPortalKeyByContainer = new Map<HTMLElement, string>();

	// Per-cell data listeners — fired when a cell's value/props change (not structure)
	const cellDataListeners = new Map<string, Set<() => void>>();

	// Structural listeners — fired when the set of cells/rows/menus changes
	const cellStructuralListeners = new Set<() => void>();
	const rowMenuStructuralListeners = new Set<() => void>();

	// Imperative updaters — registered by ImperativePortalCellWrapper, bypasses React scheduler
	const imperativeUpdaters = new Map<string, ImperativeUpdaterFn<TRowData>>();

	// Snapshots — only rebuilt on structural changes; CellPortalPool's useSyncExternalStore
	// bails out on data updates (cellSnapshot reference unchanged) so only structural changes
	// cause the pool to re-render. Per-cell data flows through PortalCellWrapper's useState.
	let cellSnapshot: CellPortalSnapshot<TRowData> = { cellPortalList: [] };
	let rowMenuSnapshot: RowMenuPortalSnapshot<TRowData> = { rowPortalList: [], menuPortalList: [] };

	// Coalescing flags — one microtask per notification type
	let cellStructuralScheduled = false;
	let rowMenuScheduled = false;

	// ── Snapshot builders ──────────────────────────────────────────────────────

	function rebuildCellSnapshot() {
		cellSnapshot = { cellPortalList: Array.from(portals.values()) };
	}

	function rebuildRowMenuSnapshot() {
		rowMenuSnapshot = {
			rowPortalList: Array.from(rowPortals.values()).filter(
				(p) => !p.container.classList.contains('og-row-portal-host') || p.container.dataset.rowKey === p.rowKey
			),
			menuPortalList: Array.from(menuPortals.values()),
		};
	}

	// ── Notification helpers ───────────────────────────────────────────────────

	function notifyCellStructural(sync = false) {
		if (sync) {
			flushSync(() => {
				for (const l of cellStructuralListeners) l();
			});
			return;
		}
		if (cellStructuralScheduled) return;
		cellStructuralScheduled = true;
		queueMicrotask(() => {
			cellStructuralScheduled = false;
			for (const l of cellStructuralListeners) l();
		});
	}

	function notifyRowMenuStructural() {
		if (rowMenuScheduled) return;
		rowMenuScheduled = true;
		queueMicrotask(() => {
			rowMenuScheduled = false;
			for (const l of rowMenuStructuralListeners) l();
		});
	}

	// Synchronous — called directly during the grid's paint loop so React can batch all cell updates
	function notifyCellData(cellKey: string) {
		const list = cellDataListeners.get(cellKey);
		if (list) for (const l of list) l();
	}

	// ── Public API ─────────────────────────────────────────────────────────────

	return {
		// Per-cell data subscription — PortalCellWrapper subscribes here for value/props updates
		subscribeToCell(cellKey: string, listener: () => void) {
			let list = cellDataListeners.get(cellKey);
			if (!list) {
				list = new Set();
				cellDataListeners.set(cellKey, list);
			}
			list.add(listener);
			return () => {
				const l = cellDataListeners.get(cellKey);
				if (l) {
					l.delete(listener);
					if (l.size === 0) cellDataListeners.delete(cellKey);
				}
			};
		},
		// Direct read — PortalCellWrapper reads here on each re-render (no snapshot allocation)
		getCellData(cellKey: string) {
			return portals.get(cellKey);
		},

		// ── Optimised split subscriptions ────────────────────────────────────────
		subscribeCells(listener: () => void) {
			cellStructuralListeners.add(listener);
			return () => {
				cellStructuralListeners.delete(listener);
			};
		},
		getCellSnapshot() {
			return cellSnapshot;
		},

		subscribeRowsMenus(listener: () => void) {
			rowMenuStructuralListeners.add(listener);
			return () => {
				rowMenuStructuralListeners.delete(listener);
			};
		},
		getRowMenuSnapshot() {
			return rowMenuSnapshot;
		},

		// ── Imperative update protocol ────────────────────────────────────────────
		registerImperativeUpdater(cellKey: string, fn: ImperativeUpdaterFn<TRowData>) {
			imperativeUpdaters.set(cellKey, fn);
		},
		unregisterImperativeUpdater(cellKey: string) {
			imperativeUpdaters.delete(cellKey);
		},
		tryImperativeUpdate(
			cellKey: string,
			value: unknown,
			node: RowNode<TRowData>,
			col: ColumnDef<TRowData>,
			isEditing: boolean,
			isLoading: boolean,
			phase: CellRendererPhase | undefined,
			isScrolling: boolean | undefined,
			isFocused: boolean | undefined,
			isSelected: boolean | undefined
		): boolean {
			const fn = imperativeUpdaters.get(cellKey);
			if (!fn) return false;
			return fn(value, node, col, isEditing, isLoading, phase, isScrolling, isFocused, isSelected);
		},

		// ── Cell mounts ──────────────────────────────────────────────────────────
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

			// Full equality check — skip everything when nothing changed
			if (
				existing &&
				existing.container === container &&
				existing.value === value &&
				existing.node === node &&
				existing.col === col &&
				existing.isEditing === isEditing &&
				existing.isLoading === isLoading &&
				existing.phase === phase &&
				existing.isScrolling === isScrolling &&
				existing.isFocused === isFocused &&
				existing.isSelected === isSelected
			) {
				cellPortalKeyByContainer.set(container, cellKey);
				return;
			}

			// Container/key conflict resolution
			if (existing && existing.container !== container && cellPortalKeyByContainer.get(existing.container) === cellKey) {
				cellPortalKeyByContainer.delete(existing.container);
			}
			const existingKeyForContainer = cellPortalKeyByContainer.get(container);
			if (existingKeyForContainer && existingKeyForContainer !== cellKey) {
				portals.delete(existingKeyForContainer);
			}

			// A structural change means the SET of cell keys changed, not just the data
			const isStructuralChange =
				!existing || existing.container !== container || (existingKeyForContainer != null && existingKeyForContainer !== cellKey);

			portals.set(cellKey, { cellKey, container, value, node, col, isEditing, isLoading, phase, isScrolling, isFocused, isSelected });
			cellPortalKeyByContainer.set(container, cellKey);

			if (isStructuralChange) {
				// Rebuild snapshots — PortalPool components must re-render to add/remove portals
				rebuildCellSnapshot();
				notifyCellStructural();
			} else {
				// Data update only — notify the specific PortalCellWrapper, skip snapshot rebuild.
				notifyCellData(cellKey);
			}
		},

		unmountCell(cellKey: string, container?: HTMLElement, sync = false) {
			const existing = portals.get(cellKey);
			if (!existing || (container && existing.container !== container)) return;
			portals.delete(cellKey);
			if (cellPortalKeyByContainer.get(existing.container) === cellKey) {
				cellPortalKeyByContainer.delete(existing.container);
			}
			imperativeUpdaters.delete(cellKey);
			rebuildCellSnapshot();
			notifyCellStructural(sync);
		},

		flushCell(sync = false) {
			rebuildCellSnapshot();
			notifyCellStructural(sync);
		},

		// ── Row mounts ───────────────────────────────────────────────────────────
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
			rowPortals.set(rowKey, { rowKey, container, visualRow });
			rowPortalKeyByContainer.set(container, rowKey);
			rebuildRowMenuSnapshot();
			notifyRowMenuStructural();
		},

		unmountRow(rowKey: string, container?: HTMLElement) {
			const existing = rowPortals.get(rowKey);
			if (!existing || (container && existing.container !== container)) return;
			rowPortals.delete(rowKey);
			if (rowPortalKeyByContainer.get(existing.container) === rowKey) {
				rowPortalKeyByContainer.delete(existing.container);
			}
			rebuildRowMenuSnapshot();
			notifyRowMenuStructural();
		},

		// ── Menu mounts ──────────────────────────────────────────────────────────
		mountMenu(colField: string, container: HTMLElement, column: ColumnDef<TRowData>, close: () => void) {
			const existing = menuPortals.get(colField);
			if (existing && existing.container === container && existing.column === column) return;
			menuPortals.set(colField, { colField, container, column, close });
			rebuildRowMenuSnapshot();
			notifyRowMenuStructural();
		},

		unmountMenu(colField: string, container?: HTMLElement) {
			const existing = menuPortals.get(colField);
			if (!existing || (container && existing.container !== container)) return;
			menuPortals.delete(colField);
			rebuildRowMenuSnapshot();
			notifyRowMenuStructural();
		},

		clear() {
			portals.clear();
			rowPortals.clear();
			menuPortals.clear();
			cellPortalKeyByContainer.clear();
			rowPortalKeyByContainer.clear();
			cellDataListeners.clear();
			imperativeUpdaters.clear();
			rebuildCellSnapshot();
			rebuildRowMenuSnapshot();
			notifyCellStructural();
			notifyRowMenuStructural();
		},
	};
}

// ─── PortalCellWrapper ────────────────────────────────────────────────────────

interface PortalCellWrapperProps<TRowData = unknown> {
	cellKey: string;
	store: PortalStore<TRowData>;
}

/**
 * Slot-pinned cell adapter. Stays mounted for the lifetime of the cell slot.
 *
 * Data updates flow through useState + useEffect rather than useSyncExternalStore.
 * This has two key benefits:
 *
 *   1. No synchronous React re-renders during scroll frames — React 18 automatic
 *      batching defers all post-scroll setData calls into a single reconciliation
 *      cycle, keeping the animation loop free of React scheduler overhead.
 *
 *   2. lastKnownRef prevents blank-cell flashes: if the store data is transiently
 *      undefined during a concurrent-mode render pass (structural change in flight,
 *      slot-reassignment race, etc.) the last known good data is rendered instead of
 *      returning null and briefly blanking the cell.
 */
function PortalCellWrapperInner<TRowData = unknown>({ cellKey, store }: PortalCellWrapperProps<TRowData>) {
	// Initialise synchronously from the store so the very first render has real data.
	const [data, setData] = useState<PortalData<TRowData> | undefined>(() => store.getCellData?.(cellKey));

	// Preserve the last non-undefined snapshot. Rendered when data is momentarily
	// absent so the cell never goes blank during transitions.
	const lastKnownRef = useRef(data);
	if (data !== undefined) lastKnownRef.current = data;

	useEffect(() => {
		// Cover the render→effect gap: sync with the store in case it was mutated
		// between the initial render and this effect running (rare under concurrent mode).
		const current = store.getCellData?.(cellKey);
		if (current !== lastKnownRef.current) {
			setData(current);
		}
		// Subscribe to all future data-only updates for this cell key.
		if (!store.subscribeToCell) return;
		return store.subscribeToCell(cellKey, () => {
			setData(store.getCellData?.(cellKey));
		});
	}, [cellKey, store]); // cellKey and store are both stable for this component's lifetime

	const effectiveData = data ?? lastKnownRef.current;
	if (!effectiveData) return null;

	return (
		<PortalCell<TRowData>
			rowId={effectiveData.node.id}
			colField={effectiveData.col.field}
			value={effectiveData.value}
			col={effectiveData.col}
			node={effectiveData.node}
			isEditing={effectiveData.isEditing}
			isLoading={effectiveData.isLoading}
			phase={effectiveData.phase}
			isScrolling={effectiveData.isScrolling}
			isFocused={effectiveData.isFocused}
			isSelected={effectiveData.isSelected}
		/>
	);
}

const PortalCellWrapper = memo(PortalCellWrapperInner) as typeof PortalCellWrapperInner;

// ─── ImperativePortalCellWrapper ──────────────────────────────────────────────

/**
 * Like PortalCellWrapper, but renders the renderer as a JSX element (not a function call)
 * so forwardRef works. Registers an imperative updater in the portal store — subsequent
 * data updates call ref.current.update() directly, bypassing React's scheduler entirely.
 *
 * Uses the same useState + lastKnownRef pattern as PortalCellWrapper: async-batched updates
 * and no blank-cell flashes. In practice notifyCellData is rarely called for imperative cells
 * (tryImperativeUpdate short-circuits it) so the subscription is mostly a safety net.
 */
function ImperativePortalCellWrapperInner<TRowData = unknown>({ cellKey, store }: PortalCellWrapperProps<TRowData>) {
	const api = useGridApi<TRowData>();
	const imperativeRef = useRef<ImperativeCellHandle<TRowData> | null>(null);
	// Keep api ref current without causing re-subscription
	const apiRef = useRef(api);
	apiRef.current = api;

	// useState + lastKnownRef: same blank-prevention & batching strategy as PortalCellWrapper.
	const [data, setData] = useState<PortalData<TRowData> | undefined>(() => store.getCellData?.(cellKey));
	const lastKnownRef = useRef(data);
	if (data !== undefined) lastKnownRef.current = data;

	useEffect(() => {
		const current = store.getCellData?.(cellKey);
		if (current !== lastKnownRef.current) setData(current);
		if (!store.subscribeToCell) return;
		return store.subscribeToCell(cellKey, () => setData(store.getCellData?.(cellKey)));
	}, [cellKey, store]);

	// Register imperative updater — called by OpenGrid instead of mountCell on data-only updates
	useEffect(() => {
		if (!store.registerImperativeUpdater) return;
		store.registerImperativeUpdater(cellKey, (value, node, col, isEditing, _isLoading, phase, isScrolling, isFocused, isSelected) => {
			const handle = imperativeRef.current;
			if (!handle) return false;
			handle.update({
				value,
				computedValue: value,
				row: node.data as TRowData,
				rowId: node.id,
				colField: col.field,
				colId: col.field,
				isScrolling: isScrolling ?? false,
				phase: phase ?? 'initial',
				isFocused: isFocused ?? false,
				isEditing,
				isSelected: isSelected ?? false,
				api: apiRef.current,
			});
			return true;
		});
		return () => {
			store.unregisterImperativeUpdater?.(cellKey);
		};
	}, [store, cellKey]);

	const effectiveData = data ?? lastKnownRef.current;
	if (!effectiveData) return null;

	const iColData = effectiveData.col as InternalColumnDef;
	const CustomRenderer = iColData.cellRenderer as unknown as React.ForwardRefExoticComponent<
		Record<string, unknown> & React.RefAttributes<unknown>
	>;
	const rowData = effectiveData.node?.data;

	if (!CustomRenderer || isDomCellRenderer(iColData.cellRenderer) || !rowData) return null;

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
			<CustomRenderer
				ref={imperativeRef as React.Ref<unknown>}
				value={effectiveData.value}
				computedValue={effectiveData.value}
				row={rowData as Record<string, unknown>}
				rowId={effectiveData.node.id}
				colField={effectiveData.col.field}
				colId={effectiveData.col.field}
				isScrolling={effectiveData.isScrolling ?? false}
				phase={effectiveData.phase ?? 'initial'}
				isFocused={effectiveData.isFocused ?? false}
				isEditing={effectiveData.isEditing}
				isSelected={effectiveData.isSelected ?? false}
				api={api as unknown as Record<string, unknown>}
			/>
		</div>
	);
}

const ImperativePortalCellWrapper = memo(ImperativePortalCellWrapperInner) as typeof ImperativePortalCellWrapperInner;

// ─── CellPortalPool ───────────────────────────────────────────────────────────

type ConcretePortalStore<TRowData> = ReturnType<typeof createPortalStore<TRowData>>;

interface CellPortalPoolProps<TRowData = unknown> {
	store: ConcretePortalStore<TRowData>;
	api: GridApi<TRowData>;
}

/**
 * Renders only custom cell portals. Re-renders only when the CELL SLOT LIST changes
 * (a cell enters or leaves the visible area). Individual cell value changes do NOT cause
 * this component to re-render — they go directly to PortalCellWrapper via subscribeToCell,
 * or are handled imperatively by ImperativePortalCellWrapper.
 */
function CellPortalPoolInner<TRowData = unknown>({ store, api }: CellPortalPoolProps<TRowData>) {
	const snapshot = useSyncExternalStore(store.subscribeCells, store.getCellSnapshot, store.getCellSnapshot);
	const { cellPortalList } = snapshot;

	return (
		<>
			{cellPortalList.map((p) => {
				const useImperative = !!(p.col as InternalColumnDef).cellRendererCapabilities?.imperativeUpdate;
				return createPortal(
					<GridProvider api={api} key={p.cellKey}>
						{useImperative ? (
							<ImperativePortalCellWrapper<TRowData> cellKey={p.cellKey} store={store} />
						) : (
							<PortalCellWrapper<TRowData> cellKey={p.cellKey} store={store} />
						)}
					</GridProvider>,
					p.container
				);
			})}
		</>
	);
}

const CellPortalPool = memo(CellPortalPoolInner) as typeof CellPortalPoolInner;

// ─── RowMenuPortalPool ────────────────────────────────────────────────────────

interface RowMenuPortalPoolProps<TRowData = unknown> {
	store: ConcretePortalStore<TRowData>;
	api: GridApi<TRowData>;
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	footerRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
}

/**
 * Renders group/detail/footer row portals and header menu portals. Re-renders only when rows
 * or menus change — completely isolated from custom cell updates.
 */
function RowMenuPortalPoolInner<TRowData = unknown>({
	store,
	api,
	groupRowRenderer,
	detailRowRenderer,
	footerRowRenderer,
}: RowMenuPortalPoolProps<TRowData>) {
	const snapshot = useSyncExternalStore(store.subscribeRowsMenus, store.getRowMenuSnapshot, store.getRowMenuSnapshot);
	const { rowPortalList, menuPortalList } = snapshot;

	return (
		<>
			{rowPortalList.map((rp) => {
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
				} else if (visualRow.kind === 'footer') {
					content = footerRowRenderer ? (
						footerRowRenderer({ visualRow, api })
					) : (
						<DefaultFooterRowRenderer visualRow={visualRow} api={api} />
					);
				}
				return createPortal(
					<GridProvider api={api} key={rowKey}>
						{content}
					</GridProvider>,
					container
				);
			})}
			{menuPortalList.map((mp) => {
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

const RowMenuPortalPool = memo(RowMenuPortalPoolInner) as typeof RowMenuPortalPoolInner;

// ─── PortalManager (public API) ───────────────────────────────────────────────

export interface PortalManagerProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	footerRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	store?: PortalStore<TRowData>;
}

/**
 * Renders all portal content for the grid.
 *
 * Cell updates and row/menu updates are completely isolated — a price-tick in one cell
 * never causes the row-portal tree to re-render, and a group-row expansion never causes
 * all cell wrappers to re-render.
 *
 * For cells with imperativeUpdate: true, updates bypass React's scheduler entirely —
 * the grid calls ref.current.update() directly in the paint loop.
 */
export function PortalManager<TRowData = unknown>({
	api,
	groupRowRenderer,
	detailRowRenderer,
	footerRowRenderer,
	store,
}: PortalManagerProps<TRowData>) {
	if (!store?.subscribeCells || !store?.subscribeRowsMenus) {
		// Store is required — OpenGrid always provides createPortalStore()
		return null;
	}
	const concreteStore = store as ConcretePortalStore<TRowData>;
	return (
		<>
			<CellPortalPool store={concreteStore} api={api} />
			<RowMenuPortalPool
				store={concreteStore}
				api={api}
				groupRowRenderer={groupRowRenderer}
				detailRowRenderer={detailRowRenderer}
				footerRowRenderer={footerRowRenderer}
			/>
		</>
	);
}
