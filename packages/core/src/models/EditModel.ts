import type { GridCellPointer } from '../store.js';

export class EditModel {
	private activeEdit: GridCellPointer | null = null;

	public init(): void {}

	public getActiveEdit(): GridCellPointer | null {
		return this.activeEdit;
	}

	public setActiveEdit(activeEdit: GridCellPointer | null): void {
		this.activeEdit = activeEdit;
	}
}
