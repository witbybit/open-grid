import type { RowSlot } from './rowSlot.js';

const DURATION = 280;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * LayoutTransitionController (Plan 039) — animates **discrete** layout changes via the
 * Web Animations API (WAAPI). It generalizes the former DOM-snapshot FLIP sort animator
 * into one controller for every animated structural delta: row reorder (sort), row
 * **enter** (expand reveal), and — once the slot exit pool lands — row **exit** (collapse).
 *
 * Why WAAPI instead of inline CSS transitions:
 *  - No forced reflow: `element.animate()` does its own from→to interpolation, so the
 *    old FLIP "set inverse transform, read getBoundingClientRect(), set final" dance is
 *    gone. We keyframe from the captured old transform to the live (already-written)
 *    final transform.
 *  - Per-element handles: every running animation is an `Animation` we can `cancel()`
 *    individually and instantly, which is exactly what the scroll-start path needs.
 *  - Composes with steady-state positioning: rows are positioned by an inline
 *    `transform: translateY(lastTop)`. With `fill: 'none'` the element reverts to that
 *    inline transform when the animation ends — which is the final position — so no
 *    commit step and no stale animation state is left behind.
 *
 * Hot-path guarantee: this controller is ONLY driven from discrete-change hooks
 * (`captureSnapshot` on sort/expansion/etc., `beginAnimation` after the resulting paint).
 * Scroll frames and data-tick frames never call it, and `cancel()` (invoked on scroll
 * start) tears down every live animation. No transition/animation property is ever set
 * on a scroll frame. Feature-detected: where WAAPI is unavailable (jsdom/SSR) or the
 * user prefers reduced motion, changes apply instantly (no animation).
 */
export class LayoutTransitionController<TRowData = unknown> {
	private snapshot = new Map<string, number>(); // rowId → lastTop at capture
	private animations = new Map<HTMLElement, Animation>();

	constructor(private readonly getActiveRows: () => ReadonlyMap<number, RowSlot<TRowData>>) {}

	/** True when WAAPI is usable and the user has not requested reduced motion. */
	private animationsEnabled(): boolean {
		if (typeof document === 'undefined') return false;
		if (typeof (HTMLElement.prototype as { animate?: unknown }).animate !== 'function') return false;
		try {
			if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
				if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
			}
		} catch {
			/* matchMedia may throw in some test envs — treat as no preference */
		}
		return true;
	}

	/**
	 * Step 1 — record current row positions before the structural state change renders.
	 * Called synchronously from the invalidation hook (sortModel/expansion/etc.).
	 */
	public captureSnapshot(): void {
		this.cancel(); // snap any in-flight animation so the snapshot reads true tops
		this.snapshot.clear();
		for (const [, slot] of this.getActiveRows()) {
			if (slot.visualRowId && slot.lastTop >= 0) {
				this.snapshot.set(slot.visualRowId, slot.lastTop);
			}
		}
	}

	/**
	 * Step 2 — after recycleViewport() has written the new inline transforms, play the
	 * transition. Rows present before and after at a different top → **move**; rows that
	 * appeared (no captured top) → **enter** (fade in at their final position). Exit of
	 * removed rows is handled separately via the slot exit pool (their DOM is recycled).
	 */
	public beginAnimation(): void {
		const hadSnapshot = this.snapshot.size > 0;
		if (!this.animationsEnabled()) {
			this.snapshot.clear();
			return;
		}

		for (const [, slot] of this.getActiveRows()) {
			if (slot.lastTop < 0) continue;
			const el = slot.element;
			const oldTop = this.snapshot.get(slot.visualRowId);
			if (oldTop === undefined) {
				// ENTER — only animate reveals that accompany a real structural change, so a
				// first paint (empty snapshot) does not fade every row in.
				if (!hadSnapshot) continue;
				this.run(el, [
					{ transform: `translateY(${slot.lastTop}px)`, opacity: 0 },
					{ transform: `translateY(${slot.lastTop}px)`, opacity: 1 },
				]);
			} else if (oldTop !== slot.lastTop) {
				// MOVE — keyframe from the old top to the live (already-written) new top.
				this.run(el, [{ transform: `translateY(${oldTop}px)` }, { transform: `translateY(${slot.lastTop}px)` }]);
			}
		}

		this.snapshot.clear();
	}

	private run(el: HTMLElement, keyframes: Keyframe[]): void {
		const existing = this.animations.get(el);
		if (existing) existing.cancel();
		const anim = (el as unknown as { animate: (k: Keyframe[], o: KeyframeAnimationOptions) => Animation }).animate(keyframes, {
			duration: DURATION,
			easing: EASING,
			fill: 'none',
		});
		this.animations.set(el, anim);
		const done = () => {
			if (this.animations.get(el) === anim) this.animations.delete(el);
		};
		anim.onfinish = done;
		anim.oncancel = done;
	}

	/** Immediately tear down all in-flight animations; elements revert to inline transforms. */
	public cancel(): void {
		for (const anim of this.animations.values()) {
			anim.cancel();
		}
		this.animations.clear();
	}

	public destroy(): void {
		this.cancel();
		this.snapshot.clear();
	}
}
