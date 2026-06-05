import type { InvalidationFrame } from './invalidationManager.js';

export class ViewportRenderer {
	private readonly syncViewport: (frame: InvalidationFrame) => void;

	constructor(syncViewport: (frame: InvalidationFrame) => void) {
		this.syncViewport = syncViewport;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncViewport(frame);
	}

	public recycleVisibleRange(frame: InvalidationFrame): void {
		this.syncViewport(frame);
	}
}
