import { defaultGridScheduler } from './gridScheduler.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GridApi } from '../store.js';

/**
 * Manages the column header context menu/popover lifecycle.
 * Extracted from RenderEngine so that the DOM build and dismiss logic
 * lives in one cohesive place with its own state.
 */
export class HeaderMenuController<TRowData = unknown> {
	private activePopover: HTMLDivElement | null = null;
	private activeHeaderCell: HTMLElement | null = null;

	constructor(
		private readonly engine: GridEngine<TRowData>,
		private readonly portalMountManager: PortalMountManager<TRowData>,
		private readonly getApi: () => GridApi<TRowData>
	) {}

	public show(headerCell: HTMLElement, colField: string): void {
		// Toggle: clicking the same header button closes it.
		if (this.activePopover && this.activeHeaderCell === headerCell) {
			this.hide();
			return;
		}
		this.hide();

		const rect = headerCell.getBoundingClientRect();
		const state = this.engine.stateManager.getState();
		const column = state.columns.find((c) => c.field === colField);
		if (!column) return;

		const popover = document.createElement('div');
		popover.className = 'og-header-popover';
		this.activePopover = popover;
		this.activeHeaderCell = headerCell;

		// Custom React header menu (portal-mounted).
		if (column.headerMenuComponent && this.portalMountManager.onMountHeaderMenu) {
			try {
				this.portalMountManager.mountHeaderMenu({
					colField,
					column,
					close: this.hide,
					container: popover,
				});
				document.body.appendChild(popover);
				this._position(popover, rect);
				this._bindDismissListeners();
				return;
			} catch (err) {
				console.error('HeaderMenuController: Error mounting custom React header menu', err);
			}
		}

		// Custom function header menu renderer.
		if (column.headerMenuRenderer) {
			try {
				column.headerMenuRenderer({
					colField,
					column,
					api: this.getApi(),
					close: this.hide,
					container: popover,
				});
				document.body.appendChild(popover);
				this._position(popover, rect);
				this._bindDismissListeners();
				return;
			} catch (err) {
				console.error('HeaderMenuController: Error rendering custom header menu', err);
			}
		}

		// Built-in sort + filter popover.
		const sortContainer = document.createElement('div');
		sortContainer.className = 'og-popover-sort-section';

		const currentSort = state.sortModel?.find((s) => s.colId === colField);

		const sortAsc = document.createElement('div');
		sortAsc.className = 'og-popover-item' + (currentSort?.sort === 'asc' ? ' og-active' : '');
		sortAsc.innerHTML = `
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7-7 7 7"/></svg>
			<span>Sort Ascending</span>
		`;
		sortAsc.addEventListener('click', () => {
			this.engine.setSortModel([{ colId: colField, sort: 'asc' }]);
			this.hide();
		});
		sortContainer.appendChild(sortAsc);

		const sortDesc = document.createElement('div');
		sortDesc.className = 'og-popover-item' + (currentSort?.sort === 'desc' ? ' og-active' : '');
		sortDesc.innerHTML = `
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7 7 7-7"/></svg>
			<span>Sort Descending</span>
		`;
		sortDesc.addEventListener('click', () => {
			this.engine.setSortModel([{ colId: colField, sort: 'desc' }]);
			this.hide();
		});
		sortContainer.appendChild(sortDesc);

		if (currentSort) {
			const clearSort = document.createElement('div');
			clearSort.className = 'og-popover-item og-danger';
			clearSort.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				<span>Clear Sorting</span>
			`;
			clearSort.addEventListener('click', () => {
				this.engine.setSortModel(null);
				this.hide();
			});
			sortContainer.appendChild(clearSort);
		}

		popover.appendChild(sortContainer);

		const divider = document.createElement('div');
		divider.className = 'og-popover-divider';
		popover.appendChild(divider);

		const filterContainer = document.createElement('div');
		filterContainer.className = 'og-popover-filter-section';

		const filterTitle = document.createElement('div');
		filterTitle.className = 'og-popover-section-title';
		filterTitle.textContent = 'Filter Column';
		filterContainer.appendChild(filterTitle);

		let currentOperator = 'contains';
		let currentFilterVal = '';
		if (state.filterModel && state.filterModel[colField] !== undefined) {
			const filterObj = state.filterModel[colField];
			if (filterObj && typeof filterObj === 'object' && 'filter' in filterObj) {
				currentOperator = (filterObj as any).type ?? 'contains';
				currentFilterVal = String((filterObj as any).filter ?? '');
			} else {
				currentFilterVal = String(filterObj ?? '');
			}
		}

		const select = document.createElement('select');
		select.className = 'og-popover-select';
		const operators = [
			{ value: 'contains', label: 'Contains' },
			{ value: 'equals', label: 'Equals' },
			{ value: 'startsWith', label: 'Starts with' },
			{ value: 'endsWith', label: 'Ends with' },
			{ value: 'gt', label: 'Greater than' },
			{ value: 'gte', label: 'Greater or equal' },
			{ value: 'lt', label: 'Less than' },
			{ value: 'lte', label: 'Less or equal' },
		];
		operators.forEach((op) => {
			const opt = document.createElement('option');
			opt.value = op.value;
			opt.textContent = op.label;
			if (op.value === currentOperator) opt.selected = true;
			select.appendChild(opt);
		});
		filterContainer.appendChild(select);

		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'og-popover-input';
		input.placeholder = 'Filter value...';
		input.value = currentFilterVal;
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') applyBtn.click();
		});
		filterContainer.appendChild(input);

		const btnGroup = document.createElement('div');
		btnGroup.className = 'og-popover-btn-group';

		const clearBtn = document.createElement('button');
		clearBtn.className = 'og-popover-btn og-btn-secondary';
		clearBtn.textContent = 'Clear';
		clearBtn.addEventListener('click', () => {
			const nextFilterModel = { ...(state.filterModel || {}) };
			delete nextFilterModel[colField];
			this.engine.setFilterModel(Object.keys(nextFilterModel).length > 0 ? nextFilterModel : null);
			this.hide();
		});
		btnGroup.appendChild(clearBtn);

		const applyBtn = document.createElement('button');
		applyBtn.className = 'og-popover-btn og-btn-primary';
		applyBtn.textContent = 'Apply';
		applyBtn.addEventListener('click', () => {
			const term = input.value.trim();
			const nextFilterModel = { ...(state.filterModel || {}) };
			if (term === '') {
				delete nextFilterModel[colField];
			} else {
				nextFilterModel[colField] = {
					type: select.value as any,
					filter: term,
				};
			}
			this.engine.setFilterModel(Object.keys(nextFilterModel).length > 0 ? nextFilterModel : null);
			this.hide();
		});
		btnGroup.appendChild(applyBtn);

		filterContainer.appendChild(btnGroup);
		popover.appendChild(filterContainer);

		document.body.appendChild(popover);
		this._position(popover, rect);
		this._bindDismissListeners();
	}

	public hide = (): void => {
		if (this.activePopover) {
			this.activePopover.classList.remove('og-visible');
			const el = this.activePopover;
			const colField = this.activeHeaderCell?.dataset.colField;
			if (colField) {
				this.portalMountManager.releaseHeaderMenu({ colField, container: el });
			}
			defaultGridScheduler.timeout(() => {
				el.remove();
			}, 120);
			this.activePopover = null;
		}
		this.activeHeaderCell = null;
		document.removeEventListener('mousedown', this._handleOutsideClick);
		window.removeEventListener('scroll', this.hide, { capture: true });
		window.removeEventListener('resize', this.hide);
	};

	private _handleOutsideClick = (e: MouseEvent): void => {
		if (this.activePopover && !this.activePopover.contains(e.target as Node)) {
			const clickedMenuBtn = (e.target as HTMLElement).closest('.og-header-menu-button');
			if (clickedMenuBtn && clickedMenuBtn.closest('.og-header-cell') === this.activeHeaderCell) {
				return;
			}
			this.hide();
		}
	};

	private _bindDismissListeners(): void {
		document.addEventListener('mousedown', this._handleOutsideClick);
		window.addEventListener('scroll', this.hide, { capture: true, passive: true });
		window.addEventListener('resize', this.hide);
	}

	private _position(popover: HTMLDivElement, rect: DOMRect): void {
		const popoverWidth = 220;
		const popoverHeight = popover.offsetHeight || 215;

		let left = rect.left;
		let top = rect.bottom + 4;

		if (left + popoverWidth > window.innerWidth) {
			left = window.innerWidth - popoverWidth - 8;
		}
		if (top + popoverHeight > window.innerHeight) {
			top = rect.top - popoverHeight - 4;
		}

		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;

		defaultGridScheduler.raf(() => {
			popover.classList.add('og-visible');
		});
	}
}
