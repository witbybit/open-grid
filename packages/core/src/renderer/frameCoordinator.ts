import { type GridScheduler, defaultGridScheduler } from './gridScheduler.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';

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
	/** Called when a reentrancy violation is detected. Should not throw. */
	onFault?: (msg: string) => void;
	/** Authoritative render lifecycle state. When provided, every paint frame is wrapped in paint-frame phase transitions. */
	runtimeState?: RenderRuntimeState;
}

export class DefaultFrameCoordinator implements FrameCoordinator {
	private paintScheduled = false;
	private scrollScheduled = false;
	private inFrame = false;
	private destroyed = false;
	private readonly gs: GridScheduler;
	private readonly onScrollFrame: () => void;
	private readonly onPaintFrame: () => void;
	private readonly onFault: ((msg: string) => void) | undefined;
	private readonly runtimeState: RenderRuntimeState | undefined;

	constructor(deps: FrameCoordinatorDeps) {
		this.gs = deps.gridScheduler ?? defaultGridScheduler;
		this.onScrollFrame = deps.onScrollFrame;
		this.onPaintFrame = deps.onPaintFrame;
		this.onFault = deps.onFault;
		this.runtimeState = deps.runtimeState;
	}

	requestScrollFrame(): void {
		if (this.destroyed || this.scrollScheduled) return;
		this.scrollScheduled = true;
		this.gs.raf(() => {
			if (this.destroyed) return;
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
			this.gs.raf(() => {
				if (this.destroyed) return;
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
		this.requestPaintFrame();
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
		this.paintScheduled = false;
		this.scrollScheduled = false;
	}
}
