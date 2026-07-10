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

export function findColumnByCellPointer<TRowData>(
	columns: readonly ColumnDef<TRowData>[],
	pointer: { colField: string; colId?: string; columnInstanceId?: ColumnInstanceId | string }
): ColumnDef<TRowData> | undefined {
	if (pointer.columnInstanceId) {
		const byInstance = columns.find((column) => getColumnInstanceIdentity(column) === pointer.columnInstanceId);
		if (byInstance) return byInstance;
	}
	if (pointer.colId) {
		const byColId = columns.find((column) => (column.colId ?? column.field) === pointer.colId && column.field === pointer.colField);
		if (byColId) return byColId;
	}
	return columns.find((column) => column.field === pointer.colField);
}

export function findColumnIndexByCellPointer<TRowData>(
	columns: readonly ColumnDef<TRowData>[],
	pointer: { colField: string; colId?: string; columnInstanceId?: ColumnInstanceId | string }
): number {
	if (pointer.columnInstanceId) {
		const byInstance = columns.findIndex((column) => getColumnInstanceIdentity(column) === pointer.columnInstanceId);
		if (byInstance >= 0) return byInstance;
	}
	if (pointer.colId) {
		const byColId = columns.findIndex((column) => (column.colId ?? column.field) === pointer.colId && column.field === pointer.colField);
		if (byColId >= 0) return byColId;
	}
	return columns.findIndex((column) => column.field === pointer.colField);
}
