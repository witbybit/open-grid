export type CellContentMode = 'text' | 'portal' | 'loading' | 'empty' | 'fallback' | 'pending';

// Debug stats for DOM write tracking (Phase 4). Shared across all CellSlot instances.
export const cellSlotWriteStats = {
	cellTextWrites: 0,
	cellClassWrites: 0,
	cellTransformWrites: 0,
	cellWidthWrites: 0,
	cellLeftWrites: 0,
	cellDomReadsAvoided: 0,
};

export class CellSlot<TRowData = unknown> {
	public readonly element: HTMLDivElement;
	public readonly contentElement: HTMLDivElement;
	public readonly portalHostElement: HTMLDivElement;

	// Position
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
	public lastClassName = '';
	public lastContentMode: CellContentMode = 'empty';
	public lastPortalKey: string | undefined = undefined;
	// Phase 4: track tabindex state to avoid hasAttribute DOM read in hot unbind path
	public hasTabIndex = false;

	constructor(element: HTMLDivElement) {
		this.element = element;
		(element as any).__cellSlot = this;
		let content = element.querySelector('.og-cell-content') as HTMLDivElement;
		let portalHost = element.querySelector('.og-cell-portal-host') as HTMLDivElement;
		if (!content) {
			content = document.createElement('div');
			content.className = 'og-cell-content';
			element.appendChild(content);
		}
		if (!portalHost) {
			portalHost = document.createElement('div');
			portalHost.className = 'og-cell-portal-host';
			element.appendChild(portalHost);
		}
		this.contentElement = content;
		this.portalHostElement = portalHost;
	}

	public static fromElement<TRowData = unknown>(element: HTMLDivElement): CellSlot<TRowData> {
		const existing = (element as any).__cellSlot as CellSlot<TRowData> | undefined;
		if (existing && existing.element === element) {
			return existing;
		}
		return new CellSlot<TRowData>(element);
	}

	public reset(): void {
		this.lastRawValue = undefined;
		this.lastFormattedValue = undefined;
		this.lastLeft = -1;
		this.lastRight = -1;
		this.lastWidth = -1;
		this.lastClassName = '';
		this.lastContentMode = 'empty';
		this.lastPortalKey = undefined;
		this.hasTabIndex = false;
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
		portalKey?: string
	): boolean {
		let domUpdated = false;

		if (this.colIndex !== colIndex) this.colIndex = colIndex;
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
				this.element.style.right = `${right}px`;
				domUpdated = true;
			}
			if (this.lastLeft !== -1) {
				this.lastLeft = -1;
				this.element.style.left = '';
			}
		} else {
			if (this.lastLeft !== left) {
				this.lastLeft = left;
				this.element.style.left = `${left}px`;
				domUpdated = true;
			}
			if (this.lastRight !== -1) {
				this.lastRight = -1;
				this.element.style.right = '';
			}
		}

		if (this.lastWidth !== width) {
			this.lastWidth = width;
			this.element.style.width = `${width}px`;
			cellSlotWriteStats.cellWidthWrites++;
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

		this.lastRawValue = rawValue;

		// Phase 4: compare against JS-side cache only — no DOM read.
		// lastFormattedValue is always kept in sync with contentElement.textContent.
		if (contentMode === 'text' || contentMode === 'fallback') {
			if (this.lastFormattedValue !== formattedValue) {
				this.lastFormattedValue = formattedValue;
				this.contentElement.textContent = formattedValue;
				cellSlotWriteStats.cellTextWrites++;
				domUpdated = true;
			} else {
				cellSlotWriteStats.cellDomReadsAvoided++;
			}
		} else {
			if (this.lastFormattedValue !== '') {
				this.lastFormattedValue = '';
				this.contentElement.textContent = '';
				cellSlotWriteStats.cellTextWrites++;
				domUpdated = true;
			} else {
				cellSlotWriteStats.cellDomReadsAvoided++;
			}
		}

		return domUpdated;
	}

	public updatePosition(left: number): boolean {
		let domUpdated = false;
		if (this.lastLeft !== left) {
			this.lastLeft = left;
			this.element.style.left = `${left}px`;
			domUpdated = true;
		}
		if (this.lastRight !== -1) {
			this.lastRight = -1;
			this.element.style.right = '';
			domUpdated = true;
		}
		return domUpdated;
	}

	public unbindHot(): void {
		this.colIndex = -1;
		this.colField = '';
		this.rowIndex = -1;
		this.rowId = '';
		this.lastRawValue = undefined;
		this.lastPortalKey = undefined;
		delete this.element.dataset.cellKey;
		delete this.element.dataset.contentMode;
		// Phase 4: use JS-side flag to skip DOM read in hot path
		if (this.hasTabIndex) {
			this.element.removeAttribute('tabindex');
			this.hasTabIndex = false;
		}
	}

	public unbindCold(): void {
		this.lastRawValue = undefined;
		this.lastFormattedValue = undefined;
		this.lastLeft = -1;
		this.lastRight = -1;
		this.lastWidth = -1;
		this.lastClassName = '';
		this.lastContentMode = 'empty';
		this.lastPortalKey = undefined;
		this.hasTabIndex = false;
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
