import type { InvalidationFrame } from './invalidationManager.js';

export class OverlayRenderer {
	private readonly syncOverlay: (frame: InvalidationFrame) => void;
	private readonly syncPositionCallback?: () => void;

	constructor(syncOverlay: (frame: InvalidationFrame) => void, syncPosition?: () => void) {
		this.syncOverlay = syncOverlay;
		this.syncPositionCallback = syncPosition;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncOverlay(frame);
	}

	public repaintOverlay(frame: InvalidationFrame): void {
		this.sync(frame);
	}

	public syncPosition(): void {
		this.syncPositionCallback?.();
	}
}
