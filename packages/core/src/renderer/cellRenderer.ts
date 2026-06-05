import type { InvalidationFrame } from './invalidationManager.js';

export class CellRenderer {
	private readonly syncCells: (frame: InvalidationFrame) => void;
	private readonly cellParts = new WeakMap<
		HTMLElement,
		{
			content: HTMLElement;
			portalHost: HTMLElement;
			skeleton: HTMLElement | null;
		}
	>();

	constructor(syncCells: (frame: InvalidationFrame) => void) {
		this.syncCells = syncCells;
	}

	public sync(frame: InvalidationFrame): void {
		this.syncCells(frame);
	}

	public initializeCell(cell: HTMLElement): void {
		this.ensureCellParts(cell);
	}

	public getOrCreateCellContentLayer(cell: HTMLElement): HTMLElement {
		return this.ensureCellParts(cell).content;
	}

	public getOrCreatePortalHost(cell: HTMLElement): HTMLElement {
		return this.ensureCellParts(cell).portalHost;
	}

	public getPortalHost(cell: HTMLElement): HTMLElement | null {
		return this.cellParts.get(cell)?.portalHost ?? null;
	}

	private ensureCellParts(cell: HTMLElement): { content: HTMLElement; portalHost: HTMLElement; skeleton: HTMLElement | null } {
		let parts = this.cellParts.get(cell);
		if (!parts) {
			parts = {
				content: document.createElement('div'),
				portalHost: document.createElement('div'),
				skeleton: null,
			};
			parts.content.className = 'og-cell-content';
			parts.portalHost.className = 'og-cell-portal-host';
			this.cellParts.set(cell, parts);
		}

		if (parts.content.parentElement !== cell) {
			cell.appendChild(parts.content);
		}
		if (parts.portalHost.parentElement !== cell) {
			cell.appendChild(parts.portalHost);
		}
		return parts;
	}

	public setPrimitiveContent(cell: HTMLElement, value: string, mode: 'primitive' | 'fallback' = 'primitive'): void {
		cell.dataset.contentMode = mode;
		const content = this.ensureCellParts(cell).content;
		if (content.textContent !== value) {
			content.textContent = value;
			const parts = this.ensureCellParts(cell);
			parts.skeleton = null;
		}
	}

	public clearPrimitiveContent(cell: HTMLElement): void {
		this.setPrimitiveContent(cell, '');
	}

	public showPortalContent(cell: HTMLElement): void {
		cell.dataset.contentMode = 'portal';
	}

	public ensureLoadingSkeleton(cell: HTMLElement): void {
		cell.dataset.contentMode = 'loading';
		const parts = this.ensureCellParts(cell);
		if (!parts.skeleton || parts.skeleton.parentElement !== parts.content) {
			parts.content.textContent = '';
			const skeleton = document.createElement('div');
			skeleton.className = 'og-cell-loading-skeleton';
			parts.content.appendChild(skeleton);
			parts.skeleton = skeleton;
		}
	}

	public removeLoadingSkeleton(cell: HTMLElement): void {
		const parts = this.ensureCellParts(cell);
		if (parts.skeleton) {
			parts.skeleton.remove();
			parts.skeleton = null;
		}
	}
}
