import type { GridCellPointer } from '../store.js';

export class FocusModel {
	private focusedCell: GridCellPointer | null = null;

	public init(): void {
	}

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
