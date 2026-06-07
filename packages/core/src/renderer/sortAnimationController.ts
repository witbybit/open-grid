import type { RowSlot } from './rowSlot.js';

const DURATION = 280;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * FLIP sort animation.
 *
 * Flow:
 *   1. captureSnapshot() — called synchronously when sortModel state changes,
 *      before the render fires. Records rowId → style.top for every visible row.
 *   2. beginAnimation() — called after recycleViewport() writes the new style.top
 *      values. Computes per-row deltas and runs the FLIP sequence:
 *        a. Set transform = translateY(oldTop - newTop)  [invert to old visual pos]
 *        b. getBoundingClientRect()                      [force style commit]
 *        c. Set transition + transform = ''              [play to final pos]
 *      The forced reflow in (b) is essential — without it the browser batches (a)
 *      and (c) into a single operation and skips the animation.
 *   3. cancel() — called on scroll start; snaps all rows to final positions immediately.
 *
 * Why transforms don't break CSS sticky on pin containers:
 *   Sticky positioning resolves its scroll ancestor by walking to the nearest
 *   overflow:scroll/auto/hidden ancestor. A transform on an intermediate .og-row
 *   does NOT create a scroll container, so sticky is unaffected.
 */
export class SortAnimationController<TRowData = unknown> {
	private snapshot = new Map<string, number>(); // rowId → lastTop before sort render
	private animatingElements = new Set<HTMLElement>();
	private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly getActiveRows: () => ReadonlyMap<number, RowSlot<TRowData>>) {}

	// Step 1 — capture current row positions before the sort render runs.
	public captureSnapshot(): void {
		this.cancel(); // snap any in-flight animation so snapshot reads correct tops
		this.snapshot.clear();
		for (const [, slot] of this.getActiveRows()) {
			if (slot.visualRowId && slot.lastTop >= 0) {
				this.snapshot.set(slot.visualRowId, slot.lastTop);
			}
		}
	}

	// Step 2 — drive the FLIP after recycleViewport() has written new style.top values.
	public beginAnimation(): void {
		if (this.snapshot.size === 0) return;

		const movers: Array<{ el: HTMLElement; delta: number }> = [];
		for (const [, slot] of this.getActiveRows()) {
			const oldTop = this.snapshot.get(slot.visualRowId);
			if (oldTop === undefined || slot.lastTop < 0) continue;
			const delta = oldTop - slot.lastTop;
			if (delta === 0) continue;
			movers.push({ el: slot.element, delta });
		}

		this.snapshot.clear();
		if (movers.length === 0) return;

		// (a) Invert: snap every moved row back to its old visual position, no transition.
		for (const { el, delta } of movers) {
			el.style.transition = 'none';
			el.style.transform = `translateY(${delta}px)`;
			el.style.willChange = 'transform';
			this.animatingElements.add(el);
		}

		// (b) Force a synchronous style recalculation so the browser commits the inverted
		//     positions as the "from" state before we start the transition.
		//     Without this read, Chrome/Safari may coalesce the invert+play writes into a
		//     single operation and the animation never plays.
		void movers[0].el.getBoundingClientRect();

		// (c) Play: clear the transform under a transition — browser animates to final pos.
		for (const { el } of movers) {
			el.style.transition = `transform ${DURATION}ms ${EASING}`;
			el.style.transform = '';
		}

		this.cleanupTimer = setTimeout(() => {
			this.cleanupTimer = null;
			this.doCleanup();
		}, DURATION + 50);
	}

	// Immediately snap all animating rows to their final positions.
	public cancel(): void {
		if (this.cleanupTimer !== null) {
			clearTimeout(this.cleanupTimer);
			this.cleanupTimer = null;
		}
		this.doCleanup();
	}

	private doCleanup(): void {
		for (const el of this.animatingElements) {
			el.style.transition = '';
			el.style.transform = '';
			el.style.willChange = '';
		}
		this.animatingElements.clear();
	}

	public destroy(): void {
		this.cancel();
		this.snapshot.clear();
	}
}
