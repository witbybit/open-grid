import type { InvalidationFrame } from './invalidationManager.js';

export class HeaderRenderer {
	private readonly syncHeaders: (frame: InvalidationFrame) => void;
	private readonly syncScrollLeftCallback?: (scrollLeft: number) => void;

	constructor(syncHeaders: (frame: InvalidationFrame) => void, syncScrollLeft?: (scrollLeft: number) => void) {
		this.syncHeaders = syncHeaders;
		this.syncScrollLeftCallback = syncScrollLeft;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncHeaders(frame);
	}

	public repaintHeaders(frame: InvalidationFrame): void {
		this.sync(frame);
	}

	public syncScrollLeft(scrollLeft: number): void {
		this.syncScrollLeftCallback?.(scrollLeft);
	}
}
