import { CellSlot } from './cellSlot.js';

export class RowSlot<TRowData = unknown> {
	public readonly id: string; // The pool ID e.g. 'row-pool-1'
	public readonly element: HTMLDivElement;
	public readonly leftElement?: HTMLDivElement;
	public readonly rightElement?: HTMLDivElement;

	public visualIndex = -1;
	public visualRowId = '';
	public rowKind: 'data' | 'group' | 'detail' | 'loading' | 'footer' | '' = '';
	public rowTop = -1;
	public rowHeight = -1;

	// Cached classes to avoid redundant writes
	public lastClassName = '';
	public lastLeftClassName = '';
	public lastRightClassName = '';

	// Cached transforms
	public lastTransform = '';
	public lastLeftTransform = '';
	public lastRightTransform = '';

	// Cached heights
	public lastHeight = '';
	public lastLeftHeight = '';
	public lastRightHeight = '';

	public keepAlive = false;

	// Active cell slots inside this row: colIndex -> CellSlot
	public readonly cells = new Map<number, CellSlot<TRowData>>();

	constructor(id: string, element: HTMLDivElement, leftElement?: HTMLDivElement, rightElement?: HTMLDivElement) {
		this.id = id;
		this.element = element;
		this.leftElement = leftElement;
		this.rightElement = rightElement;
	}

	/**
	 * Updates the row slot parameters. Prevents DOM writes if values match.
	 */
	public update(
		visualIndex: number,
		visualRowId: string,
		rowKind: 'data' | 'group' | 'detail' | 'loading' | 'footer',
		rowTop: number,
		rowHeight: number,
		className: string
	): boolean {
		let domUpdated = false;

		this.visualIndex = visualIndex;
		this.visualRowId = visualRowId;
		this.rowKind = rowKind;
		this.rowTop = rowTop;
		this.rowHeight = rowHeight;

		const nextTransform = `translate3d(0, ${rowTop}px, 0)`;
		const nextHeight = `${rowHeight}px`;
		const indexStr = String(visualIndex);

		// 1. Center Element
		if (this.lastTransform !== nextTransform) {
			this.lastTransform = nextTransform;
			this.element.style.transform = nextTransform;
			domUpdated = true;
		}
		if (this.lastHeight !== nextHeight) {
			this.lastHeight = nextHeight;
			this.element.style.height = nextHeight;
			domUpdated = true;
		}
		if (this.element.dataset.rowIndex !== indexStr) {
			this.element.dataset.rowIndex = indexStr;
			domUpdated = true;
		}
		if (this.element.dataset.rowId !== visualRowId) {
			this.element.dataset.rowId = visualRowId;
			domUpdated = true;
		}
		if (this.lastClassName !== className) {
			this.lastClassName = className;
			this.element.className = className;
			domUpdated = true;
		}

		// 2. Left Element
		if (this.leftElement) {
			if (this.lastLeftTransform !== nextTransform) {
				this.lastLeftTransform = nextTransform;
				this.leftElement.style.transform = nextTransform;
				domUpdated = true;
			}
			if (this.lastLeftHeight !== nextHeight) {
				this.lastLeftHeight = nextHeight;
				this.leftElement.style.height = nextHeight;
				domUpdated = true;
			}
			if (this.leftElement.dataset.rowIndex !== indexStr) {
				this.leftElement.dataset.rowIndex = indexStr;
				domUpdated = true;
			}
			if (this.leftElement.dataset.rowId !== visualRowId) {
				this.leftElement.dataset.rowId = visualRowId;
				domUpdated = true;
			}
			if (this.lastLeftClassName !== className) {
				this.lastLeftClassName = className;
				this.leftElement.className = className;
				domUpdated = true;
			}
		}

		// 3. Right Element
		if (this.rightElement) {
			if (this.lastRightTransform !== nextTransform) {
				this.lastRightTransform = nextTransform;
				this.rightElement.style.transform = nextTransform;
				domUpdated = true;
			}
			if (this.lastRightHeight !== nextHeight) {
				this.lastRightHeight = nextHeight;
				this.rightElement.style.height = nextHeight;
				domUpdated = true;
			}
			if (this.rightElement.dataset.rowIndex !== indexStr) {
				this.rightElement.dataset.rowIndex = indexStr;
				domUpdated = true;
			}
			if (this.rightElement.dataset.rowId !== visualRowId) {
				this.rightElement.dataset.rowId = visualRowId;
				domUpdated = true;
			}
			if (this.lastRightClassName !== className) {
				this.lastRightClassName = className;
				this.rightElement.className = className;
				domUpdated = true;
			}
		}

		return domUpdated;
	}

	/**
	 * Hot release (used during scroll). Detaches cells but keeps the row node in the pool.
	 */
	public unbindHot(): void {
		this.visualIndex = -1;
		this.visualRowId = '';
		this.rowKind = '';
		this.rowTop = -1;
		this.rowHeight = -1;
		this.keepAlive = false;

		// Unbind all cells
		for (const cell of this.cells.values()) {
			cell.unbind();
		}
		this.cells.clear();
	}

	/**
	 * Cold release. Thoroughly sanitizes and clears the elements.
	 */
	public destroyCold(): void {
		this.unbindHot();

		this.lastClassName = '';
		this.lastLeftClassName = '';
		this.lastRightClassName = '';

		this.lastTransform = '';
		this.lastLeftTransform = '';
		this.lastRightTransform = '';

		this.lastHeight = '';
		this.lastLeftHeight = '';
		this.lastRightHeight = '';

		// Clean up center element
		this.element.className = '';
		this.element.removeAttribute('style');
		delete this.element.dataset.rowIndex;
		delete this.element.dataset.rowId;
		delete this.element.dataset.rowKey;
		this.element.textContent = '';

		// Clean up left element
		if (this.leftElement) {
			this.leftElement.className = '';
			this.leftElement.removeAttribute('style');
			delete this.leftElement.dataset.rowIndex;
			delete this.leftElement.dataset.rowId;
			delete this.leftElement.dataset.rowKey;
			this.leftElement.textContent = '';
		}

		// Clean up right element
		if (this.rightElement) {
			this.rightElement.className = '';
			this.rightElement.removeAttribute('style');
			delete this.rightElement.dataset.rowIndex;
			delete this.rightElement.dataset.rowId;
			delete this.rightElement.dataset.rowKey;
			this.rightElement.textContent = '';
		}
	}
}
