import type { GridEngine } from '../engine/GridEngine.js';
import type { CellRendererPhase, ColumnDef, ColumnInstanceId, InternalColumnDef } from '../columnDef.js';
import { getColumnInstanceIdentity } from '../columnDef.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import { CellSlot, recordCellSlotMountedVisualVersions } from './cellSlot.js';
import { bindCellDuringScroll, bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import type { RowSlot } from './rowSlot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { CompiledColumnTopology } from './columnTopology.js';
import type { ViewportPlan } from './viewportPlanner.js';
import { GridMetric, type GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import { collectCellDecorationSnapshotMetadata, createCellDisplaySnapshot } from './cellDisplaySnapshot.js';
import { applyCellSlotRetentionPolicy } from './cellSlotRetention.js';
import { resolveWarmVisibleCellStatus } from './warmCellStatus.js';
import { createRowCtrl } from './controllers/RowCtrl.js';

/** Minimal mutable sink for cell-slot retention counters — see renderTelemetry.ts RenderRuntimeStats. */
export interface CellSlotRetentionTelemetrySink {
	cellSlotsRetained: number;
	cellSlotsEvictedDuringTopology: number;
	cellSlotsCreatedDuringTopology: number;
	cellSlotsReusedDuringTopology: number;
	maxCellsByColumnIdPerRowSlot: number;
}

export interface RowCellLaneFullBindRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	slotId: string;
	slotGeneration: number;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	pinRightBaseLeft: number;
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	state: InternalGridState<TRowData>;
	isScrollFrameActive: boolean;
	ctx?: ScrollRenderContext<TRowData>;
	phase?: CellRendererPhase;
}

export interface RowCellLaneScrollBindRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	ctx: ScrollRenderContext<TRowData>;
	pooledRowId: string;
	pooledRowGeneration: number;
	left: number;
	right: number;
	width: number;
	isRowRebind: boolean;
	isRowLoading: boolean;
}

export interface RowCellBindingLaneDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	initCell: (el: HTMLDivElement) => void;
	releaseCellFn: (cell: CellSlot<TRowData>) => void;
	ensurePinnedContainer: (slot: RowSlot<TRowData>, side: 'left' | 'right', width: number) => HTMLDivElement | null;
	cellBinderDeps: RowCellBinderDeps<TRowData>;
	markCellDirtyAfterScroll: (cell: HTMLDivElement) => void;
	releaseCellPortal: (cell: HTMLDivElement, forceDeferred?: boolean, reason?: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated') => void;
	ensureLoadingSkeleton: (cell: HTMLDivElement) => void;
	onScrollCellVisited: () => void;
	onScrollCellPatched: () => void;
	onScrollCellWritten: () => void;
	retentionStats?: CellSlotRetentionTelemetrySink;
}

export interface BindAllDataCellsRequest<TRowData = unknown> {
	slot: RowSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	centerColStart: number;
	centerColCount: number;
	columns: ColumnDef<TRowData>[];
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	/** Authoritative column topology for lane membership and lane-relative offsets. */
	columnTopology: CompiledColumnTopology;
	isScrollFrameActive: boolean;
	ctx?: ScrollRenderContext<TRowData>;
	state: InternalGridState<TRowData>;
	isRowRebind: boolean;
	forceCellRefresh: boolean;
	isRowVisible: boolean;
	refreshVisibleColumns?: ReadonlySet<number> | null;
	viewportPlan?: ViewportPlan | null;
}

export interface BindAllLoadingCellsRequest<TRowData = unknown> {
	slot: RowSlot<TRowData>;
	rowIndex: number;
	centerColStart: number;
	centerColCount: number;
	columns: ColumnDef<TRowData>[];
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	/** Authoritative column topology for lane membership and lane-relative offsets. */
	columnTopology: CompiledColumnTopology;
	isScrollFrameActive: boolean;
}

/**
 * Reconciles the three lane arrays on a RowSlot to match a new column topology without
 * destroying cells for columns that merely changed lanes (pin/unpin relocation).
 *
 * Algorithm:
 *  1. Destroy cells for columns that have left the rendered set entirely.
 *  2. For each column in the new topology — create a cell if new, otherwise reuse the
 *     existing cell. If the cell is in the wrong DOM container, relocate it (move the
 *     element) without touching its portal host or renderer state.
 *  3. Rebuild the leftCells / centerCells / rightCells arrays in column order.
 */
function reconcileTopology<TRowData>(
	slot: RowSlot<TRowData>,
	topology: CompiledColumnTopology,
	pinLeftContainer: HTMLDivElement | null,
	centerColStart: number,
	centerColCount: number,
	pinRightContainer: HTMLDivElement | null,
	columns: readonly ColumnDef<TRowData>[],
	initFn: (el: HTMLDivElement) => void,
	releaseFn: (cell: CellSlot<TRowData>) => void,
	instrumentation?: GridInstrumentation,
	retentionStats?: CellSlotRetentionTelemetrySink
): void {
	// Build the set of column instance ids in the new rendered topology.
	const newInstanceIds = new Set<ColumnInstanceId>();
	for (const p of topology.left) if (p.columnId) newInstanceIds.add(p.columnId);
	for (const p of topology.center) {
		if (p.absoluteIndex >= centerColStart && p.absoluteIndex < centerColStart + centerColCount) {
			if (p.columnId) newInstanceIds.add(p.columnId);
		}
	}
	for (const p of topology.right) if (p.columnId) newInstanceIds.add(p.columnId);

	// Step 1 — destroy cells for columns that exited the rendered set. This path already evicts
	// everything outside newInstanceIds unconditionally, so no bounded-retention policy is needed
	// here — only the same telemetry counters as the scroll-frame path, for a consistent picture.
	for (const [instanceId, cell] of slot.cellsByColumnInstanceId) {
		if (!newInstanceIds.has(instanceId)) {
			releaseFn(cell);
			if (cell.element.parentNode) cell.element.remove();
			slot.cellsByColumnInstanceId.delete(instanceId);
			instrumentation?.increment(GridMetric.CELL_VIEW_DESTROYED);
			if (retentionStats) retentionStats.cellSlotsEvictedDuringTopology++;
		}
	}

	// columnInstanceId is set at construction time — the cell's permanent column identity.
	// colField mirrors the display name and is guarded-written by update() in the bind loop.
	function ensureCell(instanceId: ColumnInstanceId): CellSlot<TRowData> {
		let cell = slot.cellsByColumnInstanceId.get(instanceId);
		if (!cell) {
			const el = document.createElement('div');
			initFn(el);
			cell = CellSlot.fromElement<TRowData>(el);
			cell.columnInstanceId = instanceId;
			slot.cellsByColumnInstanceId.set(instanceId, cell);
			instrumentation?.increment(GridMetric.CELL_VIEW_CREATED);
			if (retentionStats) retentionStats.cellSlotsCreatedDuringTopology++;
		} else if (retentionStats) {
			retentionStats.cellSlotsReusedDuringTopology++;
		}
		return cell;
	}

	// Step 2 & 3 — rebuild lane arrays from topology, creating or relocating cells as needed.
	slot.leftCells.length = 0;
	if (pinLeftContainer) {
		for (const p of topology.left) {
			const col = columns[p.absoluteIndex];
			if (!col?.field || !p.columnId) continue;
			const cell = ensureCell(p.columnId);
			if (cell.element.parentNode !== pinLeftContainer) {
				pinLeftContainer.appendChild(cell.element);
				instrumentation?.increment(GridMetric.CELL_VIEW_RELOCATED);
			}
			slot.leftCells.push(cell);
		}
	}

	slot.centerCells.length = 0;
	for (const p of topology.center) {
		const c = p.absoluteIndex;
		if (c < centerColStart || c >= centerColStart + centerColCount) continue;
		const col = columns[c];
		if (!col?.field || !p.columnId) continue;
		const cell = ensureCell(p.columnId);
		if (cell.element.parentNode !== slot.element) {
			slot.element.appendChild(cell.element);
			instrumentation?.increment(GridMetric.CELL_VIEW_RELOCATED);
		}
		slot.centerCells.push(cell);
	}

	slot.rightCells.length = 0;
	if (pinRightContainer) {
		for (const p of topology.right) {
			const col = columns[p.absoluteIndex];
			if (!col?.field || !p.columnId) continue;
			const cell = ensureCell(p.columnId);
			if (cell.element.parentNode !== pinRightContainer) {
				pinRightContainer.appendChild(cell.element);
				instrumentation?.increment(GridMetric.CELL_VIEW_RELOCATED);
			}
			slot.rightCells.push(cell);
		}
	}

	slot.centerColStart = centerColStart;
	slot.pinLeftCount = topology.left.length;
	slot.pinRightStart = topology.left.length + topology.center.length;
}

/**
 * Topology-owned scroll reconciliation: updates lane arrays to match the new center
 * window WITHOUT calling releaseFn for any cell. Columns that leave the center window
 * remain in `cellsByColumnInstanceId` and are reused when they scroll back into view.
 *
 * Invariant: `cellsByColumnInstanceId` is authoritative at all times — no drift is possible
 * because this path never allocates by count or recycles cells to different columns.
 */
function reconcileCellTopologyForScroll<TRowData>(
	slot: RowSlot<TRowData>,
	topology: CompiledColumnTopology,
	pinLeftContainer: HTMLDivElement | null,
	centerColStart: number,
	centerColCount: number,
	pinRightContainer: HTMLDivElement | null,
	columns: readonly ColumnDef<TRowData>[],
	initFn: (el: HTMLDivElement) => void,
	releaseFn?: (cell: CellSlot<TRowData>) => void,
	focusedColumnInstanceId?: ColumnInstanceId,
	instrumentation?: GridInstrumentation,
	retentionStats?: CellSlotRetentionTelemetrySink
): void {
	// Compute the set of column instance ids visible in this frame.
	const visibleInstanceIds = new Set<ColumnInstanceId>();
	if (pinLeftContainer) {
		for (const p of topology.left) {
			if (columns[p.absoluteIndex]?.field && p.columnId) visibleInstanceIds.add(p.columnId);
		}
	}
	for (const p of topology.center) {
		const c = p.absoluteIndex;
		if (c >= centerColStart && c < centerColStart + centerColCount) {
			if (columns[c]?.field && p.columnId) visibleInstanceIds.add(p.columnId);
		}
	}
	if (pinRightContainer) {
		for (const p of topology.right) {
			if (columns[p.absoluteIndex]?.field && p.columnId) visibleInstanceIds.add(p.columnId);
		}
	}
	// The currently focused/edited column must survive retention even if a horizontal scroll has
	// carried it outside the rendered window (e.g. mid-edit elsewhere in a wide grid).
	if (focusedColumnInstanceId) visibleInstanceIds.add(focusedColumnInstanceId);

	// Detach DOM elements for cells that left the visible window. The CellSlot itself
	// stays in cellsByColumnInstanceId so it can be reused when the column scrolls back in —
	// no releaseFn call, no portal teardown.
	for (const [instanceId, cell] of slot.cellsByColumnInstanceId) {
		if (!visibleInstanceIds.has(instanceId) && cell.element.parentNode) {
			cell.element.remove();
		}
	}

	function ensureCell(instanceId: ColumnInstanceId): CellSlot<TRowData> {
		let cell = slot.cellsByColumnInstanceId.get(instanceId);
		if (!cell) {
			const el = document.createElement('div');
			initFn(el);
			cell = CellSlot.fromElement<TRowData>(el);
			cell.columnInstanceId = instanceId;
			slot.cellsByColumnInstanceId.set(instanceId, cell);
			instrumentation?.increment(GridMetric.CELL_VIEW_CREATED);
			if (retentionStats) retentionStats.cellSlotsCreatedDuringTopology++;
		} else if (retentionStats) {
			retentionStats.cellSlotsReusedDuringTopology++;
		}
		return cell;
	}

	slot.leftCells.length = 0;
	if (pinLeftContainer) {
		for (const p of topology.left) {
			const col = columns[p.absoluteIndex];
			if (!col?.field || !p.columnId) continue;
			const cell = ensureCell(p.columnId);
			if (cell.element.parentNode !== pinLeftContainer) pinLeftContainer.appendChild(cell.element);
			slot.leftCells.push(cell);
		}
	}

	slot.centerCells.length = 0;
	for (const p of topology.center) {
		const c = p.absoluteIndex;
		if (c < centerColStart || c >= centerColStart + centerColCount) continue;
		const col = columns[c];
		if (!col?.field || !p.columnId) continue;
		const cell = ensureCell(p.columnId);
		if (cell.element.parentNode !== slot.element) slot.element.appendChild(cell.element);
		slot.centerCells.push(cell);
	}

	slot.rightCells.length = 0;
	if (pinRightContainer) {
		for (const p of topology.right) {
			const col = columns[p.absoluteIndex];
			if (!col?.field || !p.columnId) continue;
			const cell = ensureCell(p.columnId);
			if (cell.element.parentNode !== pinRightContainer) pinRightContainer.appendChild(cell.element);
			slot.rightCells.push(cell);
		}
	}

	slot.centerColStart = centerColStart;
	slot.pinLeftCount = topology.left.length;
	slot.pinRightStart = topology.left.length + topology.center.length;

	// Bounded retention: cellsByColumnInstanceId must never grow unbounded just because scroll-frame
	// reconciliation never evicts on its own. Runs AFTER this frame's cells are ensured (not
	// before) so newly-entered columns are already accounted for in the budget check — otherwise
	// eviction would trim to budget using the OLD visible set and then this frame's newly-entered
	// columns would push it back over on every window shift.
	if (releaseFn) {
		const { retainedAfter, evicted } = applyCellSlotRetentionPolicy(slot, visibleInstanceIds, releaseFn, instrumentation);
		if (retentionStats) {
			retentionStats.cellSlotsEvictedDuringTopology += evicted;
			retentionStats.cellSlotsRetained += retainedAfter;
			if (retainedAfter > retentionStats.maxCellsByColumnIdPerRowSlot) {
				retentionStats.maxCellsByColumnIdPerRowSlot = retainedAfter;
			}
		}
	}
}

export { reconcileTopology, reconcileCellTopologyForScroll };

function applyLoadingInsightState<TRowData>(
	deps: RowCellBindingLaneDeps<TRowData>,
	cellSlot: CellSlot<TRowData>,
	rowId: string,
	colField: string
): string {
	let cellClassName = 'og-cell og-cell-loading';
	if (deps.engine.insights.size === 0) {
		if (cellSlot.element.dataset.validationError !== undefined) delete cellSlot.element.dataset.validationError;
		if (cellSlot.element.title) cellSlot.element.removeAttribute('title');
		return cellClassName;
	}

	const decorationMetadata = collectCellDecorationSnapshotMetadata(deps.engine.insights.getCellDecorations(rowId, colField));
	if (decorationMetadata.classNameSuffix) cellClassName += decorationMetadata.classNameSuffix;
	if (decorationMetadata.validationError) {
		cellSlot.element.dataset.validationError = decorationMetadata.validationError;
	} else if (cellSlot.element.dataset.validationError !== undefined) {
		delete cellSlot.element.dataset.validationError;
	}
	if (decorationMetadata.insightTitle) {
		cellSlot.element.title = decorationMetadata.insightTitle;
	} else if (cellSlot.element.title) {
		cellSlot.element.removeAttribute('title');
	}
	return cellClassName;
}

export function bindAllDataCells<TRowData>(deps: RowCellBindingLaneDeps<TRowData>, request: BindAllDataCellsRequest<TRowData>): void {
	const {
		slot,
		node,
		rowIndex,
		centerColStart,
		centerColCount,
		columns,
		plan,
		columnTopology,
		isScrollFrameActive,
		ctx,
		state,
		isRowRebind,
		forceCellRefresh,
		isRowVisible,
		refreshVisibleColumns,
		viewportPlan,
	} = request;
	const pinLeftWidth = plan.pinLeftWidth;
	const pinRightBaseLeft = plan.pinRightBaseLeft;
	const pinRightWidth = plan.pinRightWidth;
	const isRowLoading = ctx ? ctx.loadingVersion > 0 && deps.engine.data.isRowLoading(node.id) : false;
	const visibleColStart = ctx?.visibleColRange?.startIdx ?? centerColStart;
	const visibleColEnd = ctx?.visibleColRange?.endIdx ?? centerColStart + centerColCount - 1;
	const currentRowVersion = ctx?.rowVersions?.get(node.id);
	// Attach/reuse this row's RowCtrl once per row (not once per cell) — CellCtrl attach happens
	// per cell inside bindCellFull/bindCellDuringScroll via the rowCtrl passed down below.
	// isEditing/isFocused reset to false here and are rolled back to true by whichever cell (if any)
	// is the active edit/focus target this frame — see attachCellCtrl in rowCellBinder.ts.
	const rowCtrl = deps.engine.rowCtrls?.getOrCreate(node.id) ?? createRowCtrl<TRowData>(node.id);
	rowCtrl.attachedSlotId = slot.id;
	rowCtrl.attachedGeneration = slot.generation;
	if (currentRowVersion !== undefined) rowCtrl.rowVersion = currentRowVersion;
	rowCtrl.isEditing = false;
	rowCtrl.isFocused = false;
	const getWarmVisibleCellStatus = (cellSlot: CellSlot<TRowData>) => {
		if (!ctx) return { needsImmediateWake: false, needsDeferredRefresh: false };
		return resolveWarmVisibleCellStatus(
			{
				getCellPortalHost: deps.cellBinderDeps.getCellPortalHost,
				isCellMounted: (key) => deps.cellBinderDeps.portalMountManager.isCellMounted(key),
			},
			cellSlot,
			{
				currentRowVersion,
				globalVersion: ctx.globalVersion,
				globalChangedDuringScroll: ctx.globalChangedDuringScroll,
				insightVersion: ctx.insightVersion,
				styleVersion: ctx.styleVersion,
				loadingVersion: ctx.loadingVersion,
				selectionVersion: ctx.selectionVersion,
				hasInsightDecorations: ctx.hasInsightDecorations,
				hasDeferredCellStyleRules: ctx.hasDeferredCellStyleRules,
				loadingChangedDuringScroll: ctx.loadingChangedDuringScroll,
				selectionChangedDuringScroll: ctx.selectionChangedDuringScroll,
			}
		);
	};
	const shouldSkipStableCellDuringScroll = (cellSlot: CellSlot<TRowData>, columnIndex: number, isVisibleContent: boolean): boolean => {
		if (!isScrollFrameActive || forceCellRefresh || isRowRebind) return false;
		if (cellSlot.colIndex !== columnIndex || cellSlot.rowId !== node.id || cellSlot.rowIndex !== rowIndex) return false;
		if (!isVisibleContent) {
			const instanceId = (columns[columnIndex] as InternalColumnDef<TRowData> | undefined)?.instanceId;
			if (instanceId && viewportPlan?.liveCells.overscan.some((cell) => cell.rowIndex === rowIndex && cell.columnInstanceId === instanceId)) {
				return false;
			}
			return true;
		}
		if (getWarmVisibleCellStatus(cellSlot).needsImmediateWake) return false;
		return !refreshVisibleColumns?.has(columnIndex);
	};
	const shouldRefreshWarmVisibleCell = (cellSlot: CellSlot<TRowData>, columnIndex: number, isVisibleContent: boolean): boolean => {
		if (!isScrollFrameActive || !isVisibleContent || !ctx) return false;
		if (refreshVisibleColumns?.has(columnIndex)) return true;
		return getWarmVisibleCellStatus(cellSlot).needsDeferredRefresh;
	};

	const pinLeftContainer = deps.ensurePinnedContainer(slot, 'left', pinLeftWidth);
	const pinRightContainer = deps.ensurePinnedContainer(slot, 'right', pinRightWidth);

	if (!isScrollFrameActive) {
		// Full paint: topology-aware reconciliation — retains cells across lane changes.
		// cellsByColumnInstanceId is authoritative; no drift repair needed.
		reconcileTopology(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn,
			deps.engine.instrumentation,
			deps.retentionStats
		);
	} else {
		// Scroll frame: topology-owned reconciliation — bounded retention, no full releaseFn sweep.
		// cellsByColumnInstanceId stays authoritative; cells leaving the visible+approach-band window
		// are retained as a small LRU (cellSlotRetention.ts) and reused when they scroll back into view.
		const focusedColumnInstanceId = ctx?.focusedCell?.colField
			? (columns.find((c) => c.field === ctx.focusedCell!.colField) as InternalColumnDef<TRowData> | undefined)?.instanceId
			: undefined;
		reconcileCellTopologyForScroll(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn,
			focusedColumnInstanceId,
			deps.engine.instrumentation,
			deps.retentionStats
		);
	}

	for (let i = 0; i < columnTopology.left.length; i++) {
		const placement = columnTopology.left[i];
		const col = columns[placement.absoluteIndex];
		const cellSlot = slot.leftCells[i];
		if (!col || !cellSlot) continue;
		const isVisibleContent = isRowVisible;
		const needsVisibleRefresh = shouldRefreshWarmVisibleCell(cellSlot, placement.absoluteIndex, isVisibleContent);
		if (shouldSkipStableCellDuringScroll(cellSlot, placement.absoluteIndex, isVisibleContent)) {
			if (needsVisibleRefresh) deps.markCellDirtyAfterScroll(cellSlot.element);
			continue;
		}
		if (isScrollFrameActive) deps.onScrollCellVisited();
		const leftArg = placement.laneOffset;
		const cellWidth = plan.colWidths[placement.absoluteIndex];
		if (isScrollFrameActive) {
			deps.onScrollCellPatched();
			bindCellDuringScroll(deps.cellBinderDeps, {
				cellSlot,
				node,
				rowIndex,
				colIndex: placement.absoluteIndex,
				col,
				lane: 'left',
				ctx: ctx!,
				pooledRowId: slot.id,
				pooledRowGeneration: slot.generation,
				left: leftArg,
				right: -1,
				width: cellWidth,
				isRowRebind,
				isRowLoading,
				isInVisibleContent: isVisibleContent,
				rowCtrl,
			});
		} else {
			bindCellFull(deps.cellBinderDeps, {
				cellSlot,
				slotId: slot.id,
				slotGeneration: slot.generation,
				node,
				rowIndex,
				colIndex: placement.absoluteIndex,
				col,
				lane: 'left',
				pinRightBaseLeft,
				plan,
				state,
				ctx,
				rowCtrl,
			});
		}
	}

	for (let i = 0; i < centerColCount; i++) {
		const c = centerColStart + i;
		const col = columns[c];
		const cellSlot = slot.centerCells[i];
		if (!col || !cellSlot) continue;
		const isVisibleContent = isRowVisible && c >= visibleColStart && c <= visibleColEnd;
		const needsVisibleRefresh = shouldRefreshWarmVisibleCell(cellSlot, c, isVisibleContent);
		if (shouldSkipStableCellDuringScroll(cellSlot, c, isVisibleContent)) {
			if (needsVisibleRefresh) deps.markCellDirtyAfterScroll(cellSlot.element);
			continue;
		}
		if (isScrollFrameActive) deps.onScrollCellVisited();
		const leftArg = plan.colLefts[c];
		const cellWidth = plan.colWidths[c];
		if (isScrollFrameActive) {
			deps.onScrollCellPatched();
			bindCellDuringScroll(deps.cellBinderDeps, {
				cellSlot,
				node,
				rowIndex,
				colIndex: c,
				col,
				lane: 'center',
				ctx: ctx!,
				pooledRowId: slot.id,
				pooledRowGeneration: slot.generation,
				left: leftArg,
				right: -1,
				width: cellWidth,
				isRowRebind,
				isRowLoading,
				isInVisibleContent: isVisibleContent,
				rowCtrl,
			});
		} else {
			bindCellFull(deps.cellBinderDeps, {
				cellSlot,
				slotId: slot.id,
				slotGeneration: slot.generation,
				node,
				rowIndex,
				colIndex: c,
				col,
				lane: 'center',
				pinRightBaseLeft,
				plan,
				state,
				ctx,
				rowCtrl,
			});
		}
	}

	for (let i = 0; i < columnTopology.right.length; i++) {
		const placement = columnTopology.right[i];
		const c = placement.absoluteIndex;
		const col = columns[c];
		const cellSlot = slot.rightCells[i];
		if (!col || !cellSlot) continue;
		const isVisibleContent = isRowVisible;
		const needsVisibleRefresh = shouldRefreshWarmVisibleCell(cellSlot, c, isVisibleContent);
		if (shouldSkipStableCellDuringScroll(cellSlot, c, isVisibleContent)) {
			if (needsVisibleRefresh) deps.markCellDirtyAfterScroll(cellSlot.element);
			continue;
		}
		if (isScrollFrameActive) deps.onScrollCellVisited();
		// Use topology laneOffset for right cells (= absoluteLeft - pinRightBaseLeft).
		const leftArg = placement.laneOffset;
		const cellWidth = plan.colWidths[c];
		if (isScrollFrameActive) {
			deps.onScrollCellPatched();
			bindCellDuringScroll(deps.cellBinderDeps, {
				cellSlot,
				node,
				rowIndex,
				colIndex: c,
				col,
				lane: 'right',
				ctx: ctx!,
				pooledRowId: slot.id,
				pooledRowGeneration: slot.generation,
				left: leftArg,
				right: -1,
				width: cellWidth,
				isRowRebind,
				isRowLoading,
				isInVisibleContent: isVisibleContent,
				rowCtrl,
			});
		} else {
			bindCellFull(deps.cellBinderDeps, {
				cellSlot,
				slotId: slot.id,
				slotGeneration: slot.generation,
				node,
				rowIndex,
				colIndex: c,
				col,
				lane: 'right',
				pinRightBaseLeft,
				plan,
				state,
				ctx,
				rowCtrl,
			});
		}
	}
}

export function bindAllLoadingCells<TRowData>(deps: RowCellBindingLaneDeps<TRowData>, request: BindAllLoadingCellsRequest<TRowData>): void {
	const { slot, rowIndex, centerColStart, centerColCount, columns, plan, columnTopology, isScrollFrameActive } = request;
	const pinLeftWidth = plan.pinLeftWidth;
	const pinRightBaseLeft = plan.pinRightBaseLeft;
	const pinRightWidth = plan.pinRightWidth;
	const globalVersion = deps.engine.stateManager.getState().globalVersion;
	const snapshotVisualVersions = deps.cellBinderDeps.getSnapshotVisualVersions();

	const pinLeftContainer = deps.ensurePinnedContainer(slot, 'left', pinLeftWidth);
	const pinRightContainer = deps.ensurePinnedContainer(slot, 'right', pinRightWidth);

	if (!isScrollFrameActive) {
		reconcileTopology(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn
		);
	} else {
		reconcileCellTopologyForScroll(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn,
			undefined,
			deps.engine.instrumentation,
			deps.retentionStats
		);
	}

	const bindLoadingCell = (cellSlot: CellSlot<TRowData>, c: number, leftArg: number) => {
		const col = columns[c];
		if (!col || !cellSlot) return;
		if (isScrollFrameActive) deps.onScrollCellVisited();
		if (cellSlot.lastPortalKey) deps.releaseCellPortal(cellSlot.element);
		const cellWidth = plan.colWidths[c];
		const rowId = `loading:${rowIndex}`;
		const cellClassName = applyLoadingInsightState(deps, cellSlot, rowId, col.field);
		if (isScrollFrameActive) {
			deps.onScrollCellPatched();
			deps.markCellDirtyAfterScroll(cellSlot.element);
		} else {
			deps.ensureLoadingSkeleton(cellSlot.element);
		}
		const didWrite = cellSlot.update(c, col.field, rowIndex, rowId, leftArg, -1, cellWidth, cellClassName, 'loading', undefined, '', undefined);
		cellSlot.lastMountedRowVersion = -1;
		cellSlot.lastMountedGlobalVersion = globalVersion;
		recordCellSlotMountedVisualVersions(cellSlot, {
			insightVersion: deps.engine.insights.getVersion(),
			styleVersion: snapshotVisualVersions.styleVersion,
			loadingVersion: snapshotVisualVersions.loadingVersion,
			selectionVersion: deps.engine.selectionVersion,
		});
		deps.engine.cellDisplaySnapshots.set(
			createCellDisplaySnapshot({
				rowId,
				columnInstanceId: getColumnInstanceIdentity(col),
				colField: col.field,
				rowVersion: -1,
				globalVersion,
				insightVersion: deps.engine.insights.getVersion(),
				styleVersion: snapshotVisualVersions.styleVersion,
				loadingVersion: snapshotVisualVersions.loadingVersion,
				selectionVersion: deps.engine.selectionVersion,
				baseClassName: 'og-cell og-cell-loading',
				decorationClassName: cellClassName.replace('og-cell og-cell-loading', '').trim(),
				contentKind: 'loading',
				contentMode: 'loading',
				formattedValue: '',
				title: cellSlot.element.title,
				validationError: cellSlot.element.dataset.validationError,
			})
		);
		if (isScrollFrameActive && didWrite) deps.onScrollCellWritten();
	};

	for (let i = 0; i < columnTopology.left.length; i++) {
		bindLoadingCell(slot.leftCells[i], columnTopology.left[i].absoluteIndex, columnTopology.left[i].laneOffset);
	}
	for (let i = 0; i < centerColCount; i++) bindLoadingCell(slot.centerCells[i], centerColStart + i, plan.colLefts[centerColStart + i]);
	for (let i = 0; i < columnTopology.right.length; i++) {
		bindLoadingCell(slot.rightCells[i], columnTopology.right[i].absoluteIndex, columnTopology.right[i].laneOffset);
	}
}
