import type { GridCellPointer } from './store.js';

export class FocusController {
	private focusedCell: GridCellPointer | null = null;

	public getFocusedCell(): GridCellPointer | null {
		return this.focusedCell;
	}

	public setFocusedCell(rowId: string | null, colField: string | null): GridCellPointer | null {
		if (rowId === null || colField === null) {
			this.focusedCell = null;
		} else {
			this.focusedCell = { rowId, colField };
		}
		return this.focusedCell;
	}
}
