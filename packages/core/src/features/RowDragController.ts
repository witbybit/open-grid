import type { GridEngine } from '../engine/GridEngine.js';
import { GridEventName } from '../api/GridEvents.js';

interface DragState {
	rowId: string;
	visualIndex: number;
	lastOverRowId: string | null;
	lastOverVisualIndex: number | null;
}

/** px from top/bottom edge at which auto-scroll kicks in */
const SCROLL_EDGE_PX = 50;
/** max scroll speed in px/frame */
const SCROLL_MAX_PX = 14;

export class RowDragController<TRowData = unknown> {
	private drag: DragState | null = null;
	private dropIndicator: HTMLDivElement | null = null;
	private scrollAnimFrame: number | null = null;
	private container: HTMLElement | null = null;
	private scrollViewport: HTMLElement | null = null;

	constructor(private readonly engine: GridEngine<TRowData>) {}

	public mount(container: HTMLElement, scrollViewport: HTMLElement): void {
		this.container = container;
		this.scrollViewport = scrollViewport;
		container.addEventListener('dragstart', this.onDragStart);
		container.addEventListener('dragover', this.onDragOver);
		container.addEventListener('dragleave', this.onDragLeave);
		container.addEventListener('dragend', this.onDragEnd);
		container.addEventListener('drop', this.onDrop);
		document.addEventListener('keydown', this.onKeyDown);
	}

	public unmount(): void {
		if (this.container) {
			this.container.removeEventListener('dragstart', this.onDragStart);
			this.container.removeEventListener('dragover', this.onDragOver);
			this.container.removeEventListener('dragleave', this.onDragLeave);
			this.container.removeEventListener('dragend', this.onDragEnd);
			this.container.removeEventListener('drop', this.onDrop);
		}
		document.removeEventListener('keydown', this.onKeyDown);
		this.cancel();
		this.container = null;
		this.scrollViewport = null;
	}

	// ── Event handlers ──────────────────────────────────────────────────────────

	private onDragStart = (e: DragEvent): void => {
		const handle = (e.target as Element).closest('[data-drag-row-id]') as HTMLElement | null;
		if (!handle) return;

		const rowId = handle.dataset.dragRowId;
		if (!rowId) return;

		const rowModel = this.engine.getRowModel();
		const visualIndex = rowModel?.getVisualIndexByRowId(rowId) ?? -1;
		if (visualIndex < 0) return;

		this.drag = { rowId, visualIndex, lastOverRowId: null, lastOverVisualIndex: null };
		this.container?.classList.add('og-row-dragging');

		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', rowId);
		}

		this.engine.eventBus.dispatchEvent(GridEventName.rowDragStart, {
			rowId,
			rowData: rowModel?.getRawRowById(rowId) ?? null,
			visualIndex,
		});
	};

	private onDragOver = (e: DragEvent): void => {
		if (!this.drag) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

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

	private onDragLeave = (e: DragEvent): void => {
		if (!this.drag) return;
		// Only stop auto-scroll if leaving the container entirely
		const related = e.relatedTarget as Node | null;
		if (!related || !this.container?.contains(related)) {
			this.stopAutoScroll();
		}
	};

	private onDrop = (e: DragEvent): void => {
		if (!this.drag) return;
		e.preventDefault();
		const { rowId: overRowId, visualIndex: overVisualIndex } = this.getRowAt(e.clientX, e.clientY);
		this.commit(overRowId, overVisualIndex);
	};

	private onDragEnd = (e: DragEvent): void => {
		if (!this.drag) return;
		// dragend fires after drop; if drop already committed, drag is null
		// If drag ended without drop (e.g. dropped outside), fire cancelled
		const { rowId } = this.drag;
		this.cleanup();
		this.engine.eventBus.dispatchEvent(GridEventName.rowDragCancelled, { rowId });
	};

	private onKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && this.drag) {
			const { rowId } = this.drag;
			this.cleanup();
			this.engine.eventBus.dispatchEvent(GridEventName.rowDragCancelled, { rowId });
		}
	};

	// ── Core logic ──────────────────────────────────────────────────────────────

	private commit(overRowId: string | null, overVisualIndex: number | null): void {
		if (!this.drag) return;
		const { rowId } = this.drag;

		this.engine.eventBus.dispatchEvent(GridEventName.rowDragEnd, {
			rowId,
			overRowId,
			overVisualIndex,
		});

		const state = this.engine.stateManager.getState();
		const mode = state.rowDragMode ?? 'managed';

		if (mode === 'managed' && overVisualIndex !== null && overVisualIndex !== this.drag.visualIndex) {
			const rowModel = this.engine.getRowModel();
			if (rowModel?.setRowOrder && rowModel?.getRowOrder) {
				// If sorting is active it will override any source-order change, so clear it first.
				// This matches the standard UX (ag-Grid, etc.) where manual drag takes precedence over sort.
				if (state.sortModel) {
					this.engine.setSortModel(null, false);
				}

				const currentOrder = rowModel.getRowOrder();
				const fromIdx = currentOrder.indexOf(rowId);
				if (fromIdx !== -1) {
					// Build new order: remove from current position, insert before target
					const withoutDragged = currentOrder.filter((id) => id !== rowId);
					// We insert before the overRow in source order
					let insertAt = withoutDragged.length;
					if (overRowId) {
						const pos = withoutDragged.indexOf(overRowId);
						if (pos !== -1) insertAt = pos;
					}
					const newOrder = [...withoutDragged.slice(0, insertAt), rowId, ...withoutDragged.slice(insertAt)];
					rowModel.setRowOrder(newOrder);
					this.engine.eventBus.dispatchEvent(GridEventName.rowOrderChanged, { rowIds: newOrder });
				}
			}
		}

		this.cleanup();
	}

	private cancel(): void {
		if (!this.drag) return;
		this.cleanup();
	}

	private cleanup(): void {
		this.drag = null;
		this.container?.classList.remove('og-row-dragging');
		this.removeDropIndicator();
		this.stopAutoScroll();
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

		// Position the indicator line at the top or bottom of the target row
		const state = this.engine.stateManager.getState();
		const scrollViewport = this.scrollViewport;
		if (!scrollViewport) return;

		const rowModel = this.engine.getRowModel();
		const vr = rowModel?.getVisualRow(overVisualIndex);
		if (!vr) return;

		const defaultH = state.defaultRowHeight;
		const rowTop = this.engine.geometry.getRowTop(overVisualIndex, defaultH);
		const rowH = this.engine.geometry.getRowHeight(overVisualIndex, defaultH);
		const scrollTop = scrollViewport.scrollTop;
		const vpRect = scrollViewport.getBoundingClientRect();
		const containerRect = this.container.getBoundingClientRect();

		// Decide snap position: above or below the row midpoint
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
			const rate = -SCROLL_MAX_PX * (1 - distFromTop / SCROLL_EDGE_PX);
			this.startAutoScroll(rate);
		} else if (distFromBottom < SCROLL_EDGE_PX) {
			const rate = SCROLL_MAX_PX * (1 - distFromBottom / SCROLL_EDGE_PX);
			this.startAutoScroll(rate);
		} else {
			this.stopAutoScroll();
		}
	}

	private startAutoScroll(rate: number): void {
		this.stopAutoScroll();
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

	/** Find the row ID and visual index at a given client-space point. */
	private getRowAt(clientX: number, clientY: number): { rowId: string | null; visualIndex: number | null } {
		const el = document.elementFromPoint(clientX, clientY);
		if (!el) return { rowId: null, visualIndex: null };

		// Walk up to find a row element with a cell that has data-row-id
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
