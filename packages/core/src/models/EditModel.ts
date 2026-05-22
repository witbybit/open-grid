import type { GridCellPointer } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';

export class EditModel {
	private engine!: GridEngine<any>;
	private activeEdit: GridCellPointer | null = null;

	public init(engine: GridEngine<any>): void {
		this.engine = engine;
	}

	public getActiveEdit(): GridCellPointer | null {
		return this.activeEdit;
	}

	public setActiveEdit(activeEdit: GridCellPointer | null): void {
		this.activeEdit = activeEdit;
	}
}
