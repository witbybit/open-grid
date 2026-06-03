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

	public mountCell(mount: GridCellContentMount<TRowData>): void {
		this.mountedCells.set(mount.cellKey, mount.container);
		this.onMountCellContent?.(mount);
	}

	public releaseCell(unmount: GridCellContentUnmount): void {
		const existingContainer = this.mountedCells.get(unmount.cellKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedCells.delete(unmount.cellKey);
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
			this.onUnmountCellContent?.({ ...unmount, flushSync: false });
		}
		if (flushSync) {
			this.onFlushCellContent?.({ flushSync: true });
		}
	}

	public beginCellReleaseTransaction(): void {
		this.cellReleaseTransactionDepth++;
	}

	public flushCellReleaseTransaction(flushSync = true): void {
		if (this.pendingCellReleases.size === 0) return;
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

	public mountRow(mount: GridRowContentMount<TRowData>): void {
		this.mountedRows.set(mount.rowKey, mount.container);
		this.onMountRowContent?.(mount);
	}

	public releaseRow(unmount: GridRowContentUnmount): void {
		const existingContainer = this.mountedRows.get(unmount.rowKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedRows.delete(unmount.rowKey);
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
}
