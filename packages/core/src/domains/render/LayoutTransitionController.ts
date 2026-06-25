/**
 * WAAPI-based layout transition controller.
 *
 * When rows are added, removed, or reordered the grid's DOM slots jump instantly.
 * This controller intercepts the "before paint" snapshot and the "after paint"
 * snapshot, then uses the Web Animations API to smoothly interpolate each row slot
 * from its old position to its new position (FLIP technique).
 *
 * Usage:
 *   1. Call `snapshot()` before the DOM update
 *   2. Update the DOM (slot positions change)
 *   3. Call `animate()` after the DOM update
 */

export interface TransitionOptions {
	/** Duration of position animations in milliseconds (default 220). */
	duration?: number;
	/** CSS easing function (default 'cubic-bezier(0.4, 0, 0.2, 1)'). */
	easing?: string;
	/** If true, fade in newly added rows (default true). */
	animateNewRows?: boolean;
	/** If true, fade out removed rows (default true). */
	animateRemovedRows?: boolean;
}

interface SlotSnapshot {
	top: number;
	height: number;
}

export class LayoutTransitionController {
	private snapshots = new Map<string, SlotSnapshot>();
	private runningAnimations: Animation[] = [];

	constructor(private readonly opts: TransitionOptions = {}) {}

	/**
	 * Capture current positions of all row slots before the DOM update.
	 * Call with the slot elements keyed by their stable visual row ID.
	 */
	snapshot(slots: ReadonlyMap<string, HTMLElement>): void {
		this.snapshots.clear();
		for (const [id, el] of slots) {
			const rect = el.getBoundingClientRect();
			this.snapshots.set(id, { top: rect.top, height: rect.height });
		}
	}

	/**
	 * Animate slots from their old positions (captured via snapshot()) to their new positions.
	 * Call after the DOM update has been applied.
	 *
	 * @param slots Current slot elements (same key = visual row ID)
	 * @param newIds IDs of freshly added rows (will fade in)
	 * @param removedEls Elements of removed rows still temporarily in the DOM (will fade out + remove)
	 */
	animate(
		slots: ReadonlyMap<string, HTMLElement>,
		newIds: ReadonlySet<string> = new Set(),
		removedEls: ReadonlyMap<string, HTMLElement> = new Map(),
	): void {
		const {
			duration = 220,
			easing = 'cubic-bezier(0.4, 0, 0.2, 1)',
			animateNewRows = true,
			animateRemovedRows = true,
		} = this.opts;

		// Cancel any running animations before starting new ones
		for (const anim of this.runningAnimations) {
			try { anim.cancel(); } catch {}
		}
		this.runningAnimations = [];

		// FLIP: animate each slot from its old position to its new position
		for (const [id, el] of slots) {
			const before = this.snapshots.get(id);
			const after = el.getBoundingClientRect();

			if (before && !newIds.has(id)) {
				const dy = before.top - after.top;
				if (Math.abs(dy) > 0.5) {
					const anim = el.animate(
						[{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
						{ duration, easing, fill: 'none' },
					);
					this.runningAnimations.push(anim);
				}
			}

			// Fade in new rows
			if (animateNewRows && newIds.has(id)) {
				const anim = el.animate(
					[{ opacity: '0', transform: 'translateY(4px)' }, { opacity: '1', transform: 'translateY(0)' }],
					{ duration, easing, fill: 'none' },
				);
				this.runningAnimations.push(anim);
			}
		}

		// Fade out removed rows, then remove from DOM
		if (animateRemovedRows) {
			for (const [, el] of removedEls) {
				const anim = el.animate(
					[{ opacity: '1', transform: 'translateY(0)' }, { opacity: '0', transform: 'translateY(-4px)' }],
					{ duration: duration * 0.7, easing, fill: 'forwards' },
				);
				this.runningAnimations.push(anim);
				anim.onfinish = () => { el.remove(); };
			}
		} else {
			for (const [, el] of removedEls) el.remove();
		}

		this.snapshots.clear();
	}

	/** Cancel all running animations immediately. */
	cancel(): void {
		for (const anim of this.runningAnimations) {
			try { anim.cancel(); } catch {}
		}
		this.runningAnimations = [];
	}

	destroy(): void {
		this.cancel();
	}
}
