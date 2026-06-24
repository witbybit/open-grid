import type { RenderColumn, RendererEngineView } from './RendererEngineView.js';
import type { RowBinding } from './RowBinder.js';
import { RowBinder } from './RowBinder.js';
import { computeRenderLayout } from './RenderLayout.js';
import type { RenderLayout } from './RenderLayout.js';
import type { VisualRow } from '../pipeline/VisualRow.js';
import type { RowId } from '../rows/RowId.js';

/**
 * Callbacks wired by the React adapter for portal-based custom cell renderers.
 * The renderer fires these when a cell slot binds or unbinds, letting React mount
 * a portal into the provided container element.
 */
export interface CellContentMount<TRow> {
	readonly cellKey: string;
	readonly container: HTMLElement;
	readonly rowId: RowId | null;
	readonly field: string;
	readonly row: VisualRow<TRow>;
	readonly column: RenderColumn;
}

export interface CellContentUnmount {
	readonly cellKey: string;
}

export interface DomGridRendererCallbacks<TRow> {
	onMountCellContent?: (mount: CellContentMount<TRow>) => void;
	onUnmountCellContent?: (unmount: CellContentUnmount) => void;
}

/** One DOM row slot and its current binding metadata. */
interface RowSlotState {
	el: HTMLDivElement;
	/** Last-painted visual row index (-1 if slot was just created/unused). */
	visualRowIndex: number;
	/** Child cell elements indexed by column field, for incremental updates. */
	cellsByField: Map<string, HTMLDivElement>;
	pinLeft: HTMLDivElement | null;
	pinRight: HTMLDivElement | null;
}

/**
 * Pure-DOM renderer that reads from {@link RendererEngineView} and paints the `.og-*` layer
 * structure (ARCHITECTURE.md §3 R12–R13). Reuses the existing styles.ts CSS class contract so the
 * grid looks identical; only the data-access layer changes. No React, no business state — the React
 * adapter owns the container div and wires the portal callbacks.
 */
export class DomGridRenderer<TRow> {
	private readonly rowBinder = new RowBinder<TRow>();
	private slots: RowSlotState[] = [];

	// DOM refs
	private scrollViewport: HTMLDivElement | null = null;
	private rowsContainer: HTMLDivElement | null = null;
	private headerWrapper: HTMLDivElement | null = null;
	private headerLeft: HTMLDivElement | null = null;
	private headerCenter: HTMLDivElement | null = null;
	private headerRight: HTMLDivElement | null = null;

	private rafId: number | null = null;
	private unsubscribe: (() => void) | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private container: HTMLElement | null = null;

	// Track last-painted column set to skip header repaint when unchanged.
	private lastColumnVersion = -1;

	constructor(
		private readonly view: RendererEngineView<TRow>,
		private readonly callbacks: DomGridRendererCallbacks<TRow> = {},
	) {}

	mount(container: HTMLElement): void {
		this.container = container;
		this.buildDom(container);

		this.unsubscribe = this.view.subscribe(() => this.schedulePaint());

		this.resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			this.view.setSize(width, height);
			this.schedulePaint();
		});
		this.resizeObserver.observe(container);

		// Prime the viewport with current dimensions.
		const rect = container.getBoundingClientRect();
		this.view.setSize(rect.width || 800, rect.height || 500);

		this.paint();
	}

	unmount(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.scrollViewport?.removeEventListener('scroll', this.onScroll);
		if (this.container) this.container.innerHTML = '';
		this.slots = [];
		this.rowBinder.reset();
		this.container = null;
		this.scrollViewport = null;
		this.rowsContainer = null;
		this.headerWrapper = null;
		this.headerLeft = null;
		this.headerCenter = null;
		this.headerRight = null;
	}

	schedulePaint(): void {
		if (this.rafId !== null) return;
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null;
			this.paint();
		});
	}

	// ─── Private ─────────────────────────────────────────────────────────────

	private buildDom(container: HTMLElement): void {
		const sv = document.createElement('div');
		sv.className = 'og-scroll-viewport';
		sv.addEventListener('scroll', this.onScroll, { passive: true });
		this.scrollViewport = sv;

		// Header wrapper (sticky top:0 from CSS)
		const hw = document.createElement('div');
		hw.className = 'og-layer-header-wrapper';
		this.headerWrapper = hw;

		const hl = document.createElement('div');
		hl.className = 'og-layer-header-left';
		this.headerLeft = hl;

		const hc = document.createElement('div');
		hc.className = 'og-layer-header';
		this.headerCenter = hc;

		const hr = document.createElement('div');
		hr.className = 'og-layer-header-right';
		this.headerRight = hr;

		hw.append(hl, hc, hr);

		// Rows container
		const rc = document.createElement('div');
		rc.className = 'og-rows-container';
		this.rowsContainer = rc;

		sv.append(hw, rc);
		container.appendChild(sv);
	}

	private onScroll = (): void => {
		if (!this.scrollViewport) return;
		this.view.setScroll(this.scrollViewport.scrollTop, this.scrollViewport.scrollLeft);
		this.schedulePaint();
	};

	private paint(): void {
		if (!this.rowsContainer || !this.headerWrapper) return;

		const layout = computeRenderLayout(this.view);
		const columns = this.view.getColumns();

		this.applyLayout(layout, columns);
		this.paintHeader(layout, columns);
		this.paintRows(layout, columns);
	}

	private applyLayout(layout: RenderLayout, columns: readonly RenderColumn[]): void {
		// Size the scrollable content area.
		this.rowsContainer!.style.height = `${layout.dimensions.totalRowsHeight}px`;
		this.rowsContainer!.style.minWidth = `${layout.dimensions.contentWidth}px`;

		// Header wrapper height (just the leaf header row for now).
		this.headerWrapper!.style.height = `${layout.chrome.headerHeight}px`;

		// Lane widths for the header (right lane expands from the right).
		this.headerLeft!.style.width = `${layout.columns.leftWidth}px`;
		this.headerCenter!.style.minWidth = `${layout.columns.centerWidth}px`;
		this.headerRight!.style.width = `${layout.columns.rightWidth}px`;

		// Set CSS var so the status bar / bottom chrome offset works correctly.
		if (this.container) {
			this.container.style.setProperty('--og-bottom-chrome-height', `${layout.chrome.bottomChromeHeight}px`);
		}

		// Paint columns version for header change detection.
		this.lastColumnVersion = this.view.getVersion('columns');
	}

	private paintHeader(layout: RenderLayout, columns: readonly RenderColumn[]): void {
		const hl = this.headerLeft!;
		const hc = this.headerCenter!;
		const hr = this.headerRight!;

		// Clear and repaint (headers change rarely; incremental update is an optimization for later).
		hl.innerHTML = '';
		hc.innerHTML = '';
		hr.innerHTML = '';

		const height = layout.chrome.headerHeight;

		for (const col of columns) {
			const cell = document.createElement('div');
			cell.className = 'og-header-cell';
			cell.style.left = `${col.left}px`;
			cell.style.width = `${col.width}px`;
			cell.style.height = `${height}px`;
			cell.textContent = col.header;
			if (col.sortDirection) {
				cell.dataset.sort = col.sortDirection;
			}

			if (col.lane === 'left') hl.appendChild(cell);
			else if (col.lane === 'right') hr.appendChild(cell);
			else hc.appendChild(cell);
		}
	}

	private paintRows(layout: RenderLayout, columns: readonly RenderColumn[]): void {
		const bindings = this.rowBinder.bind(this.view);
		const needed = this.rowBinder.slotCount;

		this.ensureSlots(needed);

		// Hide slots beyond the current window (window shrunk).
		for (let i = needed; i < this.slots.length; i++) {
			this.slots[i]!.el.style.display = 'none';
		}

		const { leftWidth, rightWidth } = layout.columns;

		for (const binding of bindings) {
			const slot = this.slots[binding.slotIndex];
			if (!slot) continue;
			this.paintRowSlot(slot, binding, columns, leftWidth, rightWidth);
		}
	}

	private paintRowSlot(
		slot: RowSlotState,
		binding: RowBinding<TRow>,
		columns: readonly RenderColumn[],
		leftWidth: number,
		rightWidth: number,
	): void {
		const { row, top, height, visualRowIndex } = binding;
		const el = slot.el;

		el.style.display = '';
		el.style.transform = `translateY(${top}px)`;
		el.style.height = `${height}px`;
		el.dataset.rowIndex = String(visualRowIndex);

		el.className = this.rowClass(row);

		this.paintCells(slot, row, columns, leftWidth, rightWidth);
		slot.visualRowIndex = visualRowIndex;
	}

	private rowClass(row: VisualRow<TRow>): string {
		let cls = 'og-row';
		switch (row.kind) {
			case 'group':
				cls += ' og-row-group';
				break;
			case 'detail':
				cls += ' og-row-detail';
				break;
			case 'loading':
				cls += ' og-row-loading';
				break;
		}
		if (row.kind === 'data' && this.view.isRowSelected(row.rowId)) {
			cls += ' og-row-selected';
		}
		return cls;
	}

	private paintCells(
		slot: RowSlotState,
		row: VisualRow<TRow>,
		columns: readonly RenderColumn[],
		leftWidth: number,
		rightWidth: number,
	): void {
		const el = slot.el;
		const hasLeft = leftWidth > 0;
		const hasRight = rightWidth > 0;

		// Ensure pin containers exist when needed, create them lazily.
		if (hasLeft && !slot.pinLeft) {
			const pl = document.createElement('div');
			pl.className = 'og-row-pin-left';
			el.insertBefore(pl, el.firstChild);
			slot.pinLeft = pl;
		}
		if (hasRight && !slot.pinRight) {
			const pr = document.createElement('div');
			pr.className = 'og-row-pin-right';
			el.appendChild(pr);
			slot.pinRight = pr;
		}

		// Update pin container widths.
		if (slot.pinLeft) slot.pinLeft.style.width = `${leftWidth}px`;
		if (slot.pinRight) slot.pinRight.style.width = `${rightWidth}px`;

		// Remove all old center cell children (those not inside pin containers).
		// Faster than diffing: headers rarely change, rows don't add/remove columns mid-session.
		const toRemove: ChildNode[] = [];
		el.childNodes.forEach((n) => {
			if (n !== slot.pinLeft && n !== slot.pinRight) toRemove.push(n);
		});
		toRemove.forEach((n) => el.removeChild(n));
		if (slot.pinLeft) slot.pinLeft.innerHTML = '';
		if (slot.pinRight) slot.pinRight.innerHTML = '';

		for (const col of columns) {
			const cell = this.buildCell(col, row, leftWidth);
			if (col.lane === 'left') {
				slot.pinLeft!.appendChild(cell);
			} else if (col.lane === 'right') {
				slot.pinRight!.appendChild(cell);
			} else {
				el.appendChild(cell);
			}
		}
	}

	private buildCell(col: RenderColumn, row: VisualRow<TRow>, leftWidth: number): HTMLDivElement {
		const cell = document.createElement('div');
		cell.className = 'og-cell';
		if (col.lane === 'left') cell.classList.add('og-cell-pinned-left');
		if (col.lane === 'right') cell.classList.add('og-cell-pinned-right');

		// Lane-relative offset: center cells are placed absolutely within the full row,
		// so their CSS left = pinLeftWidth + laneOffset. Left/right cells are within their
		// pin container so CSS left = laneOffset directly.
		const cssLeft = col.lane === 'center' ? leftWidth + col.left : col.left;
		cell.style.left = `${cssLeft}px`;
		cell.style.width = `${col.width}px`;

		const content = document.createElement('div');
		content.className = 'og-cell-content';
		content.dataset.contentMode = 'text';

		if (row.kind === 'data') {
			const val = this.view.getCellDisplayValue(row.rowId, col.field);
			content.textContent = val != null ? String(val) : '';
		} else if (row.kind === 'group') {
			content.textContent = col.field === 'group' ? String(row.groupKey ?? '') : '';
		} else if (row.kind === 'loading') {
			const skel = document.createElement('div');
			skel.className = 'og-cell-loading-skeleton';
			content.appendChild(skel);
			content.dataset.contentMode = 'loading';
		}

		cell.appendChild(content);
		return cell;
	}

	private ensureSlots(count: number): void {
		while (this.slots.length < count) {
			const el = document.createElement('div');
			el.className = 'og-row';
			this.rowsContainer!.appendChild(el);
			this.slots.push({
				el,
				visualRowIndex: -1,
				cellsByField: new Map(),
				pinLeft: null,
				pinRight: null,
			});
		}
	}
}
