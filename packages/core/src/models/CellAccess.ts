import type { GridEngine } from '../engine/GridEngine.js';
import type { ColumnDef, GridCellAccess, RowNode } from '../store.js';

export class CellAccessModel<TRowData = unknown> {
	private engine!: GridEngine<TRowData>;

	public init(engine: GridEngine<TRowData>): void {
		this.engine = engine;
	}

	public getByPointer(rowId: string, colField: string, event?: Event): GridCellAccess<TRowData> | null {
		const rowModel = this.engine.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualRowIndexById(rowId) : -1;
		const colIndex = this.engine.columns.getColumnIndex(colField);
		const column = this.engine.columns.getColumnDef(colField);

		if (!column) return null;

		const row = rowIndex >= 0 && rowModel ? rowModel.getRow(rowIndex) : null;
		const node = rowIndex >= 0 && rowModel ? rowModel.getRowNode(rowIndex) : null;
		return this.get(rowId, rowIndex, node, row, colIndex, column, event);
	}

	public get(
		rowId: string,
		rowIndex: number,
		node: RowNode<TRowData> | null,
		row: TRowData | null,
		colIndex: number,
		column: ColumnDef<TRowData>,
		event?: Event
	): GridCellAccess<TRowData> {
		const value = this.engine.data.getCellValue(rowId, column.field);
		const rawValue = this.engine.data.getRawCellValue(rowId, column.field);
		const state = this.engine.stateManager.getState();
		const focusedCell = state.selection.focus;
		const selectedBounds = state.selection.bounds;
		const isFocused = !!focusedCell && focusedCell.rowId === rowId && focusedCell.colField === column.field;
		const isRowFocused = !!focusedCell && focusedCell.rowId === rowId;
		const isSelected =
			!!selectedBounds &&
			rowIndex >= selectedBounds.minRow &&
			rowIndex <= selectedBounds.maxRow &&
			colIndex >= selectedBounds.minCol &&
			colIndex <= selectedBounds.maxCol;
		const isRowSelected = this.engine.selection.isRowSelected(rowIndex);
		const isEditing = !!state.activeEdit && state.activeEdit.rowId === rowId && state.activeEdit.colField === column.field;
		const isLoading = this.engine.data.isRowLoading(rowId) || !!column.loading;

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
