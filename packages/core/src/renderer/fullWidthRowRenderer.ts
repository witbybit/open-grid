import type { VisualRow } from '../store.js';
import type { RowSlot } from './rowSlot.js';
import type { PortalMountManager } from './portalMountManager.js';

/**
 * Phase 7 — Real full-width row renderer.
 *
 * Owns full-width row host management for group, detail, footer, and loading full-width
 * rows. RowSlot delegates to this when the row kind is not 'data'.
 *
 * Responsibilities:
 *  - Manage the row portal host inside the slot element.
 *  - Mount / update the row portal via PortalMountManager.
 *  - Release the row portal when the slot rebinds or is destroyed.
 *  - Support mode transitions: cells → full-width and full-width → cells without
 *    replacing the row shell DOM element.
 */
export class FullWidthRowRenderer<TRowData = unknown> {
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private readonly rowPortalHosts: WeakMap<HTMLElement, HTMLElement>;

	constructor(portalMountManager: PortalMountManager<TRowData>, rowPortalHosts: WeakMap<HTMLElement, HTMLElement>) {
		this.portalMountManager = portalMountManager;
		this.rowPortalHosts = rowPortalHosts;
	}

	/**
	 * Bind a slot to a full-width visual row (group / detail / footer / loading-fw).
	 * Collapses all cell lanes to zero (releasing any cell portals via the provided
	 * release callbacks), then mounts the row portal.
	 *
	 * The row shell DOM element (slot.element) is NOT replaced — only the content changes.
	 */
	public bind(
		slot: RowSlot<TRowData>,
		visualRow: VisualRow<TRowData>,
		onCollapseLanes: (slot: RowSlot<TRowData>) => void,
		onReleaseRowPortal: (slot: RowSlot<TRowData>) => void
	): void {
		// Collapse all lanes — any previously mounted cell portals are released by the caller.
		onCollapseLanes(slot);

		const rowKey = visualRow.id;
		if (slot.element.dataset.rowKey !== rowKey) {
			onReleaseRowPortal(slot);
			slot.element.dataset.rowKey = rowKey;
		}

		const host = this.ensureRowPortalHost(slot.element);
		host.hidden = false;
		host.dataset.rowKey = rowKey;
		this.portalMountManager.mountRow({ rowKey, container: host, visualRow });
	}

	/**
	 * Release the row portal for a slot transitioning away from full-width mode.
	 * Hides and removes the portal host from the slot element.
	 */
	public release(slot: RowSlot<TRowData>): boolean {
		const rowKey = slot.element.dataset.rowKey;
		if (!rowKey) return false;
		const host = this.rowPortalHosts.get(slot.element);
		if (!host) {
			delete slot.element.dataset.rowKey;
			return false;
		}
		this.portalMountManager.releaseRow({ rowKey, container: host });
		host.hidden = true;
		delete host.dataset.rowKey;
		host.remove();
		delete slot.element.dataset.rowKey;
		return true;
	}

	// ── Internal ─────────────────────────────────────────────────────────────────

	private ensureRowPortalHost(row: HTMLElement): HTMLElement {
		let host = this.rowPortalHosts.get(row);
		if (!host) {
			host = document.createElement('div');
			host.className = 'og-row-portal-host';
			host.hidden = true;
			row.appendChild(host);
			this.rowPortalHosts.set(row, host);
		} else if (host.parentElement !== row) {
			row.appendChild(host);
		}
		return host;
	}
}
