import type { GridEngine } from '../engine/GridEngine.js';
import type { GridState, GridRowClassParams, RowNode } from '../store.js';
import { CellSlot } from './cellSlot.js';
import type { RowSlot } from './rowSlot.js';
import { reportRendererFault } from './rendererFaults.js';

/**
 * Owns all row-selection UI state and row class painting logic.
 * Extracted from RowRenderer to give it a clear single responsibility.
 *
 * Covers:
 *  - `selectedRowIdSet` — O(1) checked-row lookup rebuilt each frame
 *  - `hoveredRowIndex` — current hovered row for og-row-hovered class
 *  - `rowCheckboxAnchorId` — shift-click range anchor
 *  - `updateRowClassNameSlot` — computes full row className outside scroll frames
 *  - Row click/checkbox event handling for multi-select
 */
export class SelectionPaintManager<TRowData> {
	public hoveredRowIndex: number | null = null;
	public selectedRowIdSet: Set<string> | null = null;
	public rowCheckboxAnchorId: string | null = null;

	private readonly rowSelectionClickCells = new WeakSet<HTMLElement>();

	private readonly rowClassScratch: GridRowClassParams<TRowData> = {
		row: null as unknown as TRowData,
		rowId: '',
		rowIndex: 0,
		isFocused: false,
		isSelected: false,
		isLoading: false,
		selection: null as unknown,
	} as GridRowClassParams<TRowData>;

	public readonly onDataCellClick = (e: MouseEvent): void => {
		if (e.defaultPrevented || e.button !== 0) return;
		const target = e.target as HTMLElement | null;
		if (this.isRowSelectionIgnoredTarget(target)) return;

		const cellSlot = CellSlot.fromElement(e.currentTarget as HTMLDivElement);
		if (!cellSlot.rowId || !cellSlot.colField) return;

		const state = this.engine.stateManager.getState();
		if (!state.columns.some((col) => col.checkboxSelection)) return;
		const col = this.engine.columns.getColumnDef(cellSlot.colField);
		if (col?.checkboxSelection) return;

		const rowModel = this.engine.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(cellSlot.rowId) : -1;
		const row = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		if (row?.kind !== 'data') return;

		if (e.shiftKey && this.rowCheckboxAnchorId) {
			const rangeIds = this.getDataRowIdsBetween(this.rowCheckboxAnchorId, cellSlot.rowId);
			if (rangeIds.length > 0) {
				this.engine.applyRowSelectionGesture({ kind: 'select', rowIds: rangeIds, source: 'pointer' });
				e.preventDefault();
				return;
			}
		}

		if (e.ctrlKey || e.metaKey) {
			this.engine.toggleRowId(cellSlot.rowId, 'pointer');
		} else {
			this.engine.applyRowSelectionGesture({ kind: 'replace', rowIds: [cellSlot.rowId], source: 'pointer' });
		}
		this.rowCheckboxAnchorId = cellSlot.rowId;
	};

	constructor(private readonly engine: GridEngine<TRowData>) {}

	public rebuildSelection(selectedRowIds: string[]): void {
		this.selectedRowIdSet = selectedRowIds.length > 0 ? new Set(selectedRowIds) : null;
	}

	public attachClickListenerIfNeeded(el: HTMLElement): void {
		if (!this.rowSelectionClickCells.has(el)) {
			this.rowSelectionClickCells.add(el);
			el.addEventListener('click', this.onDataCellClick);
		}
	}

	public isRowSelectionIgnoredTarget(el: Element | null): boolean {
		if (!el) return false;
		return (
			el.closest('button, input, select, textarea, a, [role="button"], [contenteditable="true"]') !== null ||
			el.closest('.og-cell-editor') !== null ||
			el.closest('.og-context-menu') !== null
		);
	}

	public getDataRowIdsBetween(anchorRowId: string, targetRowId: string): string[] {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return [];
		const anchorIndex = rowModel.getVisualIndexByRowId(anchorRowId);
		const targetIndex = rowModel.getVisualIndexByRowId(targetRowId);
		if (anchorIndex < 0 || targetIndex < 0) return [];
		const start = Math.min(anchorIndex, targetIndex);
		const end = Math.max(anchorIndex, targetIndex);
		const rowIds: string[] = [];
		for (let i = start; i <= end; i++) {
			const row = rowModel.getVisualRow(i);
			if (row?.kind === 'data') rowIds.push(row.rowId);
		}
		return rowIds;
	}

	public updateRowClassNameSlot(
		slot: RowSlot<TRowData>,
		node: RowNode<TRowData>,
		rowIndex: number,
		state = this.engine.stateManager.getState()
	): void {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		const isFocusedRow = state.selection.focus?.rowId === node.id;
		const isSelectedRow = !!state.selection.bounds && rowIndex >= state.selection.bounds.minRow && rowIndex <= state.selection.bounds.maxRow;
		const isLoadingRow = this.engine.data.isRowLoading(node.id);
		let rowClassName = 'og-row';
		if (rowIndex < pinTopRows) {
			rowClassName += ' og-row-pinned-top';
		} else if (rowIndex >= rowCount - pinBottomRows) {
			rowClassName += ' og-row-pinned-bottom';
		}
		if (this.hoveredRowIndex === rowIndex) {
			rowClassName += ' og-row-hovered';
		}
		if (isSelectedRow || isFocusedRow) {
			rowClassName += ' og-row-selected';
		}
		if (isFocusedRow) {
			rowClassName += ' og-row-focused';
		}
		if (this.selectedRowIdSet?.has(node.id)) {
			rowClassName += ' og-row-node-selected';
		}
		if (isLoadingRow) {
			rowClassName += ' og-row-loading';
		}
		if (state.styleSlots?.rowClass && node.data) {
			try {
				const rs = this.rowClassScratch;
				rs.row = node.data;
				rs.rowId = node.id;
				rs.rowIndex = rowIndex;
				rs.isFocused = isFocusedRow;
				rs.isSelected = isSelectedRow || isFocusedRow;
				rs.isLoading = isLoadingRow;
				rs.selection = state.selection;
				const customRowClass = state.styleSlots.rowClass(node.data, rs);
				if (customRowClass) {
					rowClassName += ' ' + customRowClass;
				}
			} catch (e) {
				reportRendererFault(this.engine, 'row-style-class', e, { rowId: node.id, rowIndex });
			}
		}

		slot.update(rowIndex, slot.visualRowId, 'data', slot.rowTop, slot.rowHeight, rowClassName);
	}

	/** Returns the pre-allocated rowClassScratch for use in the hot scroll path (recycleViewport). */
	public get rowClassScratchRef(): GridRowClassParams<TRowData> {
		return this.rowClassScratch;
	}
}
