import { type GridScheduler, defaultGridScheduler } from './gridScheduler.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';

/**
 * Single entry point for all renderer frame scheduling.
 *
 * Consumers request work through one of three methods; the coordinator
 * decides how and when to schedule the underlying RAF handles.
 *
 * Priority order within one browser frame: scroll > paint > post-scroll.
 *
 * Every scheduled RAF handle is stored so destroy() can cancel pending work.
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
	private paintScheduled = false;
	private scrollScheduled = false;
	private postScrollScheduled = false;
	private inFrame = false;
	private destroyed = false;
	private scrollRafId: number | null = null;
	private paintRafId: number | null = null;
	private postScrollRafId: number | null = null;
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
		if (this.destroyed || this.scrollScheduled) return;
		this.scrollScheduled = true;
		this.scrollRafId = this.gs.raf(() => {
			if (this.destroyed) return;
			this.scrollRafId = null;
			this.scrollScheduled = false;
			if (this.inFrame) {
				this.onFault?.('FrameCoordinator: reentrant scroll frame detected');
				return;
			}
			this.inFrame = true;
			try {
				this.onScrollFrame();
			} finally {
				this.inFrame = false;
			}
		});
	}

	requestPaintFrame(): void {
		if (this.destroyed || this.paintScheduled) return;
		this.paintScheduled = true;
		this.gs.microtask(() => {
			if (this.destroyed) return;
			this.paintRafId = this.gs.raf(() => {
				if (this.destroyed) return;
				this.paintRafId = null;
				this.paintScheduled = false;
				if (this.inFrame) {
					this.onFault?.('FrameCoordinator: reentrant paint frame detected');
					return;
				}
				this.inFrame = true;
				try {
					this.runPaintFrame();
				} finally {
					this.inFrame = false;
				}
			});
		});
	}

	requestPostScrollWork(): void {
		if (this.destroyed || this.postScrollScheduled) return;
		this.postScrollScheduled = true;
		this.postScrollEpoch = this.runtimeState?.scrollEpoch ?? 0;
		this.postScrollRafId = this.gs.raf(() => {
			if (this.destroyed) return;
			this.postScrollRafId = null;
			this.postScrollScheduled = false;
			const rs = this.runtimeState;
			// Drop if a new scroll session started since this was scheduled.
			if (rs && !rs.isScrollEpochCurrent(this.postScrollEpoch)) return;
			// Drop if scroll or a frame is still active; finishScrolling() will re-request.
			if (rs && (rs.isScrolling() || rs.isFrameActive())) return;
			this.onPostScrollWork();
		});
	}

	flushNowForTests(): void {
		if (this.destroyed) return;
		this.paintScheduled = false;
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
		if (this.scrollRafId !== null) {
			this.gs.cancelRaf(this.scrollRafId);
			this.scrollRafId = null;
		}
		if (this.paintRafId !== null) {
			this.gs.cancelRaf(this.paintRafId);
			this.paintRafId = null;
		}
		if (this.postScrollRafId !== null) {
			this.gs.cancelRaf(this.postScrollRafId);
			this.postScrollRafId = null;
		}
		this.paintScheduled = false;
		this.scrollScheduled = false;
		this.postScrollScheduled = false;
	}
}
