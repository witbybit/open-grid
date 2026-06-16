/**
 * Authoritative render lifecycle phase for the grid renderer.
 *
 * Invariants:
 *   - Exactly one RenderRuntimeState instance exists per mounted renderer.
 *   - Phase transitions must occur through transitionTo(); direct field mutation is forbidden.
 *   - scrollEpoch increments whenever a new scroll session begins (idle->scroll-pending or
 *     post-scroll->scroll-pending). Scheduled post-scroll work captures the epoch at scheduling
 *     time and no-ops when the epoch no longer matches.
 *   - frameEpoch increments on every frame entry (scroll-frame or paint-frame).
 *   - Invalid transitions report a runtime fault in dev/test but do not throw in production.
 */

export type RenderRuntimePhase =
	| 'idle'
	| 'scroll-pending'
	| 'scroll-frame'
	| 'paint-frame'
	| 'post-scroll'
	| 'destroyed';

export interface RenderRuntimeSnapshot {
	phase: RenderRuntimePhase;
	frameEpoch: number;
	scrollEpoch: number;
}

const ALLOWED: Record<RenderRuntimePhase, ReadonlySet<RenderRuntimePhase>> = {
	idle: new Set(['scroll-pending', 'paint-frame', 'destroyed']),
	'scroll-pending': new Set(['scroll-frame', 'destroyed']),
	'scroll-frame': new Set(['post-scroll', 'destroyed']),
	'paint-frame': new Set(['idle', 'destroyed']),
	'post-scroll': new Set(['idle', 'scroll-pending', 'destroyed']),
	destroyed: new Set(),
};

export class RenderRuntimeState {
	private _phase: RenderRuntimePhase = 'idle';
	private _frameEpoch = 0;
	private _scrollEpoch = 0;

	constructor(private readonly _onFault?: (msg: string) => void) {}

	get phase(): RenderRuntimePhase {
		return this._phase;
	}

	get frameEpoch(): number {
		return this._frameEpoch;
	}

	get scrollEpoch(): number {
		return this._scrollEpoch;
	}

	snapshot(): RenderRuntimeSnapshot {
		return { phase: this._phase, frameEpoch: this._frameEpoch, scrollEpoch: this._scrollEpoch };
	}

	transitionTo(next: RenderRuntimePhase): void {
		if (!ALLOWED[this._phase].has(next)) {
			this._onFault?.(`RenderRuntimeState: invalid transition '${this._phase}' -> '${next}'`);
			return;
		}
		// New scroll session: increment scroll epoch so stale post-scroll work is rejected.
		if (next === 'scroll-pending' && this._phase !== 'scroll-pending') {
			this._scrollEpoch++;
		}
		// New frame: increment frame epoch.
		if (next === 'scroll-frame' || next === 'paint-frame') {
			this._frameEpoch++;
		}
		this._phase = next;
	}

	// ─── Derived queries ───────────────────────────────────────────────────────

	isScrolling(): boolean {
		return this._phase === 'scroll-pending' || this._phase === 'scroll-frame' || this._phase === 'post-scroll';
	}

	isFrameActive(): boolean {
		return this._phase === 'scroll-frame' || this._phase === 'paint-frame';
	}

	/** Portals may be synchronously flushed only when no frame is executing and scrolling is idle. */
	canFlushPortals(): boolean {
		return this._phase === 'idle' || this._phase === 'paint-frame';
	}

	/** Post-scroll decoration may run only when scroll has fully completed. */
	canRunDecoration(): boolean {
		return this._phase === 'idle';
	}

	// ─── Epoch validation for stale-work rejection ────────────────────────────

	isScrollEpochCurrent(epoch: number): boolean {
		return this._scrollEpoch === epoch;
	}

	isFrameEpochCurrent(epoch: number): boolean {
		return this._frameEpoch === epoch;
	}
}
