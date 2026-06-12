import type { GridEngine } from '../engine/GridEngine.js';
import type { CellRendererPhase, ColumnDef, GridState, RowNode } from '../store.js';
import type { CellRenderer } from './cellRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type { RenderWindow } from './renderWindow.js';
import type { RowSlot } from './rowSlot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';

export interface RowCellBindRequest<TRowData = unknown> {
	cellSlot: {
		element: HTMLDivElement;
	};
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

export interface RowRenderMaintenanceDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	selectionPaint: SelectionPaintManager<TRowData>;
	cellRenderer: CellRenderer;
	activeRows: Map<number, RowSlot<TRowData>>;
	getCurrentWindow: () => RenderWindow | null;
	dirtyCellsAfterScroll: Set<HTMLDivElement>;
	dirtyRowsAfterScroll: Set<number>;
	dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]];
	incrementPostScrollDirtyCellsDecorated: () => void;
	bindCellFull: (request: RowCellBindRequest<TRowData>) => void;
}

function getMaintenanceWindowPins<TRowData>(
	engine: GridEngine<TRowData>,
	getCurrentWindow: () => RenderWindow | null
): { pinLeftColumns: number; pinRightColumns: number } {
	const window = getCurrentWindow();
	return {
		pinLeftColumns: window?.pinLeftCols ?? engine.viewport.pinLeftColumns,
		pinRightColumns: window?.pinRightCols ?? engine.viewport.pinRightColumns,
	};
}

export function repaintInvalidatedRowsAndCells<TRowData>(deps: RowRenderMaintenanceDeps<TRowData>, frame: InvalidationFrame): void {
	const rowModel = deps.engine.getRowModel();
	if (!rowModel) return;

	const state = deps.engine.stateManager.getState();
	const columns = deps.engine.columns.getDisplayedColumns();
	const plan = deps.engine.columns.getCompiledPlan();
	const { pinLeftColumns, pinRightColumns } = getMaintenanceWindowPins(deps.engine, deps.getCurrentWindow);
	const colCount = columns.length;
	const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
	const pinRightBaseLeft = plan.pinRightBaseLeft;

	deps.selectionPaint.rebuildSelection(state.selectedRowIds);

	for (const rowId of frame.rows) {
		const rowIndex = rowModel.getVisualIndexByRowId(rowId);
		const slot = rowIndex >= 0 ? deps.activeRows.get(rowIndex) : undefined;
		const row = rowIndex >= 0 ? rowModel.getVisualRow(rowIndex) : null;
		if (!slot || row?.kind !== 'data') continue;

		deps.selectionPaint.updateRowClassNameSlot(slot, row.node, rowIndex, state);
		for (let c = 0; c < colCount; c++) {
			if (!columns[c].checkboxSelection) continue;
			const cellSlot = slot.getCellForCol(c);
			if (!cellSlot) continue;
			deps.bindCellFull({
				cellSlot,
				slotId: slot.id,
				node: row.node,
				rowIndex,
				colIndex: c,
				col: columns[c],
				pinLeftColumns,
				pinRightColumns,
				pinRightStart,
				pinRightBaseLeft,
				plan,
				state,
				isScrollFrameActive: false,
				phase: 'initial',
			});
		}
	}

	for (const [rowId, colFields] of frame.cellsByRowId) {
		const rowIndex = rowModel.getVisualIndexByRowId(rowId);
		if (rowIndex < 0) continue;
		const slot = deps.activeRows.get(rowIndex);
		const row = rowModel.getVisualRow(rowIndex);
		if (!slot || row?.kind !== 'data') continue;

		for (const colField of colFields) {
			const colIndex = deps.engine.columns.getColumnIndex(colField);
			if (colIndex < 0) continue;
			const cellSlot = slot.getCellForCol(colIndex);
			if (!cellSlot) continue;
			deps.bindCellFull({
				cellSlot,
				slotId: slot.id,
				node: row.node,
				rowIndex,
				colIndex,
				col: columns[colIndex],
				pinLeftColumns,
				pinRightColumns,
				pinRightStart,
				pinRightBaseLeft,
				plan,
				state,
				isScrollFrameActive: false,
				phase: 'initial',
			});
		}
	}

	for (const colField of frame.columns) {
		const colIndex = deps.engine.columns.getColumnIndex(colField);
		if (colIndex < 0) continue;
		for (const [rowIndex, slot] of deps.activeRows) {
			const row = rowModel.getVisualRow(rowIndex);
			if (row?.kind !== 'data') continue;

			const cellSlot = slot.getCellForCol(colIndex);
			if (!cellSlot) continue;
			deps.bindCellFull({
				cellSlot,
				slotId: slot.id,
				node: row.node,
				rowIndex,
				colIndex,
				col: columns[colIndex],
				pinLeftColumns,
				pinRightColumns,
				pinRightStart,
				pinRightBaseLeft,
				plan,
				state,
				isScrollFrameActive: false,
				phase: 'initial',
			});
		}
	}
}

export function decorateDirtyCellsAfterScroll<TRowData>(
	deps: RowRenderMaintenanceDeps<TRowData>,
	options?: { maxCells?: number }
): { remaining: number; processed: number } {
	const maxCells = options?.maxCells ?? Infinity;
	if (deps.dirtyCellsAfterScroll.size === 0 && deps.dirtyRowsAfterScroll.size === 0) {
		return { remaining: 0, processed: 0 };
	}

	const rowModel = deps.engine.getRowModel();
	if (!rowModel) {
		deps.dirtyCellsAfterScroll.clear();
		deps.dirtyRowsAfterScroll.clear();
		return { remaining: 0, processed: 0 };
	}

	const state = deps.engine.stateManager.getState();
	const columns = deps.engine.columns.getDisplayedColumns();
	const plan = deps.engine.columns.getCompiledPlan();
	const { pinLeftColumns, pinRightColumns } = getMaintenanceWindowPins(deps.engine, deps.getCurrentWindow);
	const colCount = columns.length;
	const pinRightStart = Math.max(pinLeftColumns, colCount - pinRightColumns);
	const pinRightBaseLeft = plan.pinRightBaseLeft;

	const rowCount = rowModel.getVisualRowCount();
	const colRange = deps.engine.viewport.getVisibleColumnRange(colCount);
	const rowRange = deps.engine.viewport.getVisibleRowRange(rowCount);
	const rowCenter = (rowRange.startIdx + rowRange.endIdx) / 2;
	const colCenter = (colRange.startIdx + colRange.endIdx) / 2;
	const activeEdit = state.activeEdit;
	const focusedCell = state.selection.focus;

	const getCellPriority = (cell: HTMLDivElement): number => {
		const cs = (cell as unknown as { __cellSlot?: { rowIndex: number; colField?: string; rowId?: string; colIndex: number } }).__cellSlot;
		if (!cs || cs.rowIndex < 0 || !cs.colField) return 0;
		if (activeEdit && cs.rowId === activeEdit.rowId && cs.colField === activeEdit.colField) return 6;
		if (focusedCell && cs.rowId === focusedCell.rowId && cs.colField === focusedCell.colField) return 5;

		const isRowVisible = cs.rowIndex >= rowRange.startIdx && cs.rowIndex <= rowRange.endIdx;
		const isColVisible = cs.colIndex >= colRange.startIdx && cs.colIndex <= colRange.endIdx;
		if (!isRowVisible || !isColVisible) return 1;

		const normDist = Math.abs(cs.rowIndex - rowCenter) + Math.abs(cs.colIndex - colCenter);
		return 4 - normDist * 0.01;
	};

	const [b0, b1, b2, b3] = deps.dirtyBuckets;
	b0.length = 0;
	b1.length = 0;
	b2.length = 0;
	b3.length = 0;
	for (const cell of deps.dirtyCellsAfterScroll) {
		const p = getCellPriority(cell);
		if (p >= 6) b0.push(cell);
		else if (p >= 5) b1.push(cell);
		else if (p > 1) b2.push(cell);
		else b3.push(cell);
	}

	let processed = 0;
	for (let bi = 0; bi < 4 && processed < maxCells; bi++) {
		const bucket = deps.dirtyBuckets[bi];
		for (let i = 0; i < bucket.length; i++) {
			if (processed >= maxCells) break;
			const cell = bucket[i];
			deps.dirtyCellsAfterScroll.delete(cell);
			const cs = (
				cell as unknown as {
					__cellSlot?: {
						rowIndex: number;
						colField?: string;
						colIndex: number;
						element: HTMLDivElement;
					};
				}
			).__cellSlot;
			if (!cs || cs.rowIndex < 0 || !cs.colField) continue;

			const rowIndex = cs.rowIndex;
			const visualRow = rowModel.getVisualRow(rowIndex);
			const colIndex = cs.colIndex;

			if (visualRow?.kind === 'data' && colIndex >= 0) {
				const slot = deps.activeRows.get(rowIndex);
				if (!slot) continue;
				const cellSlot = slot.getCellForCol(colIndex);
				if (!cellSlot || cellSlot.element !== cell) continue;

				deps.bindCellFull({
					cellSlot,
					slotId: slot.id,
					node: visualRow.node,
					rowIndex,
					colIndex,
					col: columns[colIndex],
					pinLeftColumns,
					pinRightColumns,
					pinRightStart,
					pinRightBaseLeft,
					plan,
					state,
					isScrollFrameActive: false,
					phase: 'scroll-idle',
				});
				deps.incrementPostScrollDirtyCellsDecorated();
				processed++;
			} else if (visualRow?.kind === 'loading' && colIndex >= 0) {
				const slot = deps.activeRows.get(rowIndex);
				if (!slot) continue;
				const cellSlot = slot.getCellForCol(colIndex);
				if (!cellSlot || cellSlot.element !== cell) continue;

				deps.cellRenderer.ensureLoadingSkeleton(cell);
				deps.incrementPostScrollDirtyCellsDecorated();
				processed++;
			}
		}
	}

	const remaining = deps.dirtyCellsAfterScroll.size;
	if (remaining === 0) {
		for (const r of deps.dirtyRowsAfterScroll) {
			const slot = deps.activeRows.get(r);
			const visualRow = rowModel.getVisualRow(r);
			if (slot && visualRow?.kind === 'data') {
				deps.selectionPaint.updateRowClassNameSlot(slot, (visualRow as { node: RowNode<TRowData> }).node, r, state);
			}
		}
		deps.dirtyRowsAfterScroll.clear();
	}

	return { remaining, processed };
}
