import { RenderScheduler } from './renderScheduler.js';
import { ScrollFrameScheduler } from './scrollFrameScheduler.js';
import { type GridScheduler, defaultGridScheduler } from './gridScheduler.js';

/**
 * Single entry point for all renderer frame scheduling.
 *
 * Consumers request work through one of three methods; the coordinator
 * decides how and when to schedule the underlying RAF handles.
 *
 * Priority order within one browser frame: scroll > paint > post-scroll.
 */
export interface FrameCoordinator {
	/** Schedule a scroll frame (RAF-only, no microtask). */
	requestScrollFrame(): void;
	/** Schedule a paint frame (microtask → RAF). */
	requestPaintFrame(): void;
	/** Schedule post-scroll decorations and portal hydration (microtask → RAF). */
	requestPostScrollWork(): void;
	/** Synchronous flush — test-only / documented transactional boundaries. */
	flushNowForTests(): void;
	destroy(): void;
}

export interface FrameCoordinatorDeps {
	onScrollFrame: () => void;
	onPaintFrame: () => void;
	gridScheduler?: GridScheduler;
}

export class DefaultFrameCoordinator implements FrameCoordinator {
	private readonly paintScheduler: RenderScheduler;
	private readonly scrollScheduler: ScrollFrameScheduler;

	constructor(deps: FrameCoordinatorDeps) {
		const gs = deps.gridScheduler ?? defaultGridScheduler;
		this.paintScheduler = new RenderScheduler(deps.onPaintFrame, gs);
		this.scrollScheduler = new ScrollFrameScheduler(deps.onScrollFrame, gs);
	}

	requestScrollFrame(): void {
		this.scrollScheduler.requestFrame();
	}

	requestPaintFrame(): void {
		this.paintScheduler.requestFlush('paint');
	}

	requestPostScrollWork(): void {
		this.paintScheduler.requestFlush('post-scroll');
	}

	flushNowForTests(): void {
		this.paintScheduler.flushNow();
	}

	destroy(): void {
		this.paintScheduler.destroy();
		this.scrollScheduler.destroy();
	}
}
