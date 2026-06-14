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
export interface LayoutTransitionOptions {
	/** The `.og-layer-exiting` overlay that holds fade-out ghosts (Plan 043). */
	getExitLayer?: () => HTMLElement | null;
	/** True when a rowId still exists in the visual model — used to tell a true exit
	 *  (row removed, e.g. collapsed) from a row that merely scrolled out of the window. */
	isRowIdLive?: (rowId: string) => boolean;
	/** The grid root element — used by the column-pin transition (Plan 044) to enumerate
	 *  visible header/body cells for the clone-and-swap FLIP. */
	getGridRoot?: () => HTMLElement | null;
	/** Plan 044 is opt-in until the pin geometry/recycler contracts are fully browser-proven. */
	enableColumnPinTransition?: boolean;
}

interface SnapshotEntry {
	top: number;
	/** Row height at capture — used to height-shrink an exiting detail row's ghost. */
	height: number;
	/** Row kind at capture — detail rows get a height grow/shrink instead of a plain fade. */
	kind: string;
	/** Deep clone of the row element at capture, used as a fade-out ghost if it exits. */
	clone: HTMLElement;
}

export class LayoutTransitionController<TRowData = unknown> {
	private snapshot = new Map<string, SnapshotEntry>(); // rowId → {top, clone} at capture
	private animations = new Map<HTMLElement, Animation>();
	private exitGhosts = new Set<HTMLElement>();

	// Column-pin transition (Plan 044). Keyed by a stable cell identity (data-* derived) so
	// the snapshot survives the relayout's slot recycling. Each entry is the cell's screen
	// rect BEFORE the pin relayout; beginColumnPin diffs against the post-relayout rect.
	private pinSnapshot = new Map<string, { left: number; top: number; width: number; height: number }>();
	private pinClones = new Set<HTMLElement>();
	private pinHiddenReals = new Set<HTMLElement>();
	private pinOverlay: HTMLElement | null = null;

	constructor(
		private readonly getActiveRows: () => ReadonlyMap<number, RowSlot<TRowData>>,
		private readonly options: LayoutTransitionOptions = {}
	) {}

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
		this.cancel(); // snap any in-flight animation + clear ghosts so the snapshot is clean
		this.snapshot.clear();
		const canExit = !!this.options.getExitLayer && this.animationsEnabled();
		for (const [, slot] of this.getActiveRows()) {
			if (slot.visualRowId && slot.lastTop >= 0) {
				// Clone now (before recycleViewport reuses the element) so a row that turns out
				// to have left the model can fade out as a static ghost. Cheap + off the hot
				// path (capture only runs on discrete actions). Skipped when exits can't render.
				const clone = canExit ? (slot.element.cloneNode(true) as HTMLElement) : (null as unknown as HTMLElement);
				this.snapshot.set(slot.visualRowId, { top: slot.lastTop, height: slot.lastHeight, kind: slot.rowKind, clone });
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

		const activeRowIds = new Set<string>();
		for (const [, slot] of this.getActiveRows()) {
			if (slot.lastTop < 0) continue;
			if (slot.visualRowId) activeRowIds.add(slot.visualRowId);
			const el = slot.element;
			const entry = this.snapshot.get(slot.visualRowId);
			if (entry === undefined) {
				// ENTER — only animate reveals that accompany a real structural change, so a
				// first paint (empty snapshot) does not fade every row in.
				if (!hadSnapshot) continue;
				if (slot.rowKind === 'detail' && slot.lastHeight > 0) {
					// Detail rows grow from 0 → full height (content clipped) so the rows below —
					// which slide down by the same amount via MOVE — stay glued to the detail's
					// growing bottom edge. Restore overflow when the animation settles.
					const finalHeight = slot.lastHeight;
					const prevOverflow = el.style.overflow;
					el.style.overflow = 'hidden';
					this.run(
						el,
						[
							{ height: '0px', opacity: 0 },
							{ height: `${finalHeight}px`, opacity: 1 },
						],
						() => {
							el.style.overflow = prevOverflow;
						}
					);
				} else {
					this.run(el, [
						{ transform: `translateY(${slot.lastTop}px)`, opacity: 0 },
						{ transform: `translateY(${slot.lastTop}px)`, opacity: 1 },
					]);
				}
			} else if (entry.top !== slot.lastTop) {
				// MOVE — keyframe from the old top to the live (already-written) new top.
				this.run(el, [{ transform: `translateY(${entry.top}px)` }, { transform: `translateY(${slot.lastTop}px)` }]);
			}
		}

		// EXIT — a captured row that is no longer rendered AND no longer in the model truly
		// left (e.g. a collapsed group's children). Fade out its ghost clone in place. Rows
		// that merely scrolled out of the window (still live in the model) are not faded.
		this.playExits(activeRowIds);

		this.snapshot.clear();
	}

	private playExits(activeRowIds: Set<string>): void {
		const exitLayer = this.options.getExitLayer?.();
		const isLive = this.options.isRowIdLive;
		if (!exitLayer) return;
		for (const [rowId, entry] of this.snapshot) {
			if (!entry.clone) continue;
			if (activeRowIds.has(rowId)) continue; // still rendered → moved/stayed, not exiting
			if (isLive && isLive(rowId)) continue; // still in the model → scrolled out, not removed
			const ghost = entry.clone;
			ghost.style.transition = 'none';
			ghost.style.pointerEvents = 'none';
			ghost.style.transform = `translateY(${entry.top}px)`;
			exitLayer.appendChild(ghost);
			this.exitGhosts.add(ghost);
			// Detail rows collapse by shrinking their height to 0 (content clipped) while
			// fading — the rows below slide up by the same amount via MOVE, so the ghost's
			// bottom edge stays glued to them. Other rows just fade out in place.
			const keyframes: Keyframe[] =
				entry.kind === 'detail' && entry.height > 0
					? [
							{ height: `${entry.height}px`, opacity: 1 },
							{ height: '0px', opacity: 0 },
						]
					: [{ opacity: 1 }, { opacity: 0 }];
			if (entry.kind === 'detail') {
				ghost.style.overflow = 'hidden';
				ghost.style.willChange = 'height, opacity';
			} else {
				ghost.style.willChange = 'opacity';
			}
			const anim = (ghost as unknown as { animate: (k: Keyframe[], o: KeyframeAnimationOptions) => Animation }).animate(keyframes, {
				duration: DURATION,
				easing: EASING,
				fill: 'forwards',
			});
			const done = () => this.removeGhost(ghost);
			anim.onfinish = done;
			anim.oncancel = done;
		}
	}

	private removeGhost(ghost: HTMLElement): void {
		if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
		this.exitGhosts.delete(ghost);
	}

	// ── Column pin transition (Plan 044) — clone-and-swap FLIP ─────────────────────
	//
	// Pin/unpin reparents a column's cells between the center lane and a `position: sticky`
	// pinned lane. Animating a transform on a cell as it reparents into a sticky lane fights
	// the compositor, so instead of moving the real cells we move CLONES over a fixed overlay
	// (the real cell jumps to its final spot instantly but is hidden while its clone travels).
	// The sticky cells are never transformed. Capture before the relayout, play after.

	/** Enumerate the rendered (visible-window) header + body cells, keyed by a stable
	 *  data-* identity so the same logical cell matches across the relayout's recycling. */
	private _pinCells(root: HTMLElement): Array<{ key: string; el: HTMLElement }> {
		const out: Array<{ key: string; el: HTMLElement }> = [];
		root.querySelectorAll<HTMLElement>('.og-header-cell[data-col-field]').forEach((el) => {
			out.push({ key: `h:${el.dataset.colField}`, el });
		});
		root.querySelectorAll<HTMLElement>('.og-cell[data-col-field][data-row-id]').forEach((el) => {
			out.push({ key: `b:${el.dataset.rowId}:${el.dataset.colField}`, el });
		});
		return out;
	}

	public isColumnPinTransitionEnabled(): boolean {
		return this.options.enableColumnPinTransition === true;
	}

	/** Step 1 — record each visible cell's screen rect before the pin relayout. */
	public capturePinSnapshot(): void {
		this.clearPinClones();
		this.pinSnapshot.clear();
		if (!this.isColumnPinTransitionEnabled()) return;
		if (!this.animationsEnabled()) return;
		const root = this.options.getGridRoot?.();
		if (!root) return;
		for (const { key, el } of this._pinCells(root)) {
			const r = el.getBoundingClientRect();
			this.pinSnapshot.set(key, { left: r.left, top: r.top, width: r.width, height: r.height });
		}
	}

	/** Step 2 — after the pin relayout, clone every cell whose x changed and glide the clone
	 *  from its old screen position to the new one; the real (sticky) cell is hidden meanwhile. */
	public beginColumnPin(): void {
		if (!this.isColumnPinTransitionEnabled()) {
			this.pinSnapshot.clear();
			return;
		}
		if (this.pinSnapshot.size === 0) return;
		const root = this.options.getGridRoot?.();
		if (!this.animationsEnabled() || !root) {
			this.pinSnapshot.clear();
			return;
		}
		const overlay = this._ensurePinOverlay();
		if (!overlay) {
			this.pinSnapshot.clear();
			return;
		}
		for (const { key, el } of this._pinCells(root)) {
			const from = this.pinSnapshot.get(key);
			if (!from) continue;
			const to = el.getBoundingClientRect();
			const dx = to.left - from.left;
			const dy = to.top - from.top;
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue; // didn't move

			const clone = el.cloneNode(true) as HTMLElement;
			clone.style.position = 'fixed';
			clone.style.left = `${from.left}px`;
			clone.style.top = `${from.top}px`;
			clone.style.width = `${from.width}px`;
			clone.style.height = `${from.height}px`;
			clone.style.margin = '0';
			clone.style.pointerEvents = 'none';
			clone.style.visibility = 'visible';
			overlay.appendChild(clone);
			this.pinClones.add(clone);

			// Hide the real cell (now at its final position) so only the clone is seen moving.
			(el as unknown as { __pinPrevVis?: string }).__pinPrevVis = el.style.visibility;
			el.style.visibility = 'hidden';
			this.pinHiddenReals.add(el);

			const anim = (clone as unknown as { animate: (k: Keyframe[], o: KeyframeAnimationOptions) => Animation }).animate(
				[{ transform: 'translate(0px, 0px)' }, { transform: `translate(${dx}px, ${dy}px)` }],
				{ duration: DURATION, easing: EASING, fill: 'forwards' }
			);
			const done = () => {
				this._restoreReal(el);
				this._removePinClone(clone);
			};
			anim.onfinish = done;
			anim.oncancel = done;
		}
		this.pinSnapshot.clear();
	}

	private _ensurePinOverlay(): HTMLElement | null {
		if (typeof document === 'undefined') return null;
		if (this.pinOverlay && this.pinOverlay.isConnected) return this.pinOverlay;
		const el = document.createElement('div');
		el.className = 'og-layer-pin-anim';
		el.style.position = 'fixed';
		el.style.inset = '0';
		el.style.overflow = 'hidden';
		el.style.pointerEvents = 'none';
		el.style.zIndex = '40';
		document.body.appendChild(el);
		this.pinOverlay = el;
		return el;
	}

	private _restoreReal(el: HTMLElement): void {
		if (!this.pinHiddenReals.has(el)) return;
		const holder = el as unknown as { __pinPrevVis?: string };
		el.style.visibility = holder.__pinPrevVis ?? '';
		delete holder.__pinPrevVis;
		this.pinHiddenReals.delete(el);
	}

	private _removePinClone(clone: HTMLElement): void {
		if (clone.parentNode) clone.parentNode.removeChild(clone);
		this.pinClones.delete(clone);
	}

	/** Tear down all pin clones + restore hidden cells. Called on capture, scroll-start, destroy. */
	private clearPinClones(): void {
		for (const el of Array.from(this.pinHiddenReals)) this._restoreReal(el);
		for (const clone of Array.from(this.pinClones)) this._removePinClone(clone);
	}

	private run(el: HTMLElement, keyframes: Keyframe[], onSettle?: () => void): void {
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
			onSettle?.();
		};
		anim.onfinish = done;
		anim.oncancel = done;
	}

	/** Immediately tear down all in-flight animations + exit ghosts; live elements revert
	 *  to their inline transforms. Invoked on scroll start so nothing survives a scroll frame. */
	public cancel(): void {
		for (const anim of this.animations.values()) {
			anim.cancel();
		}
		this.animations.clear();
		for (const ghost of this.exitGhosts) {
			if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
		}
		this.exitGhosts.clear();
		// Column-pin clones must not survive a scroll frame either.
		this.clearPinClones();
		this.pinSnapshot.clear();
	}

	public destroy(): void {
		this.cancel();
		this.snapshot.clear();
		if (this.pinOverlay && this.pinOverlay.parentNode) this.pinOverlay.parentNode.removeChild(this.pinOverlay);
		this.pinOverlay = null;
	}
}
