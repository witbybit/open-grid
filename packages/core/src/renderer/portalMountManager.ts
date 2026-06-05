import type {
	GridCellContentMount,
	GridCellContentUnmount,
	GridHeaderMenuMount,
	GridHeaderMenuUnmount,
	GridRowContentMount,
	GridRowContentUnmount,
} from './IGridRenderer.js';

export interface DeferredPortalFlushOptions {
	maxItems?: number;
	reason?: string;
	flushSync?: boolean;
}

export interface DeferredPortalFlushResult {
	processed: number;
	remaining: number;
}

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
	private deferredCellMounts = new Map<string, GridCellContentMount<TRowData>>();
	private deferredCellReleases = new Map<string, GridCellContentUnmount>();
	private deferredNewCellMounts = new Set<string>();
	private deferredRowMounts = new Map<string, GridRowContentMount<TRowData>>();
	private deferredRowReleases = new Map<string, GridRowContentUnmount>();
	private scrolling = false;
	private stats = {
		flushesDuringScroll: 0,
		mountsDuringScroll: 0,
		releasesDuringScroll: 0,
		deferredDuringScroll: 0,
		flushChunks: 0,
		maxOpsFlushedInOneChunk: 0,
	};

	public mountCell(mount: GridCellContentMount<TRowData>): void {
		const wasMounted = this.mountedCells.has(mount.cellKey);
		this.mountedCells.set(mount.cellKey, mount.container);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
			this.stats.deferredDuringScroll++;
			this.deferredCellReleases.delete(mount.cellKey);
			this.deferredCellMounts.set(mount.cellKey, mount);
			if (!wasMounted) {
				this.deferredNewCellMounts.add(mount.cellKey);
			}
			return;
		}
		this.onMountCellContent?.(mount);
	}

	public releaseCell(unmount: GridCellContentUnmount): void {
		const existingContainer = this.mountedCells.get(unmount.cellKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedCells.delete(unmount.cellKey);
		if (this.scrolling) {
			this.stats.releasesDuringScroll++;
			this.stats.deferredDuringScroll++;
			const canceledDeferredMount = this.deferredCellMounts.delete(unmount.cellKey);
			const wasNewDeferredMount = this.deferredNewCellMounts.delete(unmount.cellKey);
			if (canceledDeferredMount && wasNewDeferredMount) return;
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
				this.stats.deferredDuringScroll++;
				const canceledDeferredMount = this.deferredCellMounts.delete(unmount.cellKey);
				const wasNewDeferredMount = this.deferredNewCellMounts.delete(unmount.cellKey);
				if (canceledDeferredMount && wasNewDeferredMount) continue;
				this.deferredCellReleases.set(unmount.cellKey, { ...unmount, flushSync: false });
				continue;
			}
			this.onUnmountCellContent?.({ ...unmount, flushSync: false });
		}
		if (flushSync) {
			if (this.scrolling) {
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
				this.stats.deferredDuringScroll++;
				this.deferredCellReleases.set(cellKey, { ...unmount, flushSync: false });
			}
			this.pendingCellReleases.clear();
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

	public flushDeferred(options: DeferredPortalFlushOptions | boolean = {}): DeferredPortalFlushResult {
		const normalized = typeof options === 'boolean' ? { flushSync: options } : options;
		const maxItems = normalized.maxItems ?? Number.POSITIVE_INFINITY;
		const flushSync = normalized.flushSync ?? false;
		const pendingBefore = this.getDeferredCount();
		if (pendingBefore === 0 || maxItems <= 0) {
			return { processed: 0, remaining: pendingBefore };
		}

		const wasScrolling = this.scrolling;
		this.scrolling = false;
		let processed = 0;

		for (const [cellKey, unmount] of Array.from(this.deferredCellReleases)) {
			if (processed >= maxItems) break;
			this.onUnmountCellContent?.({ ...unmount, flushSync: false });
			this.deferredCellReleases.delete(cellKey);
			processed++;
		}
		for (const [cellKey, mount] of Array.from(this.deferredCellMounts)) {
			if (processed >= maxItems) break;
			this.onMountCellContent?.(mount);
			this.deferredCellMounts.delete(cellKey);
			this.deferredNewCellMounts.delete(cellKey);
			processed++;
		}
		for (const [rowKey, unmount] of Array.from(this.deferredRowReleases)) {
			if (processed >= maxItems) break;
			this.onUnmountRowContent?.(unmount);
			this.deferredRowReleases.delete(rowKey);
			processed++;
		}
		for (const [rowKey, mount] of Array.from(this.deferredRowMounts)) {
			if (processed >= maxItems) break;
			this.onMountRowContent?.(mount);
			this.deferredRowMounts.delete(rowKey);
			processed++;
		}

		const remaining = this.getDeferredCount();
		if (processed > 0) {
			this.stats.flushChunks++;
			this.stats.maxOpsFlushedInOneChunk = Math.max(this.stats.maxOpsFlushedInOneChunk, processed);
		}
		if (flushSync && remaining === 0) {
			this.onFlushCellContent?.({ flushSync: true });
		}
		this.scrolling = wasScrolling;
		return { processed, remaining };
	}

	public mountRow(mount: GridRowContentMount<TRowData>): void {
		this.mountedRows.set(mount.rowKey, mount.container);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
			this.stats.deferredDuringScroll++;
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
			this.stats.deferredDuringScroll++;
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
		this.deferredCellMounts.clear();
		this.deferredCellReleases.clear();
		this.deferredNewCellMounts.clear();
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

	public getDeferredCount(): number {
		return this.deferredCellReleases.size + this.deferredCellMounts.size + this.deferredRowReleases.size + this.deferredRowMounts.size;
	}

	public getScrollStats(): {
		portalFlushesDuringScroll: number;
		portalDeferredDuringScroll: number;
		portalMountsDuringScroll: number;
		portalReleasesDuringScroll: number;
		portalFlushChunks: number;
		maxPortalOpsFlushedInOneChunk: number;
	} {
		return {
			portalFlushesDuringScroll: this.stats.flushesDuringScroll,
			portalDeferredDuringScroll: this.stats.deferredDuringScroll,
			portalMountsDuringScroll: this.stats.mountsDuringScroll,
			portalReleasesDuringScroll: this.stats.releasesDuringScroll,
			portalFlushChunks: this.stats.flushChunks,
			maxPortalOpsFlushedInOneChunk: this.stats.maxOpsFlushedInOneChunk,
		};
	}

	public resetStats(): void {
		this.stats.flushesDuringScroll = 0;
		this.stats.mountsDuringScroll = 0;
		this.stats.releasesDuringScroll = 0;
		this.stats.deferredDuringScroll = 0;
		this.stats.flushChunks = 0;
		this.stats.maxOpsFlushedInOneChunk = 0;
	}
}
