import { type GridScheduler, defaultGridScheduler } from './gridScheduler.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';

/**
 * Single entry point for all renderer frame scheduling.
 *
 * Consumers request work through one of three methods; the coordinator
 * routes all work through a single pending-bit arbiter that fires one RAF
 * per pending frame and flushes in documented priority order:
 *   scroll → paint → post-scroll
 *
 * Every request sets a pending bit; scheduleFrame() registers a RAF only if
 * none is already registered. Requests made during a flush callback are
 * deferred to the next RAF automatically.
 *
 * post-scroll work captures the scroll epoch at scheduling time and silently
 * no-ops if a new scroll session has begun.
 */
export interface FrameCoordinator {
	/** Schedule a scroll frame (RAF-only). */
	requestScrollFrame(): void;
	/** Schedule a paint frame (microtask → RAF, coalescing synchronous invalidation). */
	requestPaintFrame(): void;
	/** Schedule post-scroll work (distinct from paint, epoch-validated). */
	requestPostScrollWork(): void;
	/** Synchronous flush — test-only / documented transactional boundaries. */
	flushNowForTests(): void;
	destroy(): void;
}

export interface FrameCoordinatorDeps {
	onScrollFrame: () => void;
	onPaintFrame: () => void;
	/** Distinct callback for post-scroll deferred work. Must not alias onPaintFrame. */
	onPostScrollWork: () => void;
	gridScheduler?: GridScheduler;
	/** Called when a reentrancy or lifecycle violation is detected. Should not throw. */
	onFault?: (msg: string) => void;
	/** Authoritative render lifecycle state. When provided, every paint frame is wrapped in paint-frame phase transitions. */
	runtimeState?: RenderRuntimeState;
}

export class DefaultFrameCoordinator implements FrameCoordinator {
	private pendingScroll = false;
	private pendingPaint = false;
	private pendingPostScroll = false;
	private inFrame = false;
	private destroyed = false;
	private rafId: number | null = null;
	private postScrollEpoch = 0;
	private readonly gs: GridScheduler;
	private readonly onScrollFrame: () => void;
	private readonly onPaintFrame: () => void;
	private readonly onPostScrollWork: () => void;
	private readonly onFault: ((msg: string) => void) | undefined;
	private readonly runtimeState: RenderRuntimeState | undefined;

	constructor(deps: FrameCoordinatorDeps) {
		this.gs = deps.gridScheduler ?? defaultGridScheduler;
		this.onScrollFrame = deps.onScrollFrame;
		this.onPaintFrame = deps.onPaintFrame;
		this.onPostScrollWork = deps.onPostScrollWork;
		this.onFault = deps.onFault;
		this.runtimeState = deps.runtimeState;
	}

	requestScrollFrame(): void {
		if (this.destroyed || this.pendingScroll) return;
		this.pendingScroll = true;
		this.scheduleFrame();
	}

	requestPaintFrame(): void {
		if (this.destroyed || this.pendingPaint) return;
		this.pendingPaint = true;
		this.gs.microtask(() => {
			if (!this.destroyed) this.scheduleFrame();
		});
	}

	requestPostScrollWork(): void {
		if (this.destroyed || this.pendingPostScroll) return;
		this.pendingPostScroll = true;
		this.postScrollEpoch = this.runtimeState?.scrollEpoch ?? 0;
		this.scheduleFrame();
	}

	private scheduleFrame(): void {
		if (this.rafId !== null) return;
		// Set a non-null sentinel before calling gs.raf() so that
		// synchronously-firing test schedulers don't re-enter scheduleFrame
		// while the callback is running.  The real id overwrites it after
		// the call — unless the callback already fired and cleared it to null.
		this.rafId = -1;
		const id = this.gs.raf(() => this.flushFrame());
		if (this.rafId === -1) this.rafId = id;
	}

	private flushFrame(): void {
		this.rafId = null;
		if (this.inFrame) {
			this.onFault?.('FrameCoordinator: reentrant frame detected');
			return;
		}
		this.inFrame = true;
		try {
			if (this.pendingScroll) {
				this.pendingScroll = false;
				this.onScrollFrame();
			}
			if (this.pendingPaint) {
				this.pendingPaint = false;
				this.runPaintFrame();
			}
			if (this.pendingPostScroll) {
				this.pendingPostScroll = false;
				const rs = this.runtimeState;
				const epochOk = !rs || rs.isScrollEpochCurrent(this.postScrollEpoch);
				const notActive = !rs || (!rs.isScrolling() && !rs.isFrameActive());
				if (epochOk && notActive) {
					this.onPostScrollWork();
				}
			}
		} finally {
			this.inFrame = false;
			if (this.pendingScroll || this.pendingPaint || this.pendingPostScroll) {
				this.scheduleFrame();
			}
		}
	}

	flushNowForTests(): void {
		if (this.destroyed) return;
		this.pendingPaint = false;
		this.runPaintFrame();
	}

	private runPaintFrame(): void {
		const rs = this.runtimeState;
		if (rs) {
			if (rs.isDestroyed()) {
				this.onFault?.('FrameCoordinator: paint frame after destruction');
				return;
			}
			rs.transitionTo('paint-frame');
		}
		try {
			this.onPaintFrame();
		} finally {
			if (rs && !rs.isDestroyed()) {
				rs.transitionTo('idle');
			}
		}
	}

	destroy(): void {
		this.destroyed = true;
		if (this.rafId !== null) {
			this.gs.cancelRaf(this.rafId);
			this.rafId = null;
		}
		this.pendingScroll = false;
		this.pendingPaint = false;
		this.pendingPostScroll = false;
	}
}
