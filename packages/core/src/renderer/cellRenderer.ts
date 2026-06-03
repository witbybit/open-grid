import type { InvalidationFrame } from './invalidationManager.js';

export class CellRenderer {
	private readonly syncCells: (frame: InvalidationFrame) => void;

	constructor(syncCells: (frame: InvalidationFrame) => void) {
		this.syncCells = syncCells;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncCells(frame);
	}
}
