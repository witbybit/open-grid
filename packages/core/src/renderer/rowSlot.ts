import { CellSlot } from './cellSlot.js';

export class RowSlot<TRowData = unknown> {
	public readonly id: string;
	public readonly element: HTMLDivElement;

	public visualIndex = -1;
	public visualRowId = '';
	public rowKind: 'data' | 'group' | 'detail' | 'loading' | 'footer' | '' = '';
	public rowTop = -1;
	public rowHeight = -1;

	// Integer comparisons are faster than string comparisons
	public lastTop = -1;
	public lastHeight = -1;
	public lastClassName = '';

	public keepAlive = false;

	// Active cell slots inside this row: colIndex -> CellSlot
	public readonly cells = new Map<number, CellSlot<TRowData>>();

	constructor(id: string, element: HTMLDivElement) {
		this.id = id;
		this.element = element;
	}

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

		if (this.lastTop !== rowTop) {
			this.lastTop = rowTop;
			this.element.style.top = `${rowTop}px`;
			domUpdated = true;
		}
		if (this.lastHeight !== rowHeight) {
			this.lastHeight = rowHeight;
			this.element.style.height = `${rowHeight}px`;
			domUpdated = true;
		}

		const indexStr = String(visualIndex);
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

		return domUpdated;
	}

	public updatePosition(rowTop: number): void {
		this.rowTop = rowTop;
		if (this.lastTop !== rowTop) {
			this.lastTop = rowTop;
			this.element.style.top = `${rowTop}px`;
		}
	}

	public unbindHot(): void {
		this.visualIndex = -1;
		this.visualRowId = '';
		this.rowKind = '';
		this.rowTop = -1;
		this.rowHeight = -1;
		this.keepAlive = false;

		for (const cell of this.cells.values()) {
			cell.unbindHot();
		}
		this.cells.clear();
	}

	public destroyCold(): void {
		this.visualIndex = -1;
		this.visualRowId = '';
		this.rowKind = '';
		this.rowTop = -1;
		this.rowHeight = -1;
		this.keepAlive = false;
		this.lastTop = -1;
		this.lastHeight = -1;
		this.lastClassName = '';

		for (const cell of this.cells.values()) {
			cell.unbindCold();
		}
		this.cells.clear();

		this.element.className = '';
		this.element.removeAttribute('style');
		delete this.element.dataset.rowIndex;
		delete this.element.dataset.rowId;
		delete this.element.dataset.rowKey;
		this.element.textContent = '';
	}
}
