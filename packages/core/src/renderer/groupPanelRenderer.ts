import type { GridEngine } from '../engine/GridEngine.js';
import { GridEventName } from '../store.js';

/**
 * Renders the group-by strip above the column headers.
 *
 * Shows each current groupBy column as a draggable chip.  Supports:
 * - Drop-from-header: when the ColumnInteractionController is dragging a column
 *   with enableRowGroup !== false, the panel highlights as a valid drop target.
 *   On drop it calls engine.addGroupBy(colId, dropIndex).
 * - Chip reorder: mousedown on a chip starts a local drag that calls
 *   engine.moveGroupBy on mouseup.
 * - Chip remove: clicking the × button calls engine.removeGroupBy(colId).
 * - Empty state: "Drag columns here to group" placeholder when groupBy is empty.
 */
export class GroupPanelRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private panel: HTMLDivElement | null = null;
	private unsubscribers: Array<() => void> = [];

	// Column-header-drag state (driven by ColumnInteractionController callbacks)
	private _headerDragActive = false;
	private _headerDragColId: string | null = null;
	private _headerDragDropIndex = -1;
	private _headerDropIndicator: HTMLDivElement | null = null;

	// Chip-reorder drag state
	private _chipDragActive = false;
	private _chipDragColId: string | null = null;
	private _chipDragDropIndex = -1;

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	public mount(panel: HTMLDivElement): void {
		this.panel = panel;
		this.render();

		const sub1 = this.engine.eventBus.addEventListener(GridEventName.groupByChanged, () => this.render());
		const sub2 = this.engine.eventBus.addEventListener(GridEventName.groupColumnAdded, () => this.render());
		const sub3 = this.engine.eventBus.addEventListener(GridEventName.groupColumnRemoved, () => this.render());
		const sub4 = this.engine.eventBus.addEventListener(GridEventName.groupColumnMoved, () => this.render());
		this.unsubscribers.push(sub1, sub2, sub3, sub4);
	}

	public unmount(): void {
		for (const unsub of this.unsubscribers) unsub();
		this.unsubscribers = [];
		this.panel = null;
		this._headerDropIndicator = null;
	}

	// ── Render ─────────────────────────────────────────────────────────────────

	public render(): void {
		if (!this.panel) return;
		const groupBy = this.engine.stateManager.getState().groupBy ?? [];
		this.panel.innerHTML = '';

		if (groupBy.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'og-group-panel-empty';
			empty.textContent = 'Drag here to set row groups';
			this.panel.appendChild(empty);
		} else {
			for (let i = 0; i < groupBy.length; i++) {
				this.panel.appendChild(this.createChip(groupBy[i], i));
			}
		}
	}

	// ── Column-header drag protocol (called by ColumnInteractionController) ────

	/**
	 * Called when a groupable column drag starts over the panel area.
	 * Returns true if the panel accepted the drag (enableRowGroup !== false).
	 */
	public onHeaderDragEnter(colId: string): void {
		if (this._headerDragActive && this._headerDragColId === colId) return;
		this._headerDragActive = true;
		this._headerDragColId = colId;
		this.panel?.classList.add('og-group-panel-drop-active');
		this.ensureHeaderDropIndicator();
	}

	public onHeaderDragLeave(): void {
		if (!this._headerDragActive) return;
		this._headerDragActive = false;
		this._headerDragColId = null;
		this._headerDragDropIndex = -1;
		this.panel?.classList.remove('og-group-panel-drop-active');
		this.removeHeaderDropIndicator();
	}

	/** Updates drop position as the pointer moves over the panel. */
	public onHeaderDragMove(e: MouseEvent): void {
		if (!this._headerDragActive || !this.panel) return;
		const idx = this.computeDropIndex(e);
		if (idx !== this._headerDragDropIndex) {
			this._headerDragDropIndex = idx;
			this.positionHeaderDropIndicator(idx);
		}
	}

	/**
	 * Called when the column drag ends.  If `accepted` is true the pointer was
	 * released over this panel; addGroupBy is called at the computed index.
	 */
	public onHeaderDragEnd(accepted: boolean): void {
		if (!this._headerDragActive) return;
		const colId = this._headerDragColId;
		const dropIndex = this._headerDragDropIndex;
		this.onHeaderDragLeave();
		if (accepted && colId) {
			this.engine.addGroupBy(colId, dropIndex >= 0 ? dropIndex : undefined);
		}
	}

	/** Whether a column-header drag is currently in progress. */
	public isHeaderDragActive(): boolean {
		return this._headerDragActive;
	}

	/** Returns true if the given client coordinates are over this panel element. */
	public containsPoint(clientX: number, clientY: number): boolean {
		if (!this.panel) return false;
		const rect = this.panel.getBoundingClientRect();
		return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
	}

	// ── Private helpers ────────────────────────────────────────────────────────

	private createChip(colId: string, _index: number): HTMLDivElement {
		const state = this.engine.stateManager.getState();
		const col = state.columns.find((c) => c.field === colId);
		const label = col?.header || colId;

		const chip = document.createElement('div');
		chip.className = 'og-group-chip';
		chip.dataset.colId = colId;

		// Drag handle icon
		const handle = document.createElement('span');
		handle.className = 'og-group-chip-handle';
		handle.innerHTML =
			'<svg viewBox="0 0 10 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">' +
			'<circle cx="3" cy="3.5" r="1.2"/><circle cx="7" cy="3.5" r="1.2"/>' +
			'<circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/>' +
			'<circle cx="3" cy="12.5" r="1.2"/><circle cx="7" cy="12.5" r="1.2"/>' +
			'</svg>';
		chip.appendChild(handle);

		const labelEl = document.createElement('span');
		labelEl.className = 'og-group-chip-label';
		labelEl.textContent = label;
		chip.appendChild(labelEl);

		const removeBtn = document.createElement('button');
		removeBtn.className = 'og-group-chip-remove';
		removeBtn.type = 'button';
		removeBtn.setAttribute('aria-label', `Remove ${label} grouping`);
		removeBtn.innerHTML =
			'<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
			'<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>' +
			'</svg>';
		removeBtn.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.engine.removeGroupBy(colId);
		});
		chip.appendChild(removeBtn);

		// Chip reorder drag
		chip.addEventListener('mousedown', (e) => this.onChipMouseDown(e, colId));

		return chip;
	}

	private onChipMouseDown(e: MouseEvent, colId: string): void {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement).closest('.og-group-chip-remove')) return;
		e.preventDefault();

		const startX = e.clientX;
		const startY = e.clientY;
		let dragging = false;

		const onMove = (moveEvent: MouseEvent) => {
			const dist = Math.max(Math.abs(moveEvent.clientX - startX), Math.abs(moveEvent.clientY - startY));
			if (!dragging && dist > 4) {
				dragging = true;
				this._chipDragActive = true;
				this._chipDragColId = colId;
				this.panel?.classList.add('og-group-panel-chip-dragging');
			}
			if (dragging) {
				this._chipDragDropIndex = this.computeDropIndex(moveEvent, colId);
				this.highlightChipDropTarget(this._chipDragDropIndex);
			}
		};

		const onUp = (upEvent: MouseEvent) => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			this.panel?.classList.remove('og-group-panel-chip-dragging');
			this.clearChipHighlights();

			if (dragging && this._chipDragDropIndex >= 0) {
				this.engine.moveGroupBy(colId, this._chipDragDropIndex);
			}

			this._chipDragActive = false;
			this._chipDragColId = null;
			this._chipDragDropIndex = -1;
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	/** Compute the groupBy insertion index from a pointer position over the panel. */
	private computeDropIndex(e: MouseEvent, excludeColId?: string): number {
		if (!this.panel) return -1;
		const groupBy = this.engine.stateManager.getState().groupBy ?? [];
		const chips = Array.from(this.panel.querySelectorAll<HTMLElement>('.og-group-chip'));
		if (chips.length === 0) return 0;

		for (let i = 0; i < chips.length; i++) {
			const chip = chips[i];
			const chipColId = chip.dataset.colId;
			if (chipColId === excludeColId) continue;
			const rect = chip.getBoundingClientRect();
			const mid = rect.left + rect.width / 2;
			if (e.clientX < mid) return i;
		}
		return groupBy.length;
	}

	private ensureHeaderDropIndicator(): void {
		if (this._headerDropIndicator || !this.panel) return;
		const ind = document.createElement('div');
		ind.className = 'og-group-panel-drop-indicator';
		this.panel.appendChild(ind);
		this._headerDropIndicator = ind;
	}

	private positionHeaderDropIndicator(dropIndex: number): void {
		if (!this._headerDropIndicator || !this.panel) return;
		const chips = Array.from(this.panel.querySelectorAll<HTMLElement>('.og-group-chip'));
		let left = 8;
		if (chips.length > 0) {
			if (dropIndex < chips.length) {
				const rect = chips[dropIndex].getBoundingClientRect();
				const panelRect = this.panel.getBoundingClientRect();
				left = rect.left - panelRect.left;
			} else {
				const rect = chips[chips.length - 1].getBoundingClientRect();
				const panelRect = this.panel.getBoundingClientRect();
				left = rect.right - panelRect.left;
			}
		}
		this._headerDropIndicator.style.left = `${left}px`;
		this._headerDropIndicator.style.display = 'block';
	}

	private removeHeaderDropIndicator(): void {
		this._headerDropIndicator?.remove();
		this._headerDropIndicator = null;
	}

	private highlightChipDropTarget(dropIndex: number): void {
		if (!this.panel) return;
		const chips = Array.from(this.panel.querySelectorAll<HTMLElement>('.og-group-chip'));
		chips.forEach((c, i) => {
			c.classList.toggle('og-group-chip-drop-before', i === dropIndex);
			c.classList.toggle('og-group-chip-drop-after', i === dropIndex - 1);
		});
	}

	private clearChipHighlights(): void {
		if (!this.panel) return;
		for (const chip of this.panel.querySelectorAll<HTMLElement>('.og-group-chip')) {
			chip.classList.remove('og-group-chip-drop-before', 'og-group-chip-drop-after');
		}
	}
}
