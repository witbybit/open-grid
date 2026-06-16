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
	private paintScheduled = false;
	private scrollScheduled = false;
	private destroyed = false;
	private readonly gs: GridScheduler;
	private readonly onScrollFrame: () => void;
	private readonly onPaintFrame: () => void;

	constructor(deps: FrameCoordinatorDeps) {
		this.gs = deps.gridScheduler ?? defaultGridScheduler;
		this.onScrollFrame = deps.onScrollFrame;
		this.onPaintFrame = deps.onPaintFrame;
	}

	requestScrollFrame(): void {
		if (this.destroyed || this.scrollScheduled) return;
		this.scrollScheduled = true;
		this.gs.raf(() => {
			if (this.destroyed) return;
			this.scrollScheduled = false;
			this.onScrollFrame();
		});
	}

	requestPaintFrame(): void {
		if (this.destroyed || this.paintScheduled) return;
		this.paintScheduled = true;
		this.gs.microtask(() => {
			if (this.destroyed) return;
			this.gs.raf(() => {
				if (this.destroyed) return;
				this.paintScheduled = false;
				this.onPaintFrame();
			});
		});
	}

	requestPostScrollWork(): void {
		this.requestPaintFrame();
	}

	flushNowForTests(): void {
		if (this.destroyed) return;
		this.paintScheduled = false;
		this.onPaintFrame();
	}

	destroy(): void {
		this.destroyed = true;
		this.paintScheduled = false;
		this.scrollScheduled = false;
	}
}
