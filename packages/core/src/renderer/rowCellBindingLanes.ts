import type { GridEngine } from '../engine/GridEngine.js';
import type { CellRendererPhase, ColumnDef } from '../columnDef.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import { CellSlot } from './cellSlot.js';
import { bindCellDuringScroll, bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import type { RowSlot } from './rowSlot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { CompiledColumnTopology } from './columnTopology.js';
import { GridMetric, type GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import { collectCellDecorationSnapshotMetadata, createCellDisplaySnapshot } from './cellDisplaySnapshot.js';

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
	instrumentation?: GridInstrumentation
): void {
	// Build the set of column fields in the new rendered topology.
	const newFields = new Set<string>();
	for (const p of topology.left) if (p.columnId) newFields.add(p.columnId);
	for (const p of topology.center) {
		if (p.absoluteIndex >= centerColStart && p.absoluteIndex < centerColStart + centerColCount) {
			if (p.columnId) newFields.add(p.columnId);
		}
	}
	for (const p of topology.right) if (p.columnId) newFields.add(p.columnId);

	// Step 1 — destroy cells for columns that exited the rendered set.
	for (const [field, cell] of slot.cellsByColumnId) {
		if (!newFields.has(field)) {
			releaseFn(cell);
			if (cell.element.parentNode) cell.element.remove();
			slot.cellsByColumnId.delete(field);
			instrumentation?.increment(GridMetric.CELL_VIEW_DESTROYED);
		}
	}

	// columnId is set at construction time — the cell's permanent column identity.
	// colField mirrors this and is guarded-written by update() in the bind loop.
	function ensureCell(field: string): CellSlot<TRowData> {
		let cell = slot.cellsByColumnId.get(field);
		if (!cell) {
			const el = document.createElement('div');
			initFn(el);
			cell = CellSlot.fromElement<TRowData>(el);
			cell.columnId = field;
			slot.cellsByColumnId.set(field, cell);
			instrumentation?.increment(GridMetric.CELL_VIEW_CREATED);
		}
		return cell;
	}

	// Step 2 & 3 — rebuild lane arrays from topology, creating or relocating cells as needed.
	slot.leftCells.length = 0;
	if (pinLeftContainer) {
		for (const p of topology.left) {
			const col = columns[p.absoluteIndex];
			if (!col?.field) continue;
			const cell = ensureCell(col.field);
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
		if (!col?.field) continue;
		const cell = ensureCell(col.field);
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
			if (!col?.field) continue;
			const cell = ensureCell(col.field);
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
 * remain in `cellsByColumnId` and are reused when they scroll back into view.
 *
 * Invariant: `cellsByColumnId` is authoritative at all times — no drift is possible
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
	initFn: (el: HTMLDivElement) => void
): void {
	// Compute the set of column fields visible in this frame.
	const visibleFields = new Set<string>();
	if (pinLeftContainer) {
		for (const p of topology.left) {
			const col = columns[p.absoluteIndex];
			if (col?.field) visibleFields.add(col.field);
		}
	}
	for (const p of topology.center) {
		const c = p.absoluteIndex;
		if (c >= centerColStart && c < centerColStart + centerColCount) {
			const col = columns[c];
			if (col?.field) visibleFields.add(col.field);
		}
	}
	if (pinRightContainer) {
		for (const p of topology.right) {
			const col = columns[p.absoluteIndex];
			if (col?.field) visibleFields.add(col.field);
		}
	}

	// Detach DOM elements for cells that left the visible window. The CellSlot itself
	// stays in cellsByColumnId so it can be reused when the column scrolls back in —
	// no releaseFn call, no portal teardown.
	for (const [field, cell] of slot.cellsByColumnId) {
		if (!visibleFields.has(field) && cell.element.parentNode) {
			cell.element.remove();
		}
	}

	function ensureCell(field: string): CellSlot<TRowData> {
		let cell = slot.cellsByColumnId.get(field);
		if (!cell) {
			const el = document.createElement('div');
			initFn(el);
			cell = CellSlot.fromElement<TRowData>(el);
			cell.columnId = field;
			slot.cellsByColumnId.set(field, cell);
		}
		return cell;
	}

	slot.leftCells.length = 0;
	if (pinLeftContainer) {
		for (const p of topology.left) {
			const col = columns[p.absoluteIndex];
			if (!col?.field) continue;
			const cell = ensureCell(col.field);
			if (cell.element.parentNode !== pinLeftContainer) pinLeftContainer.appendChild(cell.element);
			slot.leftCells.push(cell);
		}
	}

	slot.centerCells.length = 0;
	for (const p of topology.center) {
		const c = p.absoluteIndex;
		if (c < centerColStart || c >= centerColStart + centerColCount) continue;
		const col = columns[c];
		if (!col?.field) continue;
		const cell = ensureCell(col.field);
		if (cell.element.parentNode !== slot.element) slot.element.appendChild(cell.element);
		slot.centerCells.push(cell);
	}

	slot.rightCells.length = 0;
	if (pinRightContainer) {
		for (const p of topology.right) {
			const col = columns[p.absoluteIndex];
			if (!col?.field) continue;
			const cell = ensureCell(col.field);
			if (cell.element.parentNode !== pinRightContainer) pinRightContainer.appendChild(cell.element);
			slot.rightCells.push(cell);
		}
	}

	slot.centerColStart = centerColStart;
	slot.pinLeftCount = topology.left.length;
	slot.pinRightStart = topology.left.length + topology.center.length;
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
	} = request;
	const pinLeftWidth = plan.pinLeftWidth;
	const pinRightBaseLeft = plan.pinRightBaseLeft;
	const pinRightWidth = plan.pinRightWidth;
	const isRowLoading = ctx ? ctx.loadingVersion > 0 && deps.engine.data.isRowLoading(node.id) : false;
	const visibleColStart = ctx?.visibleColRange?.startIdx ?? centerColStart;
	const visibleColEnd = ctx?.visibleColRange?.endIdx ?? centerColStart + centerColCount - 1;
	const currentRowVersion = ctx?.rowVersions?.get(node.id);
	const getWarmVisibleCellStatus = (cellSlot: CellSlot<TRowData>) => {
		if (!ctx) return { needsImmediateWake: false, needsDeferredRefresh: false };
		const lastPortalKey = cellSlot.lastPortalKey;
		const portalHost = cellSlot.lastContentMode === 'portal' ? deps.cellBinderDeps.getCellPortalHost(cellSlot.element) : null;
		const hasStalePortalMount =
			cellSlot.lastContentMode === 'portal' && !!lastPortalKey && !deps.cellBinderDeps.portalMountManager.isCellMounted(lastPortalKey);
		const hasEmptyPortalHost = cellSlot.lastContentMode === 'portal' && !!lastPortalKey && !!portalHost && portalHost.childElementCount === 0;
		const hasSuspiciousWarmState =
			cellSlot.lastMountedRowVersion === -1 ||
			cellSlot.lastMountedGlobalVersion === -1 ||
			cellSlot.lastContentMode === 'pending' ||
			(cellSlot.lastContentMode === 'text' && cellSlot.lastFormattedValue === '...') ||
			hasStalePortalMount ||
			hasEmptyPortalHost;
		const globalDataChanged =
			cellSlot.lastMountedGlobalVersion !== -1 && (ctx.globalChangedDuringScroll || ctx.globalVersion !== cellSlot.lastMountedGlobalVersion);
		const rowDataChanged =
			cellSlot.lastMountedRowVersion !== -1 && currentRowVersion !== undefined && currentRowVersion !== cellSlot.lastMountedRowVersion;
		return {
			needsImmediateWake: hasSuspiciousWarmState || globalDataChanged || rowDataChanged,
			needsDeferredRefresh:
				hasSuspiciousWarmState ||
				globalDataChanged ||
				rowDataChanged ||
				ctx.hasInsightDecorations ||
				ctx.styleChangedDuringScroll ||
				ctx.selectionChangedDuringScroll ||
				ctx.loadingChangedDuringScroll,
		};
	};
	const shouldSkipStableCellDuringScroll = (cellSlot: CellSlot<TRowData>, columnIndex: number, isVisibleContent: boolean): boolean => {
		if (!isScrollFrameActive || forceCellRefresh || isRowRebind) return false;
		if (cellSlot.colIndex !== columnIndex || cellSlot.rowId !== node.id || cellSlot.rowIndex !== rowIndex) return false;
		if (!isVisibleContent) return true;
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
		// cellsByColumnId is authoritative; no drift repair needed.
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
			deps.engine.instrumentation
		);
	} else {
		// Scroll frame: topology-owned reconciliation — never calls releaseFn.
		// cellsByColumnId stays authoritative; cells leaving the center window are
		// retained in the map and reused when they scroll back into view.
		reconcileCellTopologyForScroll(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell
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
			deps.initCell
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
		deps.engine.cellDisplaySnapshots.set(
			createCellDisplaySnapshot({
				rowId,
				colField: col.field,
				rowVersion: -1,
				globalVersion,
				insightVersion: deps.engine.insights.getVersion(),
				styleVersion: snapshotVisualVersions.styleVersion,
				loadingVersion: snapshotVisualVersions.loadingVersion,
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
