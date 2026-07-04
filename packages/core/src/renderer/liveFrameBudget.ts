import type { GridRendererOptions } from '../columnDef.js';

/**
 * Enforces GridRendererOptions.liveReact's maxMountsPerFrame/maxUpdatesPerFrame — previously typed
 * but unenforced. Mount and update are budgeted separately: a mount (portal not yet in the DOM for
 * this cellKey) is more expensive than an update (portal already exists, React just re-renders it),
 * so a grid can allow many updates per frame while still capping fresh mounts.
 *
 * Scope: this budgets scrollPresentation:'live' cells within the NORMAL visible+col-buffer render
 * window — it does not implement GridRendererOptions.liveReact.rowOverscan/columnOverscan (mounting
 * live cells eagerly outside the normal window). That would require expanding which cells the bind
 * loop iterates at all, a larger structural change deliberately deferred — see the follow-up note in
 * viewportPlanner.ts's liveRows/liveCenterColumns doc comment.
 */
export class LiveFrameBudget {
	private maxMountsPerFrame = Infinity;
	private maxUpdatesPerFrame = Infinity;
	private emergencyShellAllowed = true;
	private mountsThisFrame = 0;
	private updatesThisFrame = 0;

	public configure(options: GridRendererOptions['liveReact'] | undefined): void {
		this.maxMountsPerFrame = options?.maxMountsPerFrame ?? Infinity;
		this.maxUpdatesPerFrame = options?.maxUpdatesPerFrame ?? Infinity;
		this.emergencyShellAllowed = options?.allowEmergencyShell ?? true;
	}

	/** Call once per render frame, before any live-mount binding happens this frame. */
	public resetFrame(): void {
		this.mountsThisFrame = 0;
		this.updatesThisFrame = 0;
	}

	/** Returns true if this mount/update may proceed within budget, consuming budget if so. Callers
	 *  must not call this speculatively — a `true` return commits the budget slot. */
	public tryConsume(kind: 'mount' | 'update'): boolean {
		if (kind === 'mount') {
			if (this.mountsThisFrame >= this.maxMountsPerFrame) return false;
			this.mountsThisFrame++;
			return true;
		}
		if (this.updatesThisFrame >= this.maxUpdatesPerFrame) return false;
		this.updatesThisFrame++;
		return true;
	}

	public get allowEmergencyShell(): boolean {
		return this.emergencyShellAllowed;
	}
}
