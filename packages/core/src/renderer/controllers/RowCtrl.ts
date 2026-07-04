import type { ColumnInstanceId } from '../../columnDef.js';
import { createCellCtrl, type CellCtrl } from './CellCtrl.js';

/**
 * Semantic identity for one logical row — independent of which physical RowSlot currently renders
 * it. Owns a per-row index of CellCtrl (keyed by field, since cell identity is only ever meaningful
 * in the context of its row — this deliberately avoids a second global cell-controller map to keep
 * in sync with RowCtrlStore).
 */
export interface RowCtrl<TRowData = unknown> {
	readonly rowId: string;
	rowVersion: number;
	/** RowSlot.id, when this row is currently mounted into a physical slot. Undefined when
	 *  virtualized out — the RowCtrl itself survives virtualization (see RowCtrlStore). */
	attachedSlotId: string | undefined;
	/** Mirrors RowSlot.generation at last attach — reused stale-guard, not reinvented. */
	attachedGeneration: number;
	cells: Map<string, CellCtrl>;
	/** True while any cell in this row is the active edit target. Consulted by vertical row-window
	 *  retention so an editing row is never virtualized fully out of the render window. */
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
		isEditing: false,
		isFocused: false,
	};
}

/** Get-or-create the CellCtrl for (rowCtrl.rowId, columnInstanceId), keyed by field within the row. */
export function getOrCreateCellCtrl<TRowData>(
	rowCtrl: RowCtrl<TRowData>,
	field: string,
	columnInstanceId: ColumnInstanceId
): { cellCtrl: CellCtrl; created: boolean } {
	const existing = rowCtrl.cells.get(field);
	if (existing && existing.columnInstanceId === columnInstanceId) {
		return { cellCtrl: existing, created: false };
	}
	// Missing, or present under a stale (semantically-replaced) columnInstanceId — mint fresh.
	const cellCtrl = createCellCtrl(rowCtrl.rowId, columnInstanceId, field);
	rowCtrl.cells.set(field, cellCtrl);
	return { cellCtrl, created: true };
}
