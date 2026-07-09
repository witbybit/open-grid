import type { GridCellPointer } from '../api/GridApi.js';
import { getColumnInstanceIdentity, type ColumnDef, type ColumnInstanceId } from '../columnDef.js';

export function areCellPointersEqual(left: GridCellPointer | null, right: GridCellPointer | null): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	if (left.rowId !== right.rowId) return false;
	if (left.columnInstanceId || right.columnInstanceId) {
		return left.columnInstanceId === right.columnInstanceId;
	}
	return left.colField === right.colField;
}

export function doesCellPointerMatchColumn<TRowData>(
	pointer: GridCellPointer | null | undefined,
	rowId: string,
	column: Pick<ColumnDef<TRowData>, 'field'> & { instanceId?: ColumnInstanceId }
): boolean {
	if (!pointer || pointer.rowId !== rowId) return false;
	if (pointer.columnInstanceId) {
		return pointer.columnInstanceId === getColumnInstanceIdentity(column);
	}
	return pointer.colField === column.field;
}

export function getCellPointerColumnKey(pointer: GridCellPointer): string {
	return pointer.columnInstanceId ?? pointer.colField;
}
