export class RenderScheduler {
	private scheduled = false;
	private destroyed = false;
	private readonly flush: () => void;

	constructor(flush: () => void) {
		this.flush = flush;
	}

	public requestFlush(_reason?: string): void {
		if (this.destroyed || this.scheduled) return;
		this.scheduled = true;

		const enqueueFrame = () => {
			if (this.destroyed) return;
			if (typeof requestAnimationFrame !== 'undefined') {
				requestAnimationFrame(() => this.run());
			} else {
				this.run();
			}
		};

		if (typeof queueMicrotask !== 'undefined') {
			queueMicrotask(enqueueFrame);
		} else {
			Promise.resolve().then(enqueueFrame);
		}
	}

	public flushNow(): void {
		if (this.destroyed) return;
		this.scheduled = false;
		this.flush();
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
