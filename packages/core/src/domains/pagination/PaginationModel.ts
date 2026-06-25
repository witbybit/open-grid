/**
 * Client-side pagination state. The PaginationModel slices the visual row count
 * into pages and exposes the current page's row window for the renderer to use.
 *
 * For server-side pagination the row model handles page boundaries externally;
 * this model is for client row model only.
 */

export interface PaginationConfig {
	/** Number of rows per page (default 100). */
	pageSize?: number;
	/** Initially shown page, 1-indexed (default 1). */
	initialPage?: number;
}

export class PaginationModel {
	private _pageSize: number;
	private _currentPage: number;
	private _totalRows = 0;
	private readonly listeners = new Set<() => void>();

	constructor(config: PaginationConfig = {}) {
		this._pageSize = config.pageSize ?? 100;
		this._currentPage = config.initialPage ?? 1;
	}

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	get pageSize(): number { return this._pageSize; }
	get currentPage(): number { return this._currentPage; }
	get totalRows(): number { return this._totalRows; }

	get pageCount(): number {
		return this._totalRows <= 0 ? 1 : Math.ceil(this._totalRows / this._pageSize);
	}

	get startRowIndex(): number {
		return (this._currentPage - 1) * this._pageSize;
	}

	get endRowIndex(): number {
		return Math.min(this.startRowIndex + this._pageSize, this._totalRows);
	}

	get hasNextPage(): boolean { return this._currentPage < this.pageCount; }
	get hasPrevPage(): boolean { return this._currentPage > 1; }

	// ---------------------------------------------------------------------------
	// Commands
	// ---------------------------------------------------------------------------

	setTotalRows(count: number): void {
		const changed = this._totalRows !== count;
		this._totalRows = count;
		// Clamp page if necessary
		const maxPage = Math.max(1, this.pageCount);
		if (this._currentPage > maxPage) {
			this._currentPage = maxPage;
		}
		if (changed) this._notify();
	}

	setPageSize(size: number): void {
		if (size <= 0 || size === this._pageSize) return;
		this._pageSize = size;
		this._currentPage = 1;
		this._notify();
	}

	goToPage(page: number): void {
		const clamped = Math.max(1, Math.min(page, this.pageCount));
		if (clamped === this._currentPage) return;
		this._currentPage = clamped;
		this._notify();
	}

	nextPage(): void { this.goToPage(this._currentPage + 1); }
	prevPage(): void { this.goToPage(this._currentPage - 1); }
	firstPage(): void { this.goToPage(1); }
	lastPage(): void { this.goToPage(this.pageCount); }

	// ---------------------------------------------------------------------------
	// Subscription
	// ---------------------------------------------------------------------------

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	}

	destroy(): void { this.listeners.clear(); }

	private _notify(): void { this.listeners.forEach((fn) => fn()); }
}
