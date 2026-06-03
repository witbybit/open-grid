export class ScrollFrameScheduler {
	private scheduled = false;
	private destroyed = false;
	private readonly flush: () => void;

	constructor(flush: () => void) {
		this.flush = flush;
	}

	public requestFrame(): void {
		if (this.destroyed || this.scheduled) return;
		this.scheduled = true;

		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => this.run());
		} else {
			this.run();
		}
	}

	public destroy(): void {
		this.destroyed = true;
		this.scheduled = false;
	}

	private run(): void {
		if (this.destroyed) return;
		this.scheduled = false;
		this.flush();
	}
}
