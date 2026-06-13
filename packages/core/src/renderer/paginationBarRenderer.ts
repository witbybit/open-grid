import type { GridEngine } from '../engine/GridEngine.js';
import { GridEventName } from '../store.js';

/**
 * Pagination bar (Plan 039 Phase 5) — chrome docked at the bottom of the grid.
 *
 * Renders a page summary + first/prev/next/last controls. Navigation updates
 * `state.pagination.page` and dispatches `paginationChanged` ({page, pageCount,
 * totalRows, pageSize}). This is the integration seam: a server row model (or app code)
 * reacts to the event to fetch/slice the page. NOTE (Plan 039): client-side auto-slicing
 * of the rendered rows is the remaining data-layer step — it must thread a page window
 * through the row pipeline so the visual-row index maps, geometry, and group/sticky meta
 * stay consistent; until then the bar drives page state + the event, not the row set.
 *
 * First-class layer: `ViewportRenderer` builds `.og-layer-pagination` from the registry
 * and positions it from the plan; this renderer only fills + wires it.
 */
export class PaginationBarRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private bar: HTMLDivElement | null = null;
	private unsubscribers: Array<() => void> = [];

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

	public mount(bar: HTMLDivElement): void {
		this.bar = bar;
		this.render();
		const rerender = () => this.render();
		for (const evt of [GridEventName.rowsUpdated, GridEventName.filterChanged, GridEventName.groupByChanged, GridEventName.paginationChanged]) {
			this.unsubscribers.push(this.engine.eventBus.addEventListener(evt, rerender));
		}
		// Server pagination totals land on the serverPagination state key (which may update
		// before this bar mounts and catches the event) — subscribe to it directly so the
		// bar reflects server page counts regardless of load timing.
		this.unsubscribers.push(this.engine.stateManager.subscribeToKey('serverPagination', rerender));
	}

	public unmount(): void {
		for (const unsub of this.unsubscribers) unsub();
		this.unsubscribers = [];
		this.bar = null;
	}

	private getModel(): { page: number; pageSize: number; totalRows: number; pageCount: number } {
		const state = this.engine.stateManager.getState();
		const pageSize = Math.max(1, state.pagination?.pageSize ?? 100);
		const rowModel = this.engine.getRowModel();
		// Server pagination: the server row model is the authority (block loading reports
		// the total + page count via serverPagination state).
		const serverPg = state.serverPagination;
		if (serverPg) {
			return { page: serverPg.page, pageSize: serverPg.pageSize, totalRows: serverPg.totalRows, pageCount: serverPg.pageCount };
		}
		// Client pagination: the row pipeline's page window is authoritative (Plan 041) — its
		// total is the post-filter/post-group visible count, the correct denominator.
		const pageWindow = rowModel?.getPageWindow?.();
		if (pageWindow) {
			return { page: pageWindow.page, pageSize: pageWindow.pageSize, totalRows: pageWindow.totalRows, pageCount: pageWindow.pageCount };
		}
		const totalRows = rowModel?.getVisualRowCount?.() ?? rowModel?.getDataRowCount?.() ?? 0;
		const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
		const page = Math.min(Math.max(0, state.pagination?.page ?? 0), pageCount - 1);
		return { page, pageSize, totalRows, pageCount };
	}

	private goToPage(page: number): void {
		const { pageSize, totalRows, pageCount } = this.getModel();
		const next = Math.min(Math.max(0, page), pageCount - 1);
		const rowModel = this.engine.getRowModel();
		// Server row model owns its paging (loads blocks + dispatches paginationChanged).
		if (rowModel?.goToPage) {
			rowModel.goToPage(next);
			this.render();
			return;
		}
		// Client: drive via state + event; the client row model re-runs the pipeline page
		// window on paginationChanged (Plan 041), and the scroll resets to the page top.
		const current = this.engine.stateManager.getState().pagination;
		if (current && current.page === next) return;
		this.engine.stateManager.setState({ pagination: { pageSize, page: next } });
		this.engine.eventBus.dispatchEvent(GridEventName.paginationChanged, { page: next, pageCount, totalRows, pageSize });
		this.render();
	}

	private button(label: string, ariaLabel: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'og-pagination-btn';
		btn.textContent = label;
		btn.setAttribute('aria-label', ariaLabel);
		btn.disabled = disabled;
		if (!disabled) btn.addEventListener('click', onClick);
		return btn;
	}

	public render(): void {
		if (!this.bar) return;
		const { page, pageSize, totalRows, pageCount } = this.getModel();
		const firstRow = totalRows === 0 ? 0 : page * pageSize + 1;
		const lastRow = Math.min(totalRows, (page + 1) * pageSize);

		this.bar.textContent = '';

		const summary = document.createElement('span');
		summary.className = 'og-pagination-summary';
		summary.textContent = `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${totalRows.toLocaleString()}`;
		this.bar.appendChild(summary);

		this.bar.appendChild(this.button('«', 'First page', page <= 0, () => this.goToPage(0)));
		this.bar.appendChild(this.button('‹', 'Previous page', page <= 0, () => this.goToPage(page - 1)));

		const pageInfo = document.createElement('span');
		pageInfo.className = 'og-pagination-page-info';
		pageInfo.textContent = `Page ${(page + 1).toLocaleString()} of ${pageCount.toLocaleString()}`;
		this.bar.appendChild(pageInfo);

		this.bar.appendChild(this.button('›', 'Next page', page >= pageCount - 1, () => this.goToPage(page + 1)));
		this.bar.appendChild(this.button('»', 'Last page', page >= pageCount - 1, () => this.goToPage(pageCount - 1)));
	}
}
