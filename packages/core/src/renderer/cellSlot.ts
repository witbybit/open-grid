export type CellContentMode = 'text' | 'portal' | 'loading' | 'empty' | 'fallback' | 'pending' | 'custom';

import type { CellRendererHandle, CellPlacement } from './cellRendererHandle.js';
import { isMountedCellVisuallyFresh } from './visualFreshness.js';

export interface CellSlotMountedVisualVersions {
	insightVersion: number;
	styleVersion: number;
	loadingVersion: number;
	selectionVersion: number;
}

// Monotonic counter — advances once per CellSlot construction.
// A cell that is destroyed and recreated at the same position gets a strictly
// larger id, so stale portal keys from the destroyed instance never match the
// new instance's keys.
let _cellInstanceCounter = 0;

/**
 * Authoritative identity record for a bound cell slot.
 * Logic must read identity from CellSlot.binding, not from element.dataset.
 * Dataset attributes mirror binding for debug/DevTools inspection only.
 */
export interface CellBinding {
	readonly rowSlotId: string;
	readonly rowId: string;
	readonly rowIndex: number;
	readonly colId: string;
	readonly colIndex: number;
	readonly cellKey: string;
	readonly contentMode: CellContentMode;
}

// Intern common pixel strings — avoids a string allocation on every DOM write.
// Covers all practical column widths and left offsets (0–2000 px).
const _PX = Array.from({ length: 2001 }, (_, i) => `${i}px`);
export const toPx = (n: number): string => (n >= 0 && n < _PX.length ? _PX[n] : `${n}px`);

// DOM write stats shared across all CellSlot instances for performance instrumentation.
export const cellSlotWriteStats = {
	cellTextWrites: 0,
	cellClassWrites: 0,
	cellTransformWrites: 0,
	cellWidthWrites: 0,
	cellLeftWrites: 0,
	cellDomReadsAvoided: 0,
};

export function resetCellSlotWriteStats(): void {
	cellSlotWriteStats.cellTextWrites = 0;
	cellSlotWriteStats.cellClassWrites = 0;
	cellSlotWriteStats.cellTransformWrites = 0;
	cellSlotWriteStats.cellWidthWrites = 0;
	cellSlotWriteStats.cellLeftWrites = 0;
	cellSlotWriteStats.cellDomReadsAvoided = 0;
}

export function recordCellSlotMountedVisualVersions(cellSlot: CellSlot, versions: CellSlotMountedVisualVersions): void {
	cellSlot.lastMountedInsightVersion = versions.insightVersion;
	cellSlot.lastMountedStyleVersion = versions.styleVersion;
	cellSlot.lastMountedLoadingVersion = versions.loadingVersion;
	cellSlot.lastMountedSelectionVersion = versions.selectionVersion;
}

export function matchesCellSlotMountedVisualVersions(cellSlot: CellSlot, versions: CellSlotMountedVisualVersions): boolean {
	return (
		cellSlot.lastMountedInsightVersion === versions.insightVersion &&
		cellSlot.lastMountedStyleVersion === versions.styleVersion &&
		cellSlot.lastMountedLoadingVersion === versions.loadingVersion &&
		cellSlot.lastMountedSelectionVersion === versions.selectionVersion
	);
}

export function matchesCellSlotMountedFreshness(
	cellSlot: CellSlot,
	request: {
		rowVersion: number;
		globalVersion: number;
		visualVersions: CellSlotMountedVisualVersions;
	}
): boolean {
	return isMountedCellVisuallyFresh(cellSlot, {
		rowVersion: request.rowVersion,
		globalVersion: request.globalVersion,
		insightVersion: request.visualVersions.insightVersion,
		styleVersion: request.visualVersions.styleVersion,
		loadingVersion: request.visualVersions.loadingVersion,
		selectionVersion: request.visualVersions.selectionVersion,
	});
}

export class CellSlot<TRowData = unknown> {
	public readonly element: HTMLDivElement;
	public readonly contentElement: HTMLDivElement;
	/**
	 * Unique identity for this physical CellSlot object. Assigned once at construction
	 * and never changes — not even across row rebinds or lane relocations.
	 * Used as the basis for portal cellKeys so that a stale deferred release keyed to a
	 * destroyed cell can never affect a newly created cell at the same row/column position.
	 */
	public readonly cellInstanceId: string;
	/**
	 * Stable string identifier for the portal host of this cell. Derived from cellInstanceId —
	 * never changes for the CellSlot's lifetime. Passed with every portal mount so the React
	 * adapter can verify it is rendering into the correct physical host.
	 */
	public readonly portalHostId: string;
	/**
	 * Lazily created on first portal use (getOrCreatePortalHost). Plain-text columns —
	 * the common case — never pay the extra DOM node (+50% viewport node count).
	 */
	public portalHostElement: HTMLDivElement | null = null;
	/**
	 * Incremented each time this cell is hot-unbound (recycled to a different logical row).
	 * Consumers can capture this at mount time and compare later to detect stale deferred
	 * operations against a cell that has since been rebound to another row.
	 * Unlike slot.generation (which is per-slot), this is per-cell.
	 */
	public rowBindingGeneration = 0;
	/**
	 * Stable column association. Set once by reconcileTopology when the cell is first
	 * created for a column. Never changes across row rebinds or lane relocations —
	 * this cell is permanently associated with this column field for its lifetime.
	 */
	public columnId = '';
	/**
	 * Active renderer handle. Null when the cell is unbound or showing no content.
	 * Set by the bind loop when content mode changes; destroy() is called on the
	 * old handle before replacing it with a new one.
	 */
	public renderer: CellRendererHandle<TRowData> | null = null;
	/**
	 * Current lane placement. Set by the bind loop each frame and used by relocate-aware
	 * code paths (e.g. DOM renderers that need to know their position context).
	 */
	public placement: CellPlacement | null = null;

	/**
	 * Authoritative identity for this bound slot.
	 * Null when the slot is unbound. Logic that needs cell identity (portal key, row/col
	 * association) must read from binding, not from element.dataset.
	 */
	public binding: CellBinding | null = null;

	// Position — also reflected in binding when bound
	public colIndex = -1;
	public colField = '';
	public rowIndex = -1;
	public rowId = '';

	// Cached DOM states — integers are faster to compare than strings
	public lastRawValue: unknown = undefined;
	public lastFormattedValue: string | undefined = undefined;
	public lastLeft = -1; // absolute left px for center and pin-left cells
	public lastRight = -1; // distance-from-right px for pin-right cells (-1 = not set)
	public lastWidth = -1; // column width px
	public lastShift = 0; // live column-reorder preview offset px; 0 = none
	public lastAriaSelected: boolean | undefined = undefined; // ARIA selection state cache
	public lastClassName = '';
	public lastContentMode: CellContentMode = 'empty';
	public lastPortalKey: string | undefined = undefined;
	// Cached so unbindHot can skip the hasAttribute DOM read in the hot path.
	public hasTabIndex = false;
	// Per-row and global versions recorded when this cell's portal was last mounted.
	// During scroll: if rowVersions.get(rowId) !== lastMountedRowVersion the row data changed
	// (only that row thaws); if globalVersion !== lastMountedGlobalVersion everything thaws.
	public lastMountedRowVersion = -1;
	public lastMountedGlobalVersion = -1;
	public lastMountedInsightVersion = -1;
	public lastMountedStyleVersion = -1;
	public lastMountedLoadingVersion = -1;
	public lastMountedSelectionVersion = -1;

	constructor(element: HTMLDivElement) {
		this.cellInstanceId = `ci${++_cellInstanceCounter}`;
		this.portalHostId = `${this.cellInstanceId}-ph`;
		this.element = element;
		(element as any).__cellSlot = this;
		// ARIA grid semantics — role is static per element; positional/state attrs are
		// written (guarded) in update().
		if (element.getAttribute('role') !== 'gridcell') element.setAttribute('role', 'gridcell');
		let content = element.querySelector('.og-cell-content') as HTMLDivElement;
		if (!content) {
			content = document.createElement('div');
			content.className = 'og-cell-content';
			element.appendChild(content);
		}
		this.contentElement = content;
		// Adopt an existing portal host (recycled element); otherwise create lazily.
		this.portalHostElement = element.querySelector('.og-cell-portal-host') as HTMLDivElement | null;
	}

	/** Portal host accessor — creates the div on first use only. */
	public getOrCreatePortalHost(): HTMLDivElement {
		let host = this.portalHostElement;
		if (!host) {
			host = document.createElement('div');
			host.className = 'og-cell-portal-host';
			this.element.appendChild(host);
			this.portalHostElement = host;
		}
		return host;
	}

	public static fromElement<TRowData = unknown>(element: HTMLDivElement): CellSlot<TRowData> {
		const existing = (element as any).__cellSlot as CellSlot<TRowData> | undefined;
		if (existing && existing.element === element) {
			return existing;
		}
		return new CellSlot<TRowData>(element);
	}

	public reset(): void {
		this.binding = null;
		this.lastRawValue = undefined;
		this.lastFormattedValue = undefined;
		this.lastLeft = -1;
		this.lastRight = -1;
		this.lastWidth = -1;
		if (this.lastShift !== 0) {
			this.lastShift = 0;
			this.element.style.transform = '';
		}
		if (this.lastAriaSelected !== undefined) {
			this.lastAriaSelected = undefined;
			this.element.removeAttribute('aria-selected');
		}
		if (this.element.style.visibility) {
			this.element.style.visibility = '';
		}
		this.lastClassName = '';
		this.lastContentMode = 'empty';
		this.lastPortalKey = undefined;
		this.hasTabIndex = false;
		this.lastMountedRowVersion = -1;
		this.lastMountedGlobalVersion = -1;
		this.lastMountedInsightVersion = -1;
		this.lastMountedStyleVersion = -1;
		this.lastMountedLoadingVersion = -1;
		this.lastMountedSelectionVersion = -1;
		this.colIndex = -1;
		this.colField = '';
		this.rowIndex = -1;
		this.rowId = '';
	}

	/**
	 * Binds the cell slot to new parameters. Prevents DOM writes if values match.
	 *
	 * Center cells use content-space left offsets.
	 * Pinned cells use scroll-adjusted left offsets and stay absolute.
	 */
	public update(
		colIndex: number,
		colField: string,
		rowIndex: number,
		rowId: string,
		left: number,
		right: number,
		width: number,
		className: string,
		contentMode: CellContentMode,
		rawValue: unknown,
		formattedValue: string,
		portalKey?: string,
		dragShift = 0,
		ariaSelected?: boolean
	): boolean {
		let domUpdated = false;

		if (this.colIndex !== colIndex) {
			this.colIndex = colIndex;
			this.element.setAttribute('aria-colindex', String(colIndex + 1)); // ARIA: 1-based
		}
		// ARIA selection state — undefined means "leave unchanged" (the scroll bind path does
		// not recompute selection, so it must not clobber it).
		if (ariaSelected !== undefined && ariaSelected !== this.lastAriaSelected) {
			this.lastAriaSelected = ariaSelected;
			if (ariaSelected) this.element.setAttribute('aria-selected', 'true');
			else this.element.removeAttribute('aria-selected');
			domUpdated = true;
		}
		if (this.colField !== colField) {
			this.colField = colField;
			this.element.dataset.colField = colField;
			domUpdated = true;
		}
		if (this.rowIndex !== rowIndex) {
			this.rowIndex = rowIndex;
			this.element.dataset.rowIndex = String(rowIndex);
			domUpdated = true;
		}
		if (this.rowId !== rowId) {
			this.rowId = rowId;
			this.element.dataset.rowId = rowId;
			domUpdated = true;
		}

		// Position — one DOM write per changed axis, pin-right uses right, others use left
		if (right >= 0) {
			if (this.lastRight !== right) {
				this.lastRight = right;
				this.element.style.right = toPx(right);
				cellSlotWriteStats.cellLeftWrites++;
				domUpdated = true;
			}
			if (this.lastLeft !== -1) {
				this.lastLeft = -1;
				this.element.style.left = '';
			}
		} else {
			if (this.lastLeft !== left) {
				this.lastLeft = left;
				this.element.style.left = toPx(left);
				cellSlotWriteStats.cellLeftWrites++;
				domUpdated = true;
			}
			if (this.lastRight !== -1) {
				this.lastRight = -1;
				this.element.style.right = '';
			}
		}

		if (this.lastWidth !== width) {
			this.lastWidth = width;
			this.element.style.width = toPx(width);
			cellSlotWriteStats.cellWidthWrites++;
			domUpdated = true;
		}

		// Live column-reorder preview offset. Composes on top of the `left`/`right`
		// positioning above. Guarded by lastShift so steady-state binds (shift 0) never touch
		// transform — the per-cell hot path stays write-free outside an active header drag.
		if (dragShift !== this.lastShift) {
			this.lastShift = dragShift;
			this.element.style.transform = dragShift !== 0 ? `translateX(${toPx(dragShift)})` : '';
			cellSlotWriteStats.cellTransformWrites++;
			domUpdated = true;
		}

		if (this.lastClassName !== className) {
			this.lastClassName = className;
			this.element.className = className;
			cellSlotWriteStats.cellClassWrites++;
			domUpdated = true;
		}

		if (this.lastContentMode !== contentMode) {
			this.lastContentMode = contentMode;
			this.element.dataset.contentMode = contentMode;
			domUpdated = true;
		}

		if (this.lastPortalKey !== portalKey) {
			this.lastPortalKey = portalKey;
			if (portalKey) {
				this.element.dataset.cellKey = portalKey;
			} else {
				delete this.element.dataset.cellKey;
			}
			domUpdated = true;
		}
		if (this.element.style.visibility) {
			this.element.style.visibility = '';
			domUpdated = true;
		}

		this.lastRawValue = rawValue;

		// Compare against JS-side cache only — no DOM read.
		// lastFormattedValue is always kept in sync with contentElement.textContent.
		// 'custom' mode: content is managed externally (e.g. checkbox cells) — never touch textContent.
		if (contentMode !== 'custom') {
			if (contentMode === 'text' || contentMode === 'fallback') {
				if (this.lastFormattedValue !== formattedValue) {
					this.lastFormattedValue = formattedValue;
					this.contentElement.textContent = formattedValue;
					cellSlotWriteStats.cellTextWrites++;
					domUpdated = true;
				} else {
					cellSlotWriteStats.cellDomReadsAvoided++;
				}
			} else if (contentMode !== 'portal') {
				// Portal mode leaves existing text in the DOM — CSS hides .og-cell-content via
				// [data-content-mode="portal"] > .og-cell-content { display: none }.
				// Text is cleared lazily when the cell transitions to empty/loading/pending.
				if (this.lastFormattedValue !== '') {
					this.lastFormattedValue = '';
					this.contentElement.textContent = '';
					cellSlotWriteStats.cellTextWrites++;
					domUpdated = true;
				} else {
					cellSlotWriteStats.cellDomReadsAvoided++;
				}
			}
		}

		return domUpdated;
	}

	public updatePosition(left: number): boolean {
		let domUpdated = false;
		if (this.lastLeft !== left) {
			this.lastLeft = left;
			this.element.style.left = toPx(left);
			cellSlotWriteStats.cellLeftWrites++;
			domUpdated = true;
		}
		if (this.lastRight !== -1) {
			this.lastRight = -1;
			this.element.style.right = '';
			domUpdated = true;
		}
		return domUpdated;
	}

	/**
	 * Set the authoritative binding for this cell slot.
	 * Called by RowRenderer when it binds a cell to a new physical row slot.
	 * Dataset attributes remain as debug mirrors; logic must read from binding.
	 */
	public setBinding(
		rowSlotId: string,
		rowId: string,
		rowIndex: number,
		colId: string,
		colIndex: number,
		cellKey: string,
		contentMode: CellContentMode
	): void {
		this.binding = { rowSlotId, rowId, rowIndex, colId, colIndex, cellKey, contentMode };
	}

	public unbindHot(): void {
		this.rowBindingGeneration++;
		this.binding = null;
		this.colIndex = -1;
		this.colField = '';
		this.rowIndex = -1;
		this.rowId = '';
		this.lastRawValue = undefined;
		this.lastMountedRowVersion = -1;
		this.lastMountedGlobalVersion = -1;
		this.lastMountedInsightVersion = -1;
		this.lastMountedStyleVersion = -1;
		this.lastMountedLoadingVersion = -1;
		this.lastMountedSelectionVersion = -1;
		// Use JS-side flag to skip DOM read in hot path.
		if (this.hasTabIndex) {
			this.element.removeAttribute('tabindex');
			this.hasTabIndex = false;
		}
		if (this.element.style.visibility) {
			this.element.style.visibility = '';
		}
	}

	public unbindCold(): void {
		if (this.renderer !== null) {
			this.renderer.destroy();
			this.renderer = null;
		}
		this.placement = null;
		this.binding = null;
		this.lastRawValue = undefined;
		this.lastFormattedValue = undefined;
		this.lastLeft = -1;
		this.lastRight = -1;
		this.lastWidth = -1;
		if (this.lastShift !== 0) {
			this.lastShift = 0;
			this.element.style.transform = '';
		}
		if (this.lastAriaSelected !== undefined) {
			this.lastAriaSelected = undefined;
			this.element.removeAttribute('aria-selected');
		}
		this.lastClassName = '';
		this.lastContentMode = 'empty';
		this.lastPortalKey = undefined;
		this.hasTabIndex = false;
		this.lastMountedRowVersion = -1;
		this.lastMountedGlobalVersion = -1;
		this.lastMountedInsightVersion = -1;
		this.lastMountedStyleVersion = -1;
		this.lastMountedLoadingVersion = -1;
		this.lastMountedSelectionVersion = -1;
		this.colIndex = -1;
		this.colField = '';
		this.rowIndex = -1;
		this.rowId = '';

		this.contentElement.textContent = '';
		this.element.className = '';
		this.element.removeAttribute('style');
		delete this.element.dataset.colField;
		delete this.element.dataset.rowIndex;
		delete this.element.dataset.rowId;
		delete this.element.dataset.cellKey;
		delete this.element.dataset.contentMode;
	}
}
