import type { GridEngine } from '../engine/GridEngine.js';
import type { CellRendererPhase, ColumnDef, GridState, RowNode } from '../store.js';
import type { CellSlot } from './cellSlot.js';
import { bindCellDuringScroll, bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import type { RowSlot } from './rowSlot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';

export interface RowCellLaneFullBindRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	slotId: string;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	pinLeftColumns: number;
	pinRightColumns: number;
	pinRightStart: number;
	pinRightBaseLeft: number;
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	state: GridState<TRowData>;
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
	isScrollFrameActive: boolean;
	ctx?: ScrollRenderContext<TRowData>;
	state: GridState<TRowData>;
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
	isScrollFrameActive: boolean;
}

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
	slot.centerColStart = centerColStart;
	slot.pinLeftCount = pinLeftColumns;
	slot.pinRightStart = pinRightStart;

	slot.ensureLeftCells(pinLeftColumns, pinLeftContainer, deps.initCell, deps.releaseCellFn);
	slot.ensureCenterCells(centerColCount, deps.initCell, deps.releaseCellFn);
	slot.ensureRightCells(pinRightColumns, pinRightContainer, deps.initCell, deps.releaseCellFn);

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
		const leftArg = plan.colLefts[c] - pinRightBaseLeft;
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
	const { slot, rowIndex, pinLeftColumns, pinRightColumns, pinRightStart, centerColStart, centerColCount, columns, plan, isScrollFrameActive } =
		request;
	const pinLeftWidth = plan.pinLeftWidth;
	const pinRightBaseLeft = plan.pinRightBaseLeft;
	const pinRightWidth = plan.pinRightWidth;
	const colCount = columns.length;

	const pinLeftContainer = deps.ensurePinnedContainer(slot, 'left', pinLeftWidth);
	const pinRightContainer = deps.ensurePinnedContainer(slot, 'right', pinRightWidth);
	slot.centerColStart = centerColStart;
	slot.pinLeftCount = pinLeftColumns;
	slot.pinRightStart = pinRightStart;

	slot.ensureLeftCells(pinLeftColumns, pinLeftContainer, deps.initCell, deps.releaseCellFn);
	slot.ensureCenterCells(centerColCount, deps.initCell, deps.releaseCellFn);
	slot.ensureRightCells(pinRightColumns, pinRightContainer, deps.initCell, deps.releaseCellFn);

	const bindLoadingCell = (cellSlot: CellSlot<TRowData>, c: number, leftArg: number) => {
		const col = columns[c];
		if (!col || !cellSlot) return;
		if (isScrollFrameActive) deps.onScrollCellVisited();
		if (cellSlot.element.dataset.cellKey) deps.releaseCellPortal(cellSlot.element);
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
		if (c < colCount) bindLoadingCell(slot.rightCells[i], c, plan.colLefts[c] - pinRightBaseLeft);
	}
}
