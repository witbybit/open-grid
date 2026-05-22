import type { GridCellPointer } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';

export class FocusModel {
	private engine!: GridEngine<any>;
	private focusedCell: GridCellPointer | null = null;

	public init(engine: GridEngine<any>): void {
		this.engine = engine;
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
