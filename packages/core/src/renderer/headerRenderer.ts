import type { InvalidationFrame } from './invalidationManager.js';

export class HeaderRenderer {
	private readonly syncHeaders: (frame: InvalidationFrame) => void;

	constructor(syncHeaders: (frame: InvalidationFrame) => void) {
		this.syncHeaders = syncHeaders;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncHeaders(frame);
	}
}
