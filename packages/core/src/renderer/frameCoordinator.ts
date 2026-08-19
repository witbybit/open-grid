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
 *
 * Scroll-end detection: after requestScrollFrame() stops arriving, the
 * coordinator counts quiet frames internally. After scrollEndQuietFrames
 * consecutive RAF callbacks with no new scroll request, the runtime
 * transitions to idle and onScrollEnd() fires. This eliminates any secondary
 * RAF loop outside the coordinator.
 *
 * Phase transitions: the coordinator owns scroll-frame and post-scroll
 * transitions around the onScrollFrame callback. Callbacks must not call
 * transitionTo() themselves for those phases.
 */
export interface FrameCoordinator {
	/** Schedule a scroll frame (RAF-only). */
	requestScrollFrame(): void;
	/** Schedule a paint frame (microtask → RAF, coalescing synchronous invalidation). */
	requestPaintFrame(changeIds?: readonly number[]): void;
	/** Schedule post-scroll work (distinct from paint, epoch-validated). */
	requestPostScrollWork(changeIds?: readonly number[]): void;
	/** Synchronous flush — test-only / documented transactional boundaries. */
	flushNowForTests(): void;
	/** Current coordinator ownership only; cumulative render counters live elsewhere. */
	getOwnershipSnapshot(): Readonly<{
		pendingScroll: boolean;
		pendingPaint: boolean;
		pendingPostScroll: boolean;
		ownsAnimationFrame: boolean;
		inFrame: boolean;
		destroyed: boolean;
	}>;
	destroy(): void;
}

export interface FrameCoordinatorDeps {
	onScrollFrame: () => void;
	onPaintFrame: (changeIds: readonly number[]) => void;
	/** Distinct callback for post-scroll deferred work. Must not alias onPaintFrame. */
	onPostScrollWork: (changeIds: readonly number[]) => void;
	/**
	 * Called when scroll ends — after scrollEndQuietFrames consecutive RAF callbacks
	 * with no new scroll request. The runtime has already transitioned to idle before
	 * this fires. Use it to flush deferred post-scroll work (portals, decoration, etc.).
	 */
	onScrollEnd?: () => void;
	gridScheduler?: GridScheduler;
	/** Called when a reentrancy or lifecycle violation is detected. Should not throw. */
	onFault?: (msg: string) => void;
	/** Authoritative render lifecycle state. When provided, every paint frame is wrapped in paint-frame phase transitions,
	 *  and scroll frames are wrapped in scroll-frame/post-scroll transitions. */
	runtimeState?: RenderRuntimeState;
	/**
	 * Number of consecutive RAF callbacks without a new scroll request before scroll-end
	 * is declared. Defaults to 3. Lower values detect scroll-end faster; higher values
	 * add a buffer against momentary gaps between scroll events.
	 */
	scrollEndQuietFrames?: number;
}

export class DefaultFrameCoordinator implements FrameCoordinator {
	private pendingScroll = false;
	private pendingPaint = false;
	private readonly pendingPaintChangeIds = new Set<number>();
	private pendingPostScroll = false;
	private readonly pendingPostScrollChangeIds = new Set<number>();
	private inFrame = false;
	private destroyed = false;
	private rafId: number | null = null;
	private postScrollEpoch = 0;
	private scrollEndQuietCount = 0;
	private readonly scrollEndQuietThreshold: number;
	private readonly gs: GridScheduler;
	private readonly onScrollFrame: () => void;
	private readonly onPaintFrame: (changeIds: readonly number[]) => void;
	private readonly onPostScrollWork: (changeIds: readonly number[]) => void;
	private readonly onScrollEnd: (() => void) | undefined;
	private readonly onFault: ((msg: string) => void) | undefined;
	private readonly runtimeState: RenderRuntimeState | undefined;

	constructor(deps: FrameCoordinatorDeps) {
		this.gs = deps.gridScheduler ?? defaultGridScheduler;
		this.onScrollFrame = deps.onScrollFrame;
		this.onPaintFrame = deps.onPaintFrame;
		this.onPostScrollWork = deps.onPostScrollWork;
		this.onScrollEnd = deps.onScrollEnd;
		this.onFault = deps.onFault;
		this.runtimeState = deps.runtimeState;
		this.scrollEndQuietThreshold = deps.scrollEndQuietFrames ?? 3;
	}

	requestScrollFrame(): void {
		if (this.destroyed || this.pendingScroll) return;
		this.pendingScroll = true;
		this.scheduleFrame();
	}

	requestPaintFrame(changeIds: readonly number[] = []): void {
		if (this.destroyed) return;
		for (const changeId of changeIds) this.pendingPaintChangeIds.add(changeId);
		if (this.pendingPaint) return;
		this.pendingPaint = true;
		this.gs.microtask(() => {
			if (!this.destroyed) this.scheduleFrame();
		});
	}

	requestPostScrollWork(changeIds: readonly number[] = []): void {
		if (this.destroyed) return;
		for (const changeId of changeIds) this.pendingPostScrollChangeIds.add(changeId);
		if (this.pendingPostScroll) return;
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
				// Reset quiet-frame counter: a new scroll frame means scrolling is still active.
				this.scrollEndQuietCount = 0;
				const rs = this.runtimeState;
				// Runtime owns scroll-frame phase transition. The onScrollFrame callback
				// must not call transitionTo('scroll-frame') or transitionTo('post-scroll').
				if (rs && !rs.isDestroyed()) {
					rs.transitionTo('scroll-frame');
				}
				try {
					this.onScrollFrame();
				} finally {
					if (rs && !rs.isDestroyed()) {
						rs.transitionTo('post-scroll');
					}
				}
			} else if (this.runtimeState?.isScrolling()) {
				// No new scroll frame arrived — count quiet frames for scroll-end detection.
				// This path fires while the runtime is still in post-scroll (or scroll-pending)
				// after the last visible scroll frame.
				this.scrollEndQuietCount++;
				if (this.scrollEndQuietCount >= this.scrollEndQuietThreshold) {
					this.scrollEndQuietCount = 0;
					// Runtime transitions to idle before notifying the scroll-end handler.
					this.runtimeState.transitionTo('idle');
					this.onScrollEnd?.();
				}
			}
			if (this.pendingPaint) {
				this.pendingPaint = false;
				this.runPaintFrame();
			}
			if (this.pendingPostScroll) {
				const rs = this.runtimeState;
				const epochOk = !rs || rs.isScrollEpochCurrent(this.postScrollEpoch);
				if (!epochOk) {
					// Stale epoch: a newer scroll session supersedes this request — drop.
					this.pendingPostScroll = false;
					this.pendingPostScrollChangeIds.clear();
				} else {
					const notActive = !rs || (!rs.isScrolling() && !rs.isFrameActive());
					if (notActive) {
						this.pendingPostScroll = false;
						const changeIds = Object.freeze([...this.pendingPostScrollChangeIds]);
						this.pendingPostScrollChangeIds.clear();
						this.onPostScrollWork(changeIds);
					}
					// else: conditions not yet met but epoch is valid (scrolling still active).
					// Retain pendingPostScroll = true so the finally block re-schedules a RAF.
					// The work will execute once scrolling becomes idle.
				}
			}
		} finally {
			this.inFrame = false;
			// Keep the RAF loop alive while scrolling (for scroll-end detection)
			// or while there is pending work to flush.
			const keepAlive = this.pendingScroll || this.pendingPaint || this.pendingPostScroll || (this.runtimeState?.isScrolling() ?? false);
			if (keepAlive) {
				this.scheduleFrame();
			}
		}
	}

	flushNowForTests(): void {
		if (this.destroyed) return;
		this.pendingPaint = false;
		this.runPaintFrame();
	}

	public getOwnershipSnapshot(): Readonly<{
		pendingScroll: boolean;
		pendingPaint: boolean;
		pendingPostScroll: boolean;
		ownsAnimationFrame: boolean;
		inFrame: boolean;
		destroyed: boolean;
	}> {
		return Object.freeze({
			pendingScroll: this.pendingScroll,
			pendingPaint: this.pendingPaint,
			pendingPostScroll: this.pendingPostScroll,
			ownsAnimationFrame: this.rafId !== null,
			inFrame: this.inFrame,
			destroyed: this.destroyed,
		});
	}

	private runPaintFrame(): void {
		const changeIds = Object.freeze([...this.pendingPaintChangeIds]);
		this.pendingPaintChangeIds.clear();
		const rs = this.runtimeState;
		if (rs) {
			if (rs.isDestroyed()) {
				this.onFault?.('FrameCoordinator: paint frame after destruction');
				return;
			}
			rs.transitionTo('paint-frame');
		}
		try {
			this.onPaintFrame(changeIds);
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
		this.pendingPaintChangeIds.clear();
		this.pendingPostScroll = false;
		this.pendingPostScrollChangeIds.clear();
		this.scrollEndQuietCount = 0;
	}
}
