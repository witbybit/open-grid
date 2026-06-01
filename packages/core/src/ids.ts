export type GridId = string | number;

export type GetRowId<TData = unknown> = (row: TData, index: number) => GridId;

export interface ColumnLike {
	id?: GridId;
	field?: string;
	header?: string;
}

export function normalizeGridId(id: GridId): string {
	return String(id);
}

export function createRowId(index: number): string {
	return `row:${index}`;
}

export function createColumnId(index: number): string {
	return `col:${index}`;
}

export function createCellId(rowId: GridId, colId: GridId): string {
	return `cell:${normalizeGridId(rowId)}:${normalizeGridId(colId)}`;
}

export function createCellKey(rowId: GridId, colField: string): string {
	return `${normalizeGridId(rowId)}:${colField}`;
}

export function createFormulaRefKey(rowId: GridId, colField: string): string {
	return `[${normalizeGridId(rowId)}:${colField}]`;
}

export function createCellCoordKey(row: number, col: number): string {
	return `${row},${col}`;
}

export function createCellSubscriptionKey(row: number, col: number): string {
	return `cell:${createCellCoordKey(row, col)}`;
}

export function getRowId<TData = unknown>(row: TData, index: number, getUserRowId?: GetRowId<TData>): string {
	return normalizeGridId(getUserRowId ? getUserRowId(row, index) : createRowId(index));
}

export function getColumnId(column: ColumnLike | undefined, index: number): string {
	return normalizeGridId(column?.id ?? column?.field ?? column?.header ?? createColumnId(index));
}

export function getFieldRoot(field: string): string {
	const dotIndex = field.indexOf('.');
	return dotIndex === -1 ? field : field.slice(0, dotIndex);
}

export function formatVisualGroupId(field: string, key: string, parentGroupId?: string): string {
	return parentGroupId ? `${parentGroupId}|${field}:${key}` : `group:${field}:${key}`;
}

export function formatVisualDetailId(rowId: string): `detail:${string}` {
	return `detail:${rowId}`;
}

export function formatVisualLoadingId(index: number | string): `loading:${string}` {
	return `loading:${index}`;
}

export function formatRawLoadingRowId(index: number | string): string {
	return `__loading_${index}`;
}

export function isRawLoadingRowId(rowId: string): boolean {
	return rowId.startsWith('__loading_');
}
