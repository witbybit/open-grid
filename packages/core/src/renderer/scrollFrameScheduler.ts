import { type GridScheduler, defaultGridScheduler } from './gridScheduler.js';

export class ScrollFrameScheduler {
	private scheduled = false;
	private destroyed = false;
	private readonly flush: () => void;
	private readonly scheduler: GridScheduler;

	constructor(flush: () => void, scheduler: GridScheduler = defaultGridScheduler) {
		this.flush = flush;
		this.scheduler = scheduler;
	}

	public requestFrame(): void {
		if (this.destroyed || this.scheduled) return;
		this.scheduled = true;
		this.scheduler.raf(() => this.run());
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
