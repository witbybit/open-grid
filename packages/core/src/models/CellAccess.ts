import type { GridState } from '../state/GridState.js';
import type { CellAccessRuntime } from '../engine/runtimePorts.js';
import type { ColumnDef, GridCellAccess, RowNode } from '../store.js';

export class CellAccessModel<TRowData = unknown> {
	constructor(private readonly runtime: CellAccessRuntime<TRowData>) {}

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
		hoistedState?: GridState<TRowData>
	): GridCellAccess<TRowData> {
		const value = this.runtime.getCellValue(rowId, column.field);
		const rawValue = this.runtime.getRawCellValue(rowId, column.field);
		const state = hoistedState ?? this.runtime.getState();
		const focusedCell = state.selection.focus;
		const selectedBounds = state.selection.bounds;
		const isFocused = focusedCell?.rowId === rowId && focusedCell?.colField === column.field;
		const isRowFocused = focusedCell?.rowId === rowId;
		const isSelected =
			!!selectedBounds &&
			rowIndex >= selectedBounds.minRow &&
			rowIndex <= selectedBounds.maxRow &&
			colIndex >= selectedBounds.minCol &&
			colIndex <= selectedBounds.maxCol;
		const isRowSelected = this.runtime.isRowSelected(rowIndex);
		const isEditing = state.activeEdit?.rowId === rowId && state.activeEdit?.colField === column.field;
		const isLoading = this.runtime.isRowLoading(rowId) || !!column.loading;

		return {
			rowId,
			rowIndex,
			row,
			node,
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
