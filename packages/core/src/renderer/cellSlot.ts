export type CellContentMode = 'text' | 'portal' | 'loading' | 'empty' | 'fallback' | 'pending';

export class CellSlot<TRowData = unknown> {
	public readonly element: HTMLDivElement;
	public readonly contentElement: HTMLDivElement;
	public readonly portalHostElement: HTMLDivElement;
	public skeleton: HTMLElement | null = null;

	// Position
	public colIndex = -1;
	public colField = '';
	public rowIndex = -1;
	public rowId = '';

	// Cached DOM states
	public lastRawValue: unknown = undefined;
	public lastFormattedValue: string | undefined = undefined;
	public lastTransform = '';
	public lastWidth = '';
	public lastClassName = '';
	public lastContentMode: CellContentMode = 'empty';
	public lastPortalKey: string | undefined = undefined;

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
		this.lastTransform = '';
		this.lastWidth = '';
		this.lastClassName = '';
		this.lastContentMode = 'empty';
		this.lastPortalKey = undefined;
		this.colIndex = -1;
		this.colField = '';
		this.rowIndex = -1;
		this.rowId = '';
		if (this.skeleton) {
			this.skeleton.remove();
			this.skeleton = null;
		}
	}

	/**
	 * Binds the cell slot to new parameters. Prevents DOM writes if values match.
	 */
	public update(
		colIndex: number,
		colField: string,
		rowIndex: number,
		rowId: string,
		transform: string,
		width: string,
		className: string,
		contentMode: CellContentMode,
		rawValue: unknown,
		formattedValue: string,
		portalKey?: string
	): boolean {
		let domUpdated = false;

		// 1. Position update
		if (this.colIndex !== colIndex) {
			this.colIndex = colIndex;
		}
		if (this.colField !== colField) {
			this.colField = colField;
			if (this.element.dataset.colField !== colField) {
				this.element.dataset.colField = colField;
				domUpdated = true;
			}
		}
		if (this.rowIndex !== rowIndex) {
			this.rowIndex = rowIndex;
			const rowIndexText = String(rowIndex);
			if (this.element.dataset.rowIndex !== rowIndexText) {
				this.element.dataset.rowIndex = rowIndexText;
				domUpdated = true;
			}
		}
		if (this.rowId !== rowId) {
			this.rowId = rowId;
			if (this.element.dataset.rowId !== rowId) {
				this.element.dataset.rowId = rowId;
				domUpdated = true;
			}
		}

		// 2. Transform (translate3d)
		if (this.lastTransform !== transform) {
			this.lastTransform = transform;
			this.element.style.transform = transform;
			domUpdated = true;
		}

		// 3. Width
		if (this.lastWidth !== width) {
			this.lastWidth = width;
			this.element.style.width = width;
			domUpdated = true;
		}

		// 4. ClassName
		if (this.lastClassName !== className) {
			this.lastClassName = className;
			this.element.className = className;
			domUpdated = true;
		}

		// 5. Content Mode
		if (this.lastContentMode !== contentMode) {
			this.lastContentMode = contentMode;
			this.element.dataset.contentMode = contentMode;
			domUpdated = true;
		}

		// 6. Portal key datasets
		if (this.lastPortalKey !== portalKey) {
			this.lastPortalKey = portalKey;
			if (portalKey) {
				this.element.dataset.cellKey = portalKey;
			} else {
				delete this.element.dataset.cellKey;
			}
			domUpdated = true;
		}

		// 7. Value update
		this.lastRawValue = rawValue;

		if (contentMode === 'text' || contentMode === 'fallback') {
			if (this.lastFormattedValue !== formattedValue) {
				this.lastFormattedValue = formattedValue;
				if (this.contentElement.textContent !== formattedValue) {
					this.contentElement.textContent = formattedValue;
					domUpdated = true;
				}
			}
		} else if (contentMode === 'empty' || contentMode === 'portal' || contentMode === 'pending') {
			if (this.lastFormattedValue !== '') {
				this.lastFormattedValue = '';
				if (this.contentElement.textContent !== '') {
					this.contentElement.textContent = '';
					domUpdated = true;
				}
			}
		} else if (contentMode === 'loading') {
			if (this.lastFormattedValue !== '') {
				this.lastFormattedValue = '';
				if (this.contentElement.textContent !== '') {
					this.contentElement.textContent = '';
					domUpdated = true;
				}
			}
		}

		return domUpdated;
	}

	public unbind(): void {
		this.lastRawValue = undefined;
		this.lastFormattedValue = undefined;
		this.lastTransform = '';
		this.lastWidth = '';
		this.lastClassName = '';
		this.lastContentMode = 'empty';
		this.lastPortalKey = undefined;
		this.colIndex = -1;
		this.colField = '';
		this.rowIndex = -1;
		this.rowId = '';
		if (this.skeleton) {
			this.skeleton.remove();
			this.skeleton = null;
		}

		// Sanitise DOM elements
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
