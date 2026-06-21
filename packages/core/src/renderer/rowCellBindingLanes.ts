import type { GridEngine } from '../engine/GridEngine.js';
import type { CellRendererPhase, ColumnDef } from '../columnDef.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import { CellSlot } from './cellSlot.js';
import { bindCellDuringScroll, bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import type { RowSlot } from './rowSlot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { CompiledColumnTopology } from './columnTopology.js';

export interface RowCellLaneFullBindRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	slotId: string;
	slotGeneration: number;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	pinLeftColumns: number;
	pinRightColumns: number;
	pinRightStart: number;
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
	pinLeftColumns: number;
	pinRightStart: number;
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
	pinLeftColumns: number;
	pinRightColumns: number;
	pinRightStart: number;
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
}

export interface BindAllLoadingCellsRequest<TRowData = unknown> {
	slot: RowSlot<TRowData>;
	rowIndex: number;
	pinLeftColumns: number;
	pinRightColumns: number;
	pinRightStart: number;
	centerColStart: number;
	centerColCount: number;
	columns: ColumnDef<TRowData>[];
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	/** Authoritative column topology for lane membership and lane-relative offsets. */
	columnTopology: CompiledColumnTopology;
	isScrollFrameActive: boolean;
}

/**
 * Syncs `cellsByColumnId` from the current lane arrays using each cell's `colField`.
 *
 * After a scroll frame the lane arrays are authoritative (cells may have been recycled
 * to new columns by `ensure*`). Rebuilding the map from lane arrays before the next full
 * paint keeps reconcileTopology's field lookups correct.
 */
export function syncCellsByColumnId<TRowData>(slot: RowSlot<TRowData>): void {
	slot.cellsByColumnId.clear();
	for (const cell of slot.leftCells) {
		if (cell.colField) slot.cellsByColumnId.set(cell.colField, cell);
	}
	for (const cell of slot.centerCells) {
		if (cell.colField) slot.cellsByColumnId.set(cell.colField, cell);
	}
	for (const cell of slot.rightCells) {
		if (cell.colField) slot.cellsByColumnId.set(cell.colField, cell);
	}
}

/**
 * Reconciles the three lane arrays on a RowSlot to match a new column topology without
 * destroying cells for columns that merely changed lanes (pin/unpin relocation).
 *
 * Call syncCellsByColumnId() first to ensure the map reflects any scroll-time drift.
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
	releaseFn: (cell: CellSlot<TRowData>) => void
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

export { reconcileTopology };

export function bindAllDataCells<TRowData>(deps: RowCellBindingLaneDeps<TRowData>, request: BindAllDataCellsRequest<TRowData>): void {
	const {
		slot,
		node,
		rowIndex,
		pinLeftColumns,
		pinRightColumns,
		pinRightStart,
		centerColStart,
		centerColCount,
		columns,
		plan,
		columnTopology,
		isScrollFrameActive,
		ctx,
		state,
		isRowRebind,
	} = request;
	const pinLeftWidth = plan.pinLeftWidth;
	const pinRightBaseLeft = plan.pinRightBaseLeft;
	const pinRightWidth = plan.pinRightWidth;
	const colCount = columns.length;
	const isRowLoading = ctx ? ctx.loadingVersion > 0 && deps.engine.data.isRowLoading(node.id) : false;

	const pinLeftContainer = deps.ensurePinnedContainer(slot, 'left', pinLeftWidth);
	const pinRightContainer = deps.ensurePinnedContainer(slot, 'right', pinRightWidth);

	if (!isScrollFrameActive) {
		// Full paint: topology-aware reconciliation — retains cells across lane changes.
		// syncCellsByColumnId first to repair any drift from the scroll-time ensure* path.
		syncCellsByColumnId(slot);
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
		// Scroll frame: position-based resize preserves the scroll cheapness contract.
		// reconcileTopology would call releaseFn for horizontally-exiting columns,
		// triggering deferred portal releases that corrupt portalReleasesDuringScroll.
		slot.ensureLeftCells(pinLeftColumns, pinLeftContainer, deps.initCell, deps.releaseCellFn);
		slot.ensureCenterCells(centerColCount, deps.initCell, deps.releaseCellFn);
		slot.ensureRightCells(pinRightColumns, pinRightContainer, deps.initCell, deps.releaseCellFn);
		slot.centerColStart = centerColStart;
		slot.pinLeftCount = pinLeftColumns;
		slot.pinRightStart = pinRightStart;
	}

	for (let i = 0; i < pinLeftColumns; i++) {
		const col = columns[i];
		const cellSlot = slot.leftCells[i];
		if (!col || !cellSlot) continue;
		if (isScrollFrameActive && !isRowRebind && cellSlot.colIndex === i) continue;
		if (isScrollFrameActive) deps.onScrollCellVisited();
		const leftArg = plan.colLefts[i];
		const cellWidth = plan.colWidths[i];
		if (isScrollFrameActive) {
			deps.onScrollCellPatched();
			bindCellDuringScroll(deps.cellBinderDeps, {
				cellSlot,
				node,
				rowIndex,
				colIndex: i,
				col,
				pinLeftColumns,
				pinRightStart,
				ctx: ctx!,
				pooledRowId: slot.id,
				pooledRowGeneration: slot.generation,
				left: leftArg,
				right: -1,
				width: cellWidth,
				isRowRebind,
				isRowLoading,
			});
		} else {
			bindCellFull(deps.cellBinderDeps, {
				cellSlot,
				slotId: slot.id,
				slotGeneration: slot.generation,
				node,
				rowIndex,
				colIndex: i,
				col,
				pinLeftColumns,
				pinRightColumns,
				pinRightStart,
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
		if (isScrollFrameActive && !isRowRebind && cellSlot.colIndex === c) continue;
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
				pinLeftColumns,
				pinRightStart,
				ctx: ctx!,
				pooledRowId: slot.id,
				pooledRowGeneration: slot.generation,
				left: leftArg,
				right: -1,
				width: cellWidth,
				isRowRebind,
				isRowLoading,
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
				pinLeftColumns,
				pinRightColumns,
				pinRightStart,
				pinRightBaseLeft,
				plan,
				state,
				ctx,
			});
		}
	}

	for (let i = 0; i < pinRightColumns; i++) {
		const c = pinRightStart + i;
		if (c >= colCount) continue;
		const col = columns[c];
		const cellSlot = slot.rightCells[i];
		if (!col || !cellSlot) continue;
		if (isScrollFrameActive && !isRowRebind && cellSlot.colIndex === c) continue;
		if (isScrollFrameActive) deps.onScrollCellVisited();
		// Use topology laneOffset for right cells (= absoluteLeft - pinRightBaseLeft).
		const leftArg = columnTopology.byColumnId.get(col.field)?.laneOffset ?? (plan.colLefts[c] - pinRightBaseLeft);
		const cellWidth = plan.colWidths[c];
		if (isScrollFrameActive) {
			deps.onScrollCellPatched();
			bindCellDuringScroll(deps.cellBinderDeps, {
				cellSlot,
				node,
				rowIndex,
				colIndex: c,
				col,
				pinLeftColumns,
				pinRightStart,
				ctx: ctx!,
				pooledRowId: slot.id,
				pooledRowGeneration: slot.generation,
				left: leftArg,
				right: -1,
				width: cellWidth,
				isRowRebind,
				isRowLoading,
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
				pinLeftColumns,
				pinRightColumns,
				pinRightStart,
				pinRightBaseLeft,
				plan,
				state,
				ctx,
			});
		}
	}
}

export function bindAllLoadingCells<TRowData>(deps: RowCellBindingLaneDeps<TRowData>, request: BindAllLoadingCellsRequest<TRowData>): void {
	const { slot, rowIndex, pinLeftColumns, pinRightColumns, pinRightStart, centerColStart, centerColCount, columns, plan, columnTopology, isScrollFrameActive } =
		request;
	const pinLeftWidth = plan.pinLeftWidth;
	const pinRightBaseLeft = plan.pinRightBaseLeft;
	const pinRightWidth = plan.pinRightWidth;
	const colCount = columns.length;

	const pinLeftContainer = deps.ensurePinnedContainer(slot, 'left', pinLeftWidth);
	const pinRightContainer = deps.ensurePinnedContainer(slot, 'right', pinRightWidth);

	if (!isScrollFrameActive) {
		syncCellsByColumnId(slot);
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
		slot.ensureLeftCells(pinLeftColumns, pinLeftContainer, deps.initCell, deps.releaseCellFn);
		slot.ensureCenterCells(centerColCount, deps.initCell, deps.releaseCellFn);
		slot.ensureRightCells(pinRightColumns, pinRightContainer, deps.initCell, deps.releaseCellFn);
		slot.centerColStart = centerColStart;
		slot.pinLeftCount = pinLeftColumns;
		slot.pinRightStart = pinRightStart;
	}

	const bindLoadingCell = (cellSlot: CellSlot<TRowData>, c: number, leftArg: number) => {
		const col = columns[c];
		if (!col || !cellSlot) return;
		if (isScrollFrameActive) deps.onScrollCellVisited();
		if (cellSlot.lastPortalKey) deps.releaseCellPortal(cellSlot.element);
		const cellWidth = plan.colWidths[c];
		if (isScrollFrameActive) {
			deps.onScrollCellPatched();
			deps.markCellDirtyAfterScroll(cellSlot.element);
		} else {
			deps.ensureLoadingSkeleton(cellSlot.element);
		}
		const didWrite = cellSlot.update(
			c,
			col.field,
			rowIndex,
			`loading:${rowIndex}`,
			leftArg,
			-1,
			cellWidth,
			'og-cell og-cell-loading',
			'loading',
			undefined,
			'',
			undefined
		);
		if (isScrollFrameActive && didWrite) deps.onScrollCellWritten();
	};

	for (let i = 0; i < pinLeftColumns; i++) bindLoadingCell(slot.leftCells[i], i, plan.colLefts[i]);
	for (let i = 0; i < centerColCount; i++) bindLoadingCell(slot.centerCells[i], centerColStart + i, plan.colLefts[centerColStart + i]);
	for (let i = 0; i < pinRightColumns; i++) {
		const c = pinRightStart + i;
		if (c < colCount) {
			const col = columns[c];
			const leftArg = col ? (columnTopology.byColumnId.get(col.field)?.laneOffset ?? (plan.colLefts[c] - pinRightBaseLeft)) : plan.colLefts[c] - pinRightBaseLeft;
			bindLoadingCell(slot.rightCells[i], c, leftArg);
		}
	}
}
