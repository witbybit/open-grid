/**
 * GridScheduler — timing abstraction for all renderer scheduling.
 *
 * Provides low-level scheduling primitives (raf, microtask, idle, timeout)
 * and a FrameCoordinator that arbitrates a single RAF loop, flushing work
 * in priority order: scroll-frame → paint-frame → post-scroll.
 */

// ---------------------------------------------------------------------------
// Idle deadline (structural — works in non-DOM test environments)
// ---------------------------------------------------------------------------

export interface GridIdleDeadline {
	timeRemaining(): number;
	readonly didTimeout: boolean;
}

// ---------------------------------------------------------------------------
// Low-level scheduler interface
// ---------------------------------------------------------------------------

export interface GridScheduler {
	/** Schedule a callback after the current microtask queue drains. */
	microtask(callback: () => void): void;
	/** Schedule a callback on the next animation frame. Returns a handle. */
	raf(callback: () => void): number;
	cancelRaf(id: number): void;
	/**
	 * Schedule a callback during idle time, falling back to RAF when unavailable.
	 * An optional timeout (ms) ensures the callback runs even on busy pages.
	 */
	idle(callback: (deadline?: GridIdleDeadline) => void, timeout?: number): number;
	cancelIdle(id: number): void;
	/** Schedule a callback after a delay (ms). */
	timeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
	clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

export class DefaultGridScheduler implements GridScheduler {
	microtask(callback: () => void): void {
		if (typeof queueMicrotask !== 'undefined') {
			queueMicrotask(callback);
		} else {
			Promise.resolve().then(callback);
		}
	}

	raf(callback: () => void): number {
		if (typeof requestAnimationFrame !== 'undefined') {
			return requestAnimationFrame(callback);
		}
		// Async fallback: never call synchronously (synchronous RAF breaks render batching).
		return setTimeout(callback, 16) as unknown as number;
	}

	cancelRaf(id: number): void {
		if (typeof cancelAnimationFrame !== 'undefined') {
			cancelAnimationFrame(id);
		} else {
			clearTimeout(id);
		}
	}

	idle(callback: (deadline?: GridIdleDeadline) => void, timeout = 100): number {
		if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
			return (
				window as unknown as {
					requestIdleCallback: (
						cb: (deadline: GridIdleDeadline) => void,
						opts?: { timeout: number },
					) => number;
				}
			).requestIdleCallback(callback, { timeout });
		}
		return this.raf(() => callback());
	}

	cancelIdle(id: number): void {
		if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
			(window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id);
		} else {
			this.cancelRaf(id);
		}
	}

	timeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
		return setTimeout(callback, ms);
	}

	clearTimeout(id: ReturnType<typeof setTimeout>): void {
		clearTimeout(id);
	}
}

export const defaultGridScheduler: GridScheduler = new DefaultGridScheduler();

// ---------------------------------------------------------------------------
// FrameCoordinator — single RAF loop arbiter
// ---------------------------------------------------------------------------

export interface FrameCoordinatorOptions {
	scheduler?: GridScheduler;
	/**
	 * Number of consecutive quiet RAF callbacks (no new scroll request) before
	 * scroll-end is declared. Defaults to 3.
	 */
	scrollEndQuietFrames?: number;
	/** Called on reentrancy or lifecycle violations — should not throw. */
	onFault?: (msg: string) => void;
}

/**
 * Arbitrates a single RAF loop and flushes work in priority order:
 *   scroll-frame → paint-frame → post-scroll
 *
 * All three slots fire at most once per RAF tick. Requests made during a flush
 * are automatically deferred to the next tick.
 *
 * Paint frames are coalesced via a microtask so rapid synchronous invalidation
 * results in a single RAF rather than many.
 *
 * Post-scroll work is epoch-validated: if a new scroll session begins before
 * the post-scroll callback fires, the stale request is silently dropped.
 *
 * Scroll-end detection: after `scrollEndQuietFrames` consecutive RAF callbacks
 * with no new scroll request while `isScrolling` is true, the coordinator
 * clears the scrolling flag and fires the onScrollEnd handler.
 */
export class FrameCoordinator {
	// State flags
	private pendingScrollFrame = false;
	private pendingPaintFrame = false;
	private pendingPostScroll = false;
	private _isScrolling = false;
	private inFlush = false;
	private destroyed = false;

	// RAF bookkeeping — sentinel -1 means "RAF scheduled but id not yet returned"
	private rafId: number | null = null;

	// Scroll-end quiet-frame counter
	private scrollEndQuietCount = 0;
	private readonly scrollEndQuietThreshold: number;

	// Post-scroll epoch: incremented each time a new scroll session starts.
	private scrollEpoch = 0;
	private postScrollEpoch = 0;

	// User-registered handlers
	private scrollFrameHandler: (() => void) | null = null;
	private paintFrameHandler: (() => void) | null = null;
	private postScrollHandler: (() => void) | null = null;
	private scrollEndHandler: (() => void) | null = null;

	private readonly gs: GridScheduler;
	private readonly onFault: ((msg: string) => void) | undefined;

	constructor(options: FrameCoordinatorOptions = {}) {
		this.gs = options.scheduler ?? defaultGridScheduler;
		this.scrollEndQuietThreshold = options.scrollEndQuietFrames ?? 3;
		this.onFault = options.onFault;
	}

	// ---------------------------------------------------------------------------
	// Handler registration
	// ---------------------------------------------------------------------------

	onScrollFrame(fn: () => void): this {
		this.scrollFrameHandler = fn;
		return this;
	}

	onPaintFrame(fn: () => void): this {
		this.paintFrameHandler = fn;
		return this;
	}

	onPostScroll(fn: () => void): this {
		this.postScrollHandler = fn;
		return this;
	}

	onScrollEnd(fn: () => void): this {
		this.scrollEndHandler = fn;
		return this;
	}

	// ---------------------------------------------------------------------------
	// Public scheduling API
	// ---------------------------------------------------------------------------

	get isScrolling(): boolean {
		return this._isScrolling;
	}

	/**
	 * Request a scroll frame. Arms the scroll slot and ensures a RAF is pending.
	 * Also marks the coordinator as "scrolling" and bumps the scroll epoch.
	 */
	scheduleScrollFrame(): void {
		if (this.destroyed || this.pendingScrollFrame) return;
		this.pendingScrollFrame = true;
		if (!this._isScrolling) {
			this._isScrolling = true;
			this.scrollEpoch++;
		}
		this.scrollEndQuietCount = 0;
		this.scheduleRaf();
	}

	/**
	 * Request a paint frame. Arms the paint slot via a microtask (coalescing
	 * multiple synchronous calls into a single RAF). Skipped when a scroll frame
	 * is already pending because the scroll path will cover rendering.
	 */
	schedulePaintFrame(): void {
		if (this.destroyed || this.pendingPaintFrame) return;
		this.pendingPaintFrame = true;
		this.gs.microtask(() => {
			if (!this.destroyed) this.scheduleRaf();
		});
	}

	/**
	 * Queue post-scroll decoration work. The request is epoch-stamped at call
	 * time; if the scroll epoch has advanced by the time the RAF fires, the
	 * request is silently dropped.
	 */
	schedulePostScroll(): void {
		if (this.destroyed || this.pendingPostScroll) return;
		this.pendingPostScroll = true;
		this.postScrollEpoch = this.scrollEpoch;
		this.scheduleRaf();
	}

	/** Synchronous flush — for tests / documented transactional boundaries only. */
	flushNowForTests(): void {
		if (this.destroyed) return;
		const saved = this.pendingScrollFrame;
		this.pendingScrollFrame = false;
		this.pendingPaintFrame = false;
		this.runPaintSlot();
		this.pendingScrollFrame = saved;
	}

	destroy(): void {
		this.destroyed = true;
		if (this.rafId !== null) {
			this.gs.cancelRaf(this.rafId === -1 ? 0 : this.rafId);
			this.rafId = null;
		}
		this.pendingScrollFrame = false;
		this.pendingPaintFrame = false;
		this.pendingPostScroll = false;
		this._isScrolling = false;
		this.scrollEndQuietCount = 0;
	}

	// ---------------------------------------------------------------------------
	// Internal RAF management
	// ---------------------------------------------------------------------------

	private scheduleRaf(): void {
		if (this.rafId !== null) return;
		// Sentinel prevents re-entrance from synchronously-firing test schedulers.
		this.rafId = -1;
		const id = this.gs.raf(() => this.flush());
		if (this.rafId === -1) this.rafId = id;
	}

	private flush(): void {
		this.rafId = null;

		if (this.inFlush) {
			this.onFault?.('FrameCoordinator: reentrant flush detected');
			return;
		}
		this.inFlush = true;

		try {
			// --- Scroll slot ---
			if (this.pendingScrollFrame) {
				this.pendingScrollFrame = false;
				this.scrollEndQuietCount = 0;
				if (this.scrollFrameHandler) {
					try {
						this.scrollFrameHandler();
					} catch (e) {
						this.onFault?.(`FrameCoordinator: scroll handler threw: ${String(e)}`);
					}
				}
			} else if (this._isScrolling) {
				// No new scroll request arrived — count quiet frames.
				this.scrollEndQuietCount++;
				if (this.scrollEndQuietCount >= this.scrollEndQuietThreshold) {
					this.scrollEndQuietCount = 0;
					this._isScrolling = false;
					try {
						this.scrollEndHandler?.();
					} catch (e) {
						this.onFault?.(`FrameCoordinator: scrollEnd handler threw: ${String(e)}`);
					}
				}
			}

			// --- Paint slot ---
			if (this.pendingPaintFrame) {
				this.pendingPaintFrame = false;
				this.runPaintSlot();
			}

			// --- Post-scroll slot ---
			if (this.pendingPostScroll) {
				if (this.postScrollEpoch !== this.scrollEpoch) {
					// Stale — a newer scroll session has started; drop silently.
					this.pendingPostScroll = false;
				} else if (!this._isScrolling) {
					this.pendingPostScroll = false;
					if (this.postScrollHandler) {
						try {
							this.postScrollHandler();
						} catch (e) {
							this.onFault?.(`FrameCoordinator: postScroll handler threw: ${String(e)}`);
						}
					}
				}
				// If still scrolling and epoch is current, retain the pending flag;
				// the finally block will re-schedule a RAF.
			}
		} finally {
			this.inFlush = false;
			const keepAlive =
				this.pendingScrollFrame ||
				this.pendingPaintFrame ||
				this.pendingPostScroll ||
				this._isScrolling;
			if (keepAlive) this.scheduleRaf();
		}
	}

	private runPaintSlot(): void {
		if (!this.paintFrameHandler) return;
		try {
			this.paintFrameHandler();
		} catch (e) {
			this.onFault?.(`FrameCoordinator: paint handler threw: ${String(e)}`);
		}
	}
}
