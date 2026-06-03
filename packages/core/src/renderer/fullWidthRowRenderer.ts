import type { InvalidationFrame } from './invalidationManager.js';

export class FullWidthRowRenderer {
	private readonly syncRows: (frame: InvalidationFrame) => void;

	constructor(syncRows: (frame: InvalidationFrame) => void) {
		this.syncRows = syncRows;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncRows(frame);
	}
}
