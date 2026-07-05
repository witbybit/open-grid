import type { GridRendererOptions } from '../columnDef.js';

/**
 * Enforces GridRendererOptions.liveReact's maxMountsPerFrame/maxUpdatesPerFrame.
 * Mount and update are budgeted separately: a mount is more expensive than an update, so a grid can
 * allow many updates per frame while still capping fresh mounts.
 *
 * Scope: this only owns per-frame admission control. ViewportPlanner decides which live cells are
 * visible vs. overscan and orders visible cells ahead of overscan cells; callers consume this budget
 * while applying that plan.
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

	/** Returns true if this mount/update may proceed within budget, consuming budget if so. */
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
