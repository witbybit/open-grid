import type { ColumnInstanceId } from '../../columnDef.js';
import { createCellCtrl, type CellControllerKey, type CellCtrl } from './CellCtrl.js';
import { CellCtrlStore } from './CellCtrlStore.js';

export interface RowCtrl<TRowData = unknown> {
	readonly rowId: string;
	rowVersion: number;
	attachedSlotId: string | undefined;
	attachedGeneration: number;
	cells: Map<string, CellCtrl>;
	cellKeysByColumnInstanceId: Map<ColumnInstanceId, CellControllerKey>;
	isEditing: boolean;
	isFocused: boolean;
}

export function createRowCtrl<TRowData = unknown>(rowId: string): RowCtrl<TRowData> {
	return {
		rowId,
		rowVersion: -1,
		attachedSlotId: undefined,
		attachedGeneration: -1,
		cells: new Map(),
		cellKeysByColumnInstanceId: new Map(),
		isEditing: false,
		isFocused: false,
	};
}

export function getOrCreateCellCtrl<TRowData>(
	rowCtrl: RowCtrl<TRowData>,
	field: string,
	columnInstanceId: ColumnInstanceId
): { cellCtrl: CellCtrl; created: boolean };
export function getOrCreateCellCtrl<TRowData>(
	rowCtrl: RowCtrl<TRowData>,
	cellCtrls: CellCtrlStore<TRowData>,
	field: string,
	columnInstanceId: ColumnInstanceId
): { cellCtrl: CellCtrl; created: boolean };
export function getOrCreateCellCtrl<TRowData>(
	rowCtrl: RowCtrl<TRowData>,
	second: string | CellCtrlStore<TRowData>,
	third: string | ColumnInstanceId,
	fourth?: ColumnInstanceId
): { cellCtrl: CellCtrl; created: boolean } {
	const usingStore = typeof second !== 'string';
	const cellCtrls = usingStore ? second : null;
	const field = usingStore ? (third as string) : second;
	const columnInstanceId = usingStore ? (fourth as ColumnInstanceId) : (third as ColumnInstanceId);

	if (cellCtrls) {
		const result = cellCtrls.getOrCreate(rowCtrl.rowId, columnInstanceId, field);
		rowCtrl.cells.set(field, result.cellCtrl);
		rowCtrl.cellKeysByColumnInstanceId.set(columnInstanceId, result.cellCtrl.key);
		return result;
	}

	const existing = rowCtrl.cells.get(field);
	if (existing && existing.columnInstanceId === columnInstanceId) {
		return { cellCtrl: existing, created: false };
	}
	const cellCtrl = createCellCtrl(rowCtrl.rowId, columnInstanceId, field);
	rowCtrl.cells.set(field, cellCtrl);
	rowCtrl.cellKeysByColumnInstanceId.set(columnInstanceId, cellCtrl.key);
	return { cellCtrl, created: true };
}
