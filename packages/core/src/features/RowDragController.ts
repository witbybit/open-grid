import type { GridEngine } from '../engine/GridEngine.js';
import { GridEventName } from '../api/GridEvents.js';
import type { RowOrderCapableModel } from '../rowModel.js';

interface DragState {
	pointerId: number;
	rowId: string;
	visualIndex: number;
	startClientY: number;
	grabOffsetY: number;
	rowHeight: number;
	activated: boolean;
	ghost: HTMLDivElement | null;
	lastOverRowId: string | null;
	lastOverVisualIndex: number | null;
}

/** px from viewport edge at which auto-scroll kicks in */
const SCROLL_EDGE_PX = 50;
/** max scroll px per frame */
const SCROLL_MAX_PX = 14;
/** minimum movement before drag activates (prevents accidental drags on clicks) */
const DRAG_THRESHOLD_PX = 4;

export class RowDragController<TRowData = unknown> {
	private drag: DragState | null = null;
	private dropIndicator: HTMLDivElement | null = null;
	private scrollAnimFrame: number | null = null;
	private container: HTMLElement | null = null;
	private scrollViewport: HTMLElement | null = null;

	constructor(private readonly engine: GridEngine<TRowData>) {}

	private getRowOrderCapableRowModel(): RowOrderCapableModel | null {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return null;
		const candidate = rowModel as unknown as Partial<RowOrderCapableModel>;
		if (typeof candidate.setRowOrder !== 'function' || typeof candidate.getRowOrder !== 'function') {
			return null;
		}
		return rowModel as unknown as RowOrderCapableModel;
	}

	public mount(container: HTMLElement, scrollViewport: HTMLElement): void {
		this.container = container;
		this.scrollViewport = scrollViewport;
		container.addEventListener('pointerdown', this.onPointerDown);
		document.addEventListener('keydown', this.onKeyDown);
	}

	public unmount(): void {
		if (this.container) {
			this.container.removeEventListener('pointerdown', this.onPointerDown);
		}
		document.removeEventListener('keydown', this.onKeyDown);
		this.detachDocListeners();
		this.cancel();
		this.container = null;
		this.scrollViewport = null;
	}

	private detachDocListeners(): void {
		document.removeEventListener('pointermove', this.onPointerMove);
		document.removeEventListener('pointerup', this.onPointerUp);
		document.removeEventListener('pointercancel', this.onPointerCancel);
	}

	// ── Event handlers ──────────────────────────────────────────────────────────

	private onPointerDown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		const handle = (e.target as Element).closest('[data-drag-row-id]') as HTMLElement | null;
		if (!handle) return;

		const rowId = handle.dataset.dragRowId;
		if (!rowId) return;

		const rowModel = this.engine.getRowModel();
		const visualIndex = rowModel?.getVisualIndexByRowId(rowId) ?? -1;
		if (visualIndex < 0) return;

		const state = this.engine.stateManager.getState();
		const defaultH = state.defaultRowHeight ?? 36;
		const rowHeight = this.engine.geometry.getRowHeight(visualIndex, defaultH);

		// Measure where in the row the user grabbed
		const cellEl = this.container?.querySelector(`[data-row-id="${rowId}"]`) as HTMLElement | null;
		const rowEl = cellEl?.closest('.og-row') as HTMLElement | null;
		const rowRect = rowEl?.getBoundingClientRect() ?? { top: e.clientY, height: rowHeight };
		const grabOffsetY = Math.max(0, Math.min(rowHeight, e.clientY - rowRect.top));

		this.drag = {
			pointerId: e.pointerId,
			rowId,
			visualIndex,
			startClientY: e.clientY,
			grabOffsetY,
			rowHeight,
			activated: false,
			ghost: null,
			lastOverRowId: null,
			lastOverVisualIndex: null,
		};

		document.addEventListener('pointermove', this.onPointerMove);
		document.addEventListener('pointerup', this.onPointerUp);
		document.addEventListener('pointercancel', this.onPointerCancel);
	};

	private onPointerMove = (e: PointerEvent): void => {
		if (!this.drag || e.pointerId !== this.drag.pointerId) return;

		if (!this.drag.activated) {
			const dy = Math.abs(e.clientY - this.drag.startClientY);
			if (dy < DRAG_THRESHOLD_PX) return;
			this.activateDrag();
		}

		this.moveGhost(e.clientY);
		this.refreshDraggedRowClass();

		const { rowId: overRowId, visualIndex: overVisualIndex } = this.getRowAt(e.clientX, e.clientY);
		if (overRowId !== this.drag.lastOverRowId) {
			this.drag.lastOverRowId = overRowId;
			this.drag.lastOverVisualIndex = overVisualIndex;
			this.engine.eventBus.dispatchEvent(GridEventName.rowDragMove, {
				rowId: this.drag.rowId,
				overRowId,
				overVisualIndex,
			});
		}

		this.updateDropIndicator(e.clientY, overVisualIndex);
		this.updateAutoScroll(e.clientY);
	};

	private onPointerUp = (e: PointerEvent): void => {
		if (!this.drag || e.pointerId !== this.drag.pointerId) return;
		this.detachDocListeners();

		if (!this.drag.activated) {
			this.drag = null;
			return;
		}

		const { rowId: overRowId, visualIndex: overVisualIndex } = this.getRowAt(e.clientX, e.clientY);
		this.commit(overRowId, overVisualIndex);
	};

	private onPointerCancel = (e: PointerEvent): void => {
		if (!this.drag || e.pointerId !== this.drag.pointerId) return;
		this.detachDocListeners();
		this.cancel();
	};

	private onKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && this.drag?.activated) {
			const { rowId } = this.drag;
			this.detachDocListeners();
			this.cleanup();
			this.engine.eventBus.dispatchEvent(GridEventName.rowDragCancelled, { rowId });
		}
	};

	// ── Drag activation ─────────────────────────────────────────────────────────

	private activateDrag(): void {
		if (!this.drag) return;
		this.drag.activated = true;
		this.container?.classList.add('og-row-dragging');
		this.createGhost();
		this.engine.eventBus.dispatchEvent(GridEventName.rowDragStart, {
			rowId: this.drag.rowId,
			rowData: this.engine.getRowModel()?.getRawRowById(this.drag.rowId) ?? null,
			visualIndex: this.drag.visualIndex,
		});
	}

	// ── Ghost ──────────────────────────────────────────────────────────────────

	private createGhost(): void {
		if (!this.drag || !this.scrollViewport) return;

		const vpRect = this.scrollViewport.getBoundingClientRect();
		const ghost = document.createElement('div');
		ghost.className = 'og-drag-ghost';
		ghost.style.width = `${vpRect.width}px`;
		ghost.style.height = `${this.drag.rowHeight}px`;
		ghost.style.left = `${vpRect.left}px`;
		ghost.style.top = `${this.drag.startClientY - this.drag.grabOffsetY}px`;

		// Clone the actual row for visual fidelity
		const cellEl = this.container?.querySelector(`[data-row-id="${this.drag.rowId}"]`) as HTMLElement | null;
		const rowEl = cellEl?.closest('.og-row') as HTMLElement | null;
		if (rowEl) {
			const clone = rowEl.cloneNode(true) as HTMLElement;
			// Strip the row's scroll-position transform so the clone sits at 0,0 inside the ghost
			clone.style.transform = 'none';
			clone.style.position = 'relative';
			clone.style.top = '0';
			clone.style.left = '0';
			clone.style.width = '100%';
			clone.style.height = '100%';
			ghost.appendChild(clone);
		}

		document.body.appendChild(ghost);
		this.drag.ghost = ghost;
	}

	private moveGhost(clientY: number): void {
		if (!this.drag?.ghost || !this.scrollViewport) return;
		const vpRect = this.scrollViewport.getBoundingClientRect();
		const top = Math.max(vpRect.top, Math.min(vpRect.bottom - this.drag.rowHeight, clientY - this.drag.grabOffsetY));
		this.drag.ghost.style.top = `${top}px`;
	}

	private removeGhost(): void {
		if (this.drag?.ghost) {
			this.drag.ghost.remove();
			this.drag.ghost = null;
		}
	}

	// ── Dragged-row visual ─────────────────────────────────────────────────────

	private refreshDraggedRowClass(): void {
		if (!this.drag || !this.container) return;
		const existing = this.container.querySelector('.og-row-being-dragged') as HTMLElement | null;
		const existingRowId = (existing?.querySelector('[data-row-id]') as HTMLElement | null)?.dataset.rowId;
		if (existingRowId === this.drag.rowId) return;

		existing?.classList.remove('og-row-being-dragged');
		const cellEl = this.container.querySelector(`[data-row-id="${this.drag.rowId}"]`) as HTMLElement | null;
		const rowEl = cellEl?.closest('.og-row') as HTMLElement | null;
		rowEl?.classList.add('og-row-being-dragged');
	}

	private clearDraggedRowClass(): void {
		const el = this.container?.querySelector('.og-row-being-dragged') as HTMLElement | null;
		el?.classList.remove('og-row-being-dragged');
	}

	// ── Commit ─────────────────────────────────────────────────────────────────

	private commit(overRowId: string | null, overVisualIndex: number | null): void {
		if (!this.drag) return;
		const { rowId, visualIndex: fromVi } = this.drag;

		this.engine.eventBus.dispatchEvent(GridEventName.rowDragEnd, { rowId, overRowId, overVisualIndex });

		const state = this.engine.stateManager.getState();
		const mode = state.rowDragMode ?? 'managed';

		if (mode === 'managed' && overVisualIndex !== null && overVisualIndex !== fromVi) {
			const rowModel = this.getRowOrderCapableRowModel();
			if (rowModel) {
				// Snapshot BEFORE any state changes for FLIP
				const before = this.snapshotRowPositions();

				// Sorting overrides source order — clear first so the drag order is preserved
				if (state.sortModel) this.engine.setSortModel(null, false);

				const currentOrder = rowModel.getRowOrder();
				const fromIdx = currentOrder.indexOf(rowId);

				if (fromIdx !== -1) {
					const without = currentOrder.filter((id) => id !== rowId);
					let insertAt = without.length;
					if (overRowId) {
						const pos = without.indexOf(overRowId);
						if (pos !== -1) insertAt = pos;
					}
					const newOrder = [...without.slice(0, insertAt), rowId, ...without.slice(insertAt)];

					// Tear down drag visuals BEFORE setRowOrder so the FLIP snapshot is clean
					this.clearDraggedRowClass();
					this.removeGhost();
					this.removeDropIndicator();
					this.stopAutoScroll();
					this.container?.classList.remove('og-row-dragging');
					this.drag = null;

					this.engine.setRowOrder(newOrder);
					this.playFlipAnimation(before);
					return;
				}
			}
		}

		this.cleanup();
	}

	private cancel(): void {
		if (!this.drag) return;
		const { rowId, activated } = this.drag;
		this.cleanup();
		if (activated) {
			this.engine.eventBus.dispatchEvent(GridEventName.rowDragCancelled, { rowId });
		}
	}

	private cleanup(): void {
		this.clearDraggedRowClass();
		this.removeGhost();
		this.removeDropIndicator();
		this.stopAutoScroll();
		this.container?.classList.remove('og-row-dragging');
		this.drag = null;
	}

	// ── FLIP animation ─────────────────────────────────────────────────────────

	private snapshotRowPositions(): Map<string, number> {
		const snap = new Map<string, number>();
		if (!this.container) return snap;
		for (const row of this.container.querySelectorAll('.og-row')) {
			const rowId = (row.querySelector('[data-row-id]') as HTMLElement | null)?.dataset.rowId;
			if (rowId) snap.set(rowId, (row as HTMLElement).getBoundingClientRect().top);
		}
		return snap;
	}

	private playFlipAnimation(before: Map<string, number>): void {
		const container = this.container;
		if (!container) return;
		// Interaction-only row-reorder animation staging: this is not grid render scheduling.
		// Double RAF: first frame the renderer re-positions rows, second frame DOM is settled.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				for (const row of container.querySelectorAll('.og-row')) {
					const rowId = (row.querySelector('[data-row-id]') as HTMLElement | null)?.dataset.rowId;
					if (!rowId) continue;
					const prevTop = before.get(rowId);
					if (prevTop === undefined) continue;
					const newTop = (row as HTMLElement).getBoundingClientRect().top;
					const delta = prevTop - newTop;
					if (Math.abs(delta) < 1) continue;
					// composite:'add' layers the animation offset on top of the row's existing translateY
					// so the row starts visually at its old position and slides to its new position.
					(row as HTMLElement).animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0px)' }], {
						duration: 220,
						easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
						fill: 'none',
						composite: 'add',
					});
				}
			})
		);
	}

	// ── Drop indicator ──────────────────────────────────────────────────────────

	private updateDropIndicator(clientY: number, overVisualIndex: number | null): void {
		if (!this.container) return;

		let indicator = this.dropIndicator;
		if (!indicator) {
			indicator = document.createElement('div');
			indicator.className = 'og-row-drop-indicator';
			this.container.appendChild(indicator);
			this.dropIndicator = indicator;
		}

		if (overVisualIndex === null) {
			indicator.style.display = 'none';
			return;
		}

		const state = this.engine.stateManager.getState();
		const scrollViewport = this.scrollViewport;
		if (!scrollViewport) return;

		const rowModel = this.engine.getRowModel();
		const vr = rowModel?.getVisualRow(overVisualIndex);
		if (!vr) return;

		const defaultH = state.defaultRowHeight ?? 36;
		const rowTop = this.engine.geometry.getRowTop(overVisualIndex, defaultH);
		const rowH = this.engine.geometry.getRowHeight(overVisualIndex, defaultH);
		const scrollTop = scrollViewport.scrollTop;
		const vpRect = scrollViewport.getBoundingClientRect();
		const containerRect = this.container.getBoundingClientRect();

		const rowMidAbsolute = vpRect.top + (rowTop + rowH / 2 - scrollTop);
		const snapBelow = clientY > rowMidAbsolute;

		const indicatorScrollY = snapBelow ? rowTop + rowH : rowTop;
		const indicatorAbsoluteY = vpRect.top - containerRect.top + indicatorScrollY - scrollTop;

		indicator.style.display = '';
		indicator.style.top = `${Math.round(indicatorAbsoluteY)}px`;
	}

	private removeDropIndicator(): void {
		if (this.dropIndicator) {
			this.dropIndicator.remove();
			this.dropIndicator = null;
		}
	}

	// ── Auto-scroll ─────────────────────────────────────────────────────────────

	private updateAutoScroll(clientY: number): void {
		const vp = this.scrollViewport;
		if (!vp) return;
		const rect = vp.getBoundingClientRect();
		const distFromTop = clientY - rect.top;
		const distFromBottom = rect.bottom - clientY;

		if (distFromTop < SCROLL_EDGE_PX) {
			this.startAutoScroll(-SCROLL_MAX_PX * (1 - distFromTop / SCROLL_EDGE_PX));
		} else if (distFromBottom < SCROLL_EDGE_PX) {
			this.startAutoScroll(SCROLL_MAX_PX * (1 - distFromBottom / SCROLL_EDGE_PX));
		} else {
			this.stopAutoScroll();
		}
	}

	private startAutoScroll(rate: number): void {
		this.stopAutoScroll();
		// Interaction-only drag auto-scroll loop: this is user-driven pointer behavior, not grid rendering.
		const scroll = (): void => {
			if (!this.drag || !this.scrollViewport) return;
			this.scrollViewport.scrollTop += rate;
			this.scrollAnimFrame = requestAnimationFrame(scroll);
		};
		this.scrollAnimFrame = requestAnimationFrame(scroll);
	}

	private stopAutoScroll(): void {
		if (this.scrollAnimFrame !== null) {
			cancelAnimationFrame(this.scrollAnimFrame);
			this.scrollAnimFrame = null;
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────────────────

	private getRowAt(clientX: number, clientY: number): { rowId: string | null; visualIndex: number | null } {
		const el = document.elementFromPoint(clientX, clientY);
		if (!el) return { rowId: null, visualIndex: null };
		const rowEl = el.closest('.og-row') as HTMLElement | null;
		if (!rowEl) return { rowId: null, visualIndex: null };
		const cellEl = rowEl.querySelector('[data-row-id]') as HTMLElement | null;
		const rowId = cellEl?.dataset.rowId ?? null;
		if (!rowId) return { rowId: null, visualIndex: null };
		const rowModel = this.engine.getRowModel();
		const vi = rowModel?.getVisualIndexByRowId(rowId);
		const visualIndex = vi !== undefined && vi >= 0 ? vi : null;
		return { rowId, visualIndex };
	}
}
