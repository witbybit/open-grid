import type {
	GridCellContentMount,
	GridCellContentUnmount,
	GridHeaderMenuMount,
	GridHeaderMenuUnmount,
	GridRowContentMount,
	GridRowContentUnmount,
} from './IGridRenderer.js';

export class PortalMountManager<TRowData = unknown> {
	public onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	public onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;
	public onFlushCellContent?: (flush: { flushSync?: boolean }) => void;
	public onMountRowContent?: (mount: GridRowContentMount<TRowData>) => void;
	public onUnmountRowContent?: (unmount: GridRowContentUnmount) => void;
	public onMountHeaderMenu?: (mount: GridHeaderMenuMount<TRowData>) => void;
	public onUnmountHeaderMenu?: (unmount: GridHeaderMenuUnmount) => void;

	private mountedCells = new Map<string, HTMLElement | undefined>();
	private mountedRows = new Map<string, HTMLElement | undefined>();
	private mountedMenus = new Map<string, HTMLElement | undefined>();
	private cellReleaseTransactionDepth = 0;
	private pendingCellReleases = new Map<string, GridCellContentUnmount>();
	private deferredCellReleases = new Map<string, GridCellContentUnmount>();
	private deferredRowMounts = new Map<string, GridRowContentMount<TRowData>>();
	private deferredRowReleases = new Map<string, GridRowContentUnmount>();
	private scrolling = false;
	private stats = {
		flushesDuringScroll: 0,
		mountsDuringScroll: 0,
		releasesDuringScroll: 0,
	};

	public mountCell(mount: GridCellContentMount<TRowData>): void {
		this.mountedCells.set(mount.cellKey, mount.container);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
		}
		this.onMountCellContent?.(mount);
	}

	public releaseCell(unmount: GridCellContentUnmount): void {
		const existingContainer = this.mountedCells.get(unmount.cellKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedCells.delete(unmount.cellKey);
		if (this.scrolling) {
			this.stats.releasesDuringScroll++;
			this.deferredCellReleases.set(unmount.cellKey, { ...unmount, flushSync: false });
			return;
		}
		if (this.cellReleaseTransactionDepth > 0) {
			this.pendingCellReleases.set(unmount.cellKey, { ...unmount, flushSync: false });
			return;
		}
		this.onUnmountCellContent?.(unmount);
	}

	public releaseCells(unmounts: GridCellContentUnmount[], flushSync = false): void {
		if (unmounts.length === 0) return;
		for (const unmount of unmounts) {
			const existingContainer = this.mountedCells.get(unmount.cellKey);
			if (unmount.container && existingContainer && existingContainer !== unmount.container) continue;
			this.mountedCells.delete(unmount.cellKey);
			if (this.scrolling) {
				this.stats.releasesDuringScroll++;
				this.deferredCellReleases.set(unmount.cellKey, { ...unmount, flushSync: false });
				continue;
			}
			this.onUnmountCellContent?.({ ...unmount, flushSync: false });
		}
		if (flushSync) {
			if (this.scrolling) {
				this.stats.flushesDuringScroll++;
				return;
			}
			this.onFlushCellContent?.({ flushSync: true });
		}
	}

	public beginCellReleaseTransaction(): void {
		this.cellReleaseTransactionDepth++;
	}

	public flushCellReleaseTransaction(flushSync = true): void {
		if (this.pendingCellReleases.size === 0) return;
		if (this.scrolling) {
			for (const [cellKey, unmount] of this.pendingCellReleases) {
				this.stats.releasesDuringScroll++;
				this.deferredCellReleases.set(cellKey, { ...unmount, flushSync: false });
			}
			this.pendingCellReleases.clear();
			if (flushSync) {
				this.stats.flushesDuringScroll++;
			}
			return;
		}
		for (const unmount of this.pendingCellReleases.values()) {
			this.onUnmountCellContent?.({ ...unmount, flushSync: false });
		}
		this.pendingCellReleases.clear();
		if (flushSync) {
			this.onFlushCellContent?.({ flushSync: true });
		}
	}

	public endCellReleaseTransaction(): void {
		if (this.cellReleaseTransactionDepth === 0) return;
		this.cellReleaseTransactionDepth--;
		if (this.cellReleaseTransactionDepth === 0) {
			this.flushCellReleaseTransaction(true);
		}
	}

	public setScrolling(scrolling: boolean): void {
		this.scrolling = scrolling;
	}

	public flushDeferred(flushSync = false): void {
		if (this.deferredCellReleases.size === 0 && this.deferredRowReleases.size === 0 && this.deferredRowMounts.size === 0) return;
		const wasScrolling = this.scrolling;
		this.scrolling = false;
		for (const unmount of this.deferredCellReleases.values()) {
			this.onUnmountCellContent?.({ ...unmount, flushSync: false });
		}
		this.deferredCellReleases.clear();
		for (const unmount of this.deferredRowReleases.values()) {
			this.onUnmountRowContent?.(unmount);
		}
		this.deferredRowReleases.clear();
		for (const mount of this.deferredRowMounts.values()) {
			this.onMountRowContent?.(mount);
		}
		this.deferredRowMounts.clear();
		if (flushSync) {
			this.onFlushCellContent?.({ flushSync: true });
		}
		this.scrolling = wasScrolling;
	}

	public mountRow(mount: GridRowContentMount<TRowData>): void {
		this.mountedRows.set(mount.rowKey, mount.container);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
			this.deferredRowReleases.delete(mount.rowKey);
			this.deferredRowMounts.set(mount.rowKey, mount);
			return;
		}
		this.onMountRowContent?.(mount);
	}

	public releaseRow(unmount: GridRowContentUnmount): void {
		const existingContainer = this.mountedRows.get(unmount.rowKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedRows.delete(unmount.rowKey);
		if (this.scrolling) {
			this.stats.releasesDuringScroll++;
			if (this.deferredRowMounts.delete(unmount.rowKey)) return;
			this.deferredRowReleases.set(unmount.rowKey, unmount);
			return;
		}
		this.onUnmountRowContent?.(unmount);
	}

	public mountHeaderMenu(mount: GridHeaderMenuMount<TRowData>): void {
		this.mountedMenus.set(mount.colField, mount.container);
		this.onMountHeaderMenu?.(mount);
	}

	public releaseHeaderMenu(unmount: GridHeaderMenuUnmount): void {
		const existingContainer = this.mountedMenus.get(unmount.colField);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedMenus.delete(unmount.colField);
		this.onUnmountHeaderMenu?.(unmount);
	}

	public releaseAll(): void {
		this.scrolling = false;
		this.deferredCellReleases.clear();
		this.deferredRowMounts.clear();
		this.deferredRowReleases.clear();
		for (const [cellKey, container] of this.mountedCells) {
			this.onUnmountCellContent?.({ cellKey, container, flushSync: true });
		}
		for (const [rowKey, container] of this.mountedRows) {
			this.onUnmountRowContent?.({ rowKey, container });
		}
		for (const [colField, container] of this.mountedMenus) {
			this.onUnmountHeaderMenu?.({ colField, container });
		}
		this.mountedCells.clear();
		this.mountedRows.clear();
		this.mountedMenus.clear();
	}

	public getStats(): { cells: number; rows: number; menus: number } {
		return {
			cells: this.mountedCells.size,
			rows: this.mountedRows.size,
			menus: this.mountedMenus.size,
		};
	}

	public getScrollStats(): { portalFlushesDuringScroll: number; portalMountsDuringScroll: number; portalReleasesDuringScroll: number } {
		return {
			portalFlushesDuringScroll: this.stats.flushesDuringScroll,
			portalMountsDuringScroll: this.stats.mountsDuringScroll,
			portalReleasesDuringScroll: this.stats.releasesDuringScroll,
		};
	}

	public resetStats(): void {
		this.stats.flushesDuringScroll = 0;
		this.stats.mountsDuringScroll = 0;
		this.stats.releasesDuringScroll = 0;
	}
}
