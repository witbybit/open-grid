import type { GridEngine } from '../engine/GridEngine.js';
import type { InternalGridState } from '../state/GridState.js';
import type { GridRowClassParams } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import { CellSlot } from './cellSlot.js';
import type { RowSlot } from './rowSlot.js';
import { reportRendererFault } from './rendererFaults.js';
import { compileStyleRules, evaluateRowStyleRules } from '../styling/styleRules.js';

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
	private lastSelectedRowIdsRef: string[] | null = null;

	private readonly rowClassScratch: GridRowClassParams<TRowData> = {
		row: null as unknown as TRowData,
		rowId: '',
		rowIndex: 0,
		isFocused: false,
		isSelected: false,
		isLoading: false,
		selection: null as unknown,
	} as GridRowClassParams<TRowData>;

	/**
	 * Single delegated listener for the viewport container — replaces what used to be a per-cell
	 * `click` listener (attachClickListenerIfNeeded) plus a separate per-checkbox `click` listener
	 * created in rowCellBinder.ts. Both were already identity-agnostic at fire time (resolving the
	 * row/cell from the DOM target, not a closured value), so delegating them here is behavior-
	 * preserving — see checkbox-vs-cell mutual exclusion below, which mirrors the old
	 * checkbox-listener's stopPropagation() (the checkbox is itself an <input>, which
	 * isRowSelectionIgnoredTarget already excludes from cell-click handling).
	 */
	public readonly onViewportClick = (e: MouseEvent): void => {
		if (e.defaultPrevented || e.button !== 0) return;
		const target = e.target as HTMLElement | null;
		if (!target) return;
		const checkbox = target.closest<HTMLInputElement>('input.og-row-checkbox');
		if (checkbox) {
			this.handleCheckboxClick(e, checkbox);
			return;
		}
		if (this.isRowSelectionIgnoredTarget(target)) return;
		const cellEl = target.closest<HTMLDivElement>('.og-cell');
		if (!cellEl) return;
		this.onDataCellClick(e, cellEl);
	};

	/** Single delegated listener for the viewport container's `mousedown` — replaces the per-handle
	 *  `mousedown` listener rowCellBinder.ts used to attach to each `.og-drag-handle` element. Pure
	 *  event suppression (prevents the mousedown from starting a range-selection drag), so delegation
	 *  is trivially equivalent. */
	public readonly onViewportMouseDown = (e: MouseEvent): void => {
		const handle = (e.target as HTMLElement | null)?.closest('.og-drag-handle');
		if (handle) e.stopPropagation();
	};

	private handleCheckboxClick(e: MouseEvent, checkbox: HTMLInputElement): void {
		e.stopPropagation();
		const id = checkbox.dataset.rowId;
		if (!id) return;
		const shouldSelect = checkbox.checked;
		const state = this.engine.stateManager.getState();
		const isMultiple = state.rowSelection?.mode !== 'single';
		if (isMultiple && e.shiftKey && this.rowCheckboxAnchorId) {
			const rangeIds = this.getDataRowIdsBetween(this.rowCheckboxAnchorId, id);
			if (rangeIds.length > 0) {
				if (shouldSelect) this.engine.selectRowIds(rangeIds, 'checkbox');
				else this.engine.deselectRowIds(rangeIds, 'checkbox');
			}
		} else if (!isMultiple && shouldSelect) {
			this.engine.replaceRowIds([id], 'checkbox');
		} else {
			this.engine.toggleRowId(id, 'checkbox');
		}
		this.rowCheckboxAnchorId = id;
	}

	private readonly onDataCellClick = (e: MouseEvent, cellEl: HTMLDivElement): void => {
		const cellSlot = CellSlot.fromElement(cellEl);
		if (!cellSlot.rowId || !cellSlot.colField) return;

		const state = this.engine.stateManager.getState();
		if (!state.columns.some((col) => col.checkboxSelection)) return;
		const isMultiple = state.rowSelection?.mode !== 'single';
		const col = this.engine.columns.getColumnDef(cellSlot.colField);
		if (col?.checkboxSelection) return;

		const rowModel = this.engine.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(cellSlot.rowId) : -1;
		const row = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		if (row?.kind !== 'data') return;

		if (isMultiple && e.shiftKey && this.rowCheckboxAnchorId) {
			const rangeIds = this.getDataRowIdsBetween(this.rowCheckboxAnchorId, cellSlot.rowId);
			if (rangeIds.length > 0) {
				this.engine.applyRowSelectionGesture({ kind: 'select', rowIds: rangeIds, source: 'pointer' });
				e.preventDefault();
				return;
			}
		}

		if (isMultiple && (e.ctrlKey || e.metaKey)) {
			this.engine.toggleRowId(cellSlot.rowId, 'pointer');
		} else {
			this.engine.applyRowSelectionGesture({ kind: 'replace', rowIds: [cellSlot.rowId], source: 'pointer' });
		}
		this.rowCheckboxAnchorId = cellSlot.rowId;
	};

	constructor(private readonly engine: GridEngine<TRowData>) {}

	public rebuildSelection(selectedRowIds: string[]): void {
		if (this.lastSelectedRowIdsRef === selectedRowIds) {
			return;
		}
		this.lastSelectedRowIdsRef = selectedRowIds;
		this.selectedRowIdSet = selectedRowIds.length > 0 ? new Set(selectedRowIds) : null;
	}

	public getSelectedRowIdSet(selectedRowIds?: string[]): Set<string> | null {
		if (selectedRowIds) {
			this.rebuildSelection(selectedRowIds);
		}
		return this.selectedRowIdSet;
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
		const compiledStyleRules = compileStyleRules(state.styleRules);
		if (compiledStyleRules.hasRowRules && node.data) {
			try {
				const rs = this.rowClassScratch;
				rs.row = node.data;
				rs.rowId = node.id;
				rs.rowIndex = rowIndex;
				rs.isFocused = isFocusedRow;
				rs.isSelected = isSelectedRow || isFocusedRow;
				rs.isLoading = isLoadingRow;
				rs.selection = state.selection;
				const customRowClass = evaluateRowStyleRules(compiledStyleRules, node.data, rs);
				if (customRowClass) {
					rowClassName += ' ' + customRowClass;
				}
			} catch (e) {
				reportRendererFault(this.engine, 'row-style-class', e, { rowId: node.id, rowIndex });
			}
		}

		// Insight layer row decorations — read-only overlay; must not mutate row data.
		const rowDecorations = this.engine.insights.getRowDecorations(node.id);
		for (const d of rowDecorations) {
			if (d.className) rowClassName += ' ' + d.className;
		}

		slot.update(rowIndex, slot.visualRowId, 'data', slot.rowTop, slot.rowHeight, rowClassName);
	}

	/** Returns the pre-allocated rowClassScratch for use in the hot scroll path (recycleViewport). */
	public get rowClassScratchRef(): GridRowClassParams<TRowData> {
		return this.rowClassScratch;
	}
}
