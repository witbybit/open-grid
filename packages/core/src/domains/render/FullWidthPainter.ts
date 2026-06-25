import type { VisualRow } from '../pipeline/VisualRow.js';
import type { RowId } from '../rows/RowId.js';

/**
 * Renders full-width rows (group headers, loading rows, placeholder rows, detail rows)
 * as a single DOM element spanning the entire grid width, absolutely positioned in the
 * virtual scroll container — exactly like the pinned-column cells but for the whole row.
 *
 * This is a lightweight companion to DomGridRenderer: it handles only the non-data-row
 * kinds so the main renderer can delegate full-width painting here.
 */

export interface FullWidthRowConfig {
	/** Called to produce the content element for a group row. */
	renderGroupRow?: (row: VisualRow & { kind: 'group' }) => HTMLElement | null;
	/** Called to produce the content element for a detail row. */
	renderDetailRow?: (row: VisualRow & { kind: 'detail' }) => HTMLElement | null;
	/** Called to produce the content element for a loading row. */
	renderLoadingRow?: (row: VisualRow & { kind: 'loading' }) => HTMLElement | null;
}

export interface FullWidthSlot {
	readonly rowId: RowId | null;
	readonly el: HTMLElement;
	kind: VisualRow['kind'];
}

export class FullWidthPainter {
	private readonly container: HTMLElement;
	private readonly slots = new Map<string, FullWidthSlot>(); // visualRowId → slot
	private readonly config: FullWidthRowConfig;

	constructor(container: HTMLElement, config: FullWidthRowConfig = {}) {
		this.container = container;
		this.config = config;
	}

	/**
	 * Paint a full-width row at the given absolute top position.
	 * Creates a slot element if one doesn't exist for this visual row ID.
	 */
	paint(row: VisualRow, top: number, height: number, width: number): void {
		if (row.kind === 'data' || row.kind === 'tree') return; // handled by DomGridRenderer

		const slotId = String(row.visualRowId);
		let slot = this.slots.get(slotId);

		if (!slot) {
			const el = document.createElement('div');
			el.className = `og-full-width-row og-full-width-row--${row.kind}`;
			el.style.cssText = 'position:absolute;left:0;box-sizing:border-box;width:100%;contain:layout style';
			this.container.appendChild(el);

			const rowId = 'rowId' in row ? (row.rowId as RowId) : null;
			slot = { rowId, el, kind: row.kind };
			this.slots.set(slotId, slot);
		}

		// Position
		slot.el.style.top = `${top}px`;
		slot.el.style.height = `${height}px`;
		slot.el.style.width = `${width}px`;

		// Paint content if kind changed or first paint
		if (slot.kind !== row.kind || slot.el.childElementCount === 0) {
			slot.el.textContent = '';
			slot.kind = row.kind;
			const content = this._renderContent(row);
			if (content) slot.el.appendChild(content);
		}
	}

	/** Remove slots no longer in the visual model. */
	gc(activeVisualRowIds: ReadonlySet<string>): void {
		for (const [id, slot] of this.slots) {
			if (!activeVisualRowIds.has(id)) {
				slot.el.remove();
				this.slots.delete(id);
			}
		}
	}

	unmount(): void {
		for (const slot of this.slots.values()) slot.el.remove();
		this.slots.clear();
	}

	private _renderContent(row: VisualRow): HTMLElement | null {
		switch (row.kind) {
			case 'group':
				return this.config.renderGroupRow?.(row as VisualRow & { kind: 'group' }) ?? null;
			case 'detail':
				return this.config.renderDetailRow?.(row as VisualRow & { kind: 'detail' }) ?? null;
			case 'loading':
				return this.config.renderLoadingRow?.(row as VisualRow & { kind: 'loading' }) ?? defaultLoadingEl();
			case 'placeholder': {
				const el = document.createElement('div');
				el.className = 'og-placeholder-row';
				return el;
			}
			default:
				return null;
		}
	}
}

function defaultLoadingEl(): HTMLElement {
	const el = document.createElement('div');
	el.className = 'og-loading-row';
	el.style.cssText = 'display:flex;align-items:center;padding:0 16px;height:100%;color:var(--og-cell-text-muted,#999);font-size:13px';
	el.textContent = 'Loading…';
	return el;
}
