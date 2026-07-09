import type { InternalGridState } from '../state/GridState.js';
import type { CellAccessRuntime } from '../engine/runtimePorts.js';
import type { GridCellAccess } from '../api/GridApi.js';
import type { ColumnDef } from '../columnDef.js';
import { doesCellPointerMatchColumn } from '../interaction/cellPointer.js';
import type { RowNode } from '../rowNode.js';
import type { RowLoadState } from '../rowModel.js';
import { createGridRowNodeFacade, type GridRowNode } from '../publicRowNode.js';

export class CellAccessModel<TRowData = unknown> {
	constructor(private readonly runtime: CellAccessRuntime<TRowData>) {}

	private createPublicRowNode(rowId: string, rowIndex: number, node: RowNode<TRowData> | null): GridRowNode<TRowData> | null {
		if (!node) return null;
		const loadState: RowLoadState = { kind: 'loaded', rowId };
		return createGridRowNodeFacade(
			{
				getRowId: this.runtime.getRowId,
				getRawRowById: this.runtime.getRawRowById,
				getCellValue: this.runtime.getCellValue,
				getVisualIndexByRowId: (targetRowId) => this.runtime.getRowModel()?.getVisualIndexByRowId(targetRowId) ?? null,
				getVisualRowCount: () => this.runtime.getRowModel()?.getVisualRowCount() ?? 0,
				getSelectedRowIds: () => this.runtime.getState().selectedRowIds,
				isGroupExpanded: () => false,
				isDetailExpanded: this.runtime.isDetailExpanded,
				selectRows: this.runtime.selectRows,
				deselectRows: this.runtime.deselectRows,
				scrollToRow: this.runtime.scrollToRow,
				setCellValue: this.runtime.setCellValue,
				batchCellValues: (updates) =>
					updates.reduce<import('../api/GridApi.js').GridWriteResult>(
						(result, update) =>
							result.status === 'applied' || result.status === 'noop'
								? this.runtime.setCellValue(update.rowId, update.colField, update.value)
								: result,
						{ status: 'noop' }
					),
				toggleGroupExpanded: () => {},
				toggleDetailExpanded: () => {},
				refreshRows: this.runtime.refreshRows,
				retryRowLoad: () => ({ status: 'rejected', reason: 'Row retry is not available from cell access.' }),
				getRowIssues: () => [],
				validateRow: async () => [],
				getRowModelType: this.runtime.getRowModelType,
			},
			{
				id: rowId,
				kind: 'data',
				rowIndex,
				loadState,
				data: node.data,
				selectable: true,
				selected: this.runtime.isRowSelected(rowIndex),
				expandable: false,
				expanded: this.runtime.isDetailExpanded(rowId),
				editable: true,
			}
		);
	}

	public getByPointer(rowId: string, colField: string, event?: Event): GridCellAccess<TRowData> | null {
		const rowModel = this.runtime.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const colIndex = this.runtime.getColumnIndex(colField);
		const column = this.runtime.getColumnDef(colField);

		if (!column) return null;

		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		const row = visualRow?.kind === 'data' ? visualRow.node.data : null;
		const node = visualRow?.kind === 'data' ? visualRow.node : null;
		return this.get(rowId, rowIndex, node, row, colIndex, column, event);
	}

	public get(
		rowId: string,
		rowIndex: number,
		node: RowNode<TRowData> | null,
		row: TRowData | null,
		colIndex: number,
		column: ColumnDef<TRowData>,
		event?: Event,
		hoistedState?: InternalGridState<TRowData>
	): GridCellAccess<TRowData> {
		const value = this.runtime.getCellValue(rowId, column.field);
		const rawValue = this.runtime.getRawCellValue(rowId, column.field);
		const state = hoistedState ?? this.runtime.getState();
		const publicNode = this.createPublicRowNode(rowId, rowIndex, node);
		const focusedCell = state.selection.focus;
		const selectedBounds = state.selection.bounds;
		const isFocused = doesCellPointerMatchColumn(focusedCell, rowId, column);
		const isRowFocused = focusedCell?.rowId === rowId;
		const isSelected =
			!!selectedBounds &&
			rowIndex >= selectedBounds.minRow &&
			rowIndex <= selectedBounds.maxRow &&
			colIndex >= selectedBounds.minCol &&
			colIndex <= selectedBounds.maxCol;
		const isRowSelected = this.runtime.isRowSelected(rowIndex);
		const isEditing = doesCellPointerMatchColumn(state.activeEdit, rowId, column);
		const isLoading = this.runtime.isRowLoading(rowId) || !!column.loading;

		return {
			rowId,
			rowIndex,
			row,
			node: publicNode,
			colField: column.field,
			colIndex,
			column,
			value,
			rawValue,
			isFocused,
			isRowFocused,
			isSelected,
			isRowSelected,
			isEditing,
			isLoading,
			event,
		};
	}
}
