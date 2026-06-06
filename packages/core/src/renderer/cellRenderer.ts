import type { InvalidationFrame } from './invalidationManager.js';
import { CellSlot } from './cellSlot.js';

export class CellRenderer {
	private readonly syncCells: (frame: InvalidationFrame) => void;

	constructor(syncCells: (frame: InvalidationFrame) => void) {
		this.syncCells = syncCells;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncCells(frame);
	}

	public initializeCell(cell: HTMLElement): void {
		CellSlot.fromElement(cell as HTMLDivElement);
	}

	public getOrCreateCellContentLayer(cell: HTMLElement): HTMLElement {
		return CellSlot.fromElement(cell as HTMLDivElement).contentElement;
	}

	public getOrCreatePortalHost(cell: HTMLElement): HTMLElement {
		return CellSlot.fromElement(cell as HTMLDivElement).portalHostElement;
	}

	public getPortalHost(cell: HTMLElement): HTMLElement | null {
		return CellSlot.fromElement(cell as HTMLDivElement).portalHostElement;
	}

	public setPrimitiveContent(cell: HTMLElement, value: string, mode: 'primitive' | 'fallback' = 'primitive'): void {
		const slot = CellSlot.fromElement(cell as HTMLDivElement);
		slot.element.dataset.contentMode = mode === 'primitive' ? 'text' : mode;
		slot.lastContentMode = mode === 'primitive' ? 'text' : mode;
		if (slot.contentElement.textContent !== value) {
			slot.contentElement.textContent = value;
		}
	}

	public clearPrimitiveContent(cell: HTMLElement): void {
		this.setPrimitiveContent(cell, '');
	}

	public showPortalContent(cell: HTMLElement): void {
		const slot = CellSlot.fromElement(cell as HTMLDivElement);
		slot.element.dataset.contentMode = 'portal';
		slot.lastContentMode = 'portal';
	}

	public showPendingContent(cell: HTMLElement): void {
		const slot = CellSlot.fromElement(cell as HTMLDivElement);
		slot.element.dataset.contentMode = 'pending';
		slot.lastContentMode = 'pending';
		if (slot.contentElement.textContent !== '') {
			slot.contentElement.textContent = '';
		}
	}

	public ensureLoadingSkeleton(cell: HTMLElement): void {
		const slot = CellSlot.fromElement(cell as HTMLDivElement);
		slot.element.dataset.contentMode = 'loading';
		slot.lastContentMode = 'loading';
		if (slot.contentElement.textContent !== '') {
			slot.contentElement.textContent = '';
		}
	}

	public removeLoadingSkeleton(cell: HTMLElement): void {
		const slot = CellSlot.fromElement(cell as HTMLDivElement);
		slot.element.dataset.contentMode = 'text';
		slot.lastContentMode = 'text';
	}
}
