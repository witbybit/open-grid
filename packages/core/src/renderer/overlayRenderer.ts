import type { InvalidationFrame } from './invalidationManager.js';

export class OverlayRenderer {
	private readonly syncOverlay: (frame: InvalidationFrame) => void;

	constructor(syncOverlay: (frame: InvalidationFrame) => void) {
		this.syncOverlay = syncOverlay;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncOverlay(frame);
	}
}
