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

export type RenderRuntimePhase = 'idle' | 'scroll-pending' | 'scroll-frame' | 'paint-frame' | 'post-scroll' | 'destroyed';

export interface RenderRuntimeSnapshot {
	phase: RenderRuntimePhase;
	frameEpoch: number;
	scrollEpoch: number;
}

const ALLOWED: Record<RenderRuntimePhase, ReadonlySet<RenderRuntimePhase>> = {
	idle: new Set(['scroll-pending', 'paint-frame', 'destroyed']),
	// idle is allowed from scroll-pending: covers the case where a brief scroll ends
	// before any RAF scroll frame fires (scrollEndTick fires before onScrollFrame runs).
	'scroll-pending': new Set(['scroll-frame', 'idle', 'destroyed']),
	'scroll-frame': new Set(['post-scroll', 'destroyed']),
	'paint-frame': new Set(['idle', 'destroyed']),
	'post-scroll': new Set(['idle', 'scroll-pending', 'destroyed']),
	destroyed: new Set(),
};

export class RenderRuntimeState {
	private _phase: RenderRuntimePhase = 'idle';
	private _frameEpoch = 0;
	private _scrollEpoch = 0;
	private _portalFlushActive = false;

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

	/**
	 * Portals may be synchronously flushed only when idle or within an explicit
	 * portal-commit stage created by withPortalFlushPermission().
	 * The broad paint-frame permission was removed in Plan 095.
	 */
	canFlushPortals(): boolean {
		return this._phase === 'idle' || this._portalFlushActive;
	}

	/**
	 * Execute fn with portal-flush permission granted.  Nested calls report a fault and no-op.
	 * Use this from the paint pipeline's portal-commit stage to bound where React flushSync may run.
	 */
	withPortalFlushPermission(fn: () => void): void {
		if (this._portalFlushActive) {
			this._onFault?.('RenderRuntimeState: nested portal flush detected');
			return;
		}
		this._portalFlushActive = true;
		try {
			fn();
		} finally {
			this._portalFlushActive = false;
		}
	}

	/** Post-scroll decoration may run only when scroll has fully completed. */
	canRunDecoration(): boolean {
		return this._phase === 'idle';
	}

	isDestroyed(): boolean {
		return this._phase === 'destroyed';
	}

	// ─── Epoch validation for stale-work rejection ────────────────────────────

	isScrollEpochCurrent(epoch: number): boolean {
		return this._scrollEpoch === epoch;
	}

	isFrameEpochCurrent(epoch: number): boolean {
		return this._frameEpoch === epoch;
	}
}
