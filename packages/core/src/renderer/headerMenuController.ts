import { defaultGridScheduler } from './gridScheduler.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GridApi } from '../store.js';
import { reportRendererFault } from './rendererFaults.js';

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
		const container = headerCell.closest('.og-grid-container') as HTMLElement | null;
		if (container && container.dataset.ogThemeScope) {
			popover.dataset.ogThemeScope = container.dataset.ogThemeScope;
		}
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
				reportRendererFault(this.engine, 'header-menu-component-mount', err, { colField });
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
				reportRendererFault(this.engine, 'header-menu-renderer', err, { colField });
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
		this._makeActivatable(sortAsc);
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
		this._makeActivatable(sortDesc);
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
			this._makeActivatable(clearSort);
			sortContainer.appendChild(clearSort);
		}

		popover.appendChild(sortContainer);

		// Pinning and Grouping Actions
		const api = this.getApi();
		const displayedCols = api.getDisplayedColumns();
		const colIndex = displayedCols.findIndex((c) => c.field === colField);
		const { left: currentLeft, right: currentRight } = api.getPinnedColumns();
		const N = displayedCols.length;

		const handlePinLeft = () => {
			if (colIndex < 0) return;
			if (colIndex < currentLeft) return;
			api.moveColumn(colField, currentLeft);
			const isPinnedRight = colIndex >= N - currentRight;
			const nextRight = isPinnedRight ? Math.max(0, currentRight - 1) : currentRight;
			api.setPinnedColumns({
				left: currentLeft + 1,
				right: nextRight,
			});
			this.hide();
		};

		const handlePinRight = () => {
			if (colIndex < 0) return;
			const isPinnedRight = colIndex >= N - currentRight;
			if (isPinnedRight) return;
			api.moveColumn(colField, N - currentRight - 1);
			const isPinnedLeft = colIndex < currentLeft;
			const nextLeft = isPinnedLeft ? Math.max(0, currentLeft - 1) : currentLeft;
			api.setPinnedColumns({
				left: nextLeft,
				right: currentRight + 1,
			});
			this.hide();
		};

		const handleUnpin = () => {
			if (colIndex < 0) return;
			const isPinnedLeft = colIndex < currentLeft;
			const isPinnedRight = colIndex >= N - currentRight;
			if (isPinnedLeft) {
				api.moveColumn(colField, currentLeft - 1);
				api.setPinnedColumns({
					left: Math.max(0, currentLeft - 1),
					right: currentRight,
				});
			} else if (isPinnedRight) {
				api.moveColumn(colField, N - currentRight);
				api.setPinnedColumns({
					left: currentLeft,
					right: Math.max(0, currentRight - 1),
				});
			}
			this.hide();
		};

		const dividerPinGroup = document.createElement('div');
		dividerPinGroup.className = 'og-popover-divider';
		popover.appendChild(dividerPinGroup);

		const pinGroupContainer = document.createElement('div');
		pinGroupContainer.className = 'og-popover-sort-section';

		const isPinnedLeft = colIndex >= 0 && colIndex < currentLeft;
		if (!isPinnedLeft) {
			const pinLeft = document.createElement('div');
			pinLeft.className = 'og-popover-item';
			pinLeft.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M16 12H8m4-4-4 4 4 4"/></svg>
				<span>Pin Left</span>
			`;
			pinLeft.addEventListener('click', handlePinLeft);
			this._makeActivatable(pinLeft);
			pinGroupContainer.appendChild(pinLeft);
		}

		const isPinnedRight = colIndex >= 0 && colIndex >= N - currentRight;
		if (!isPinnedRight) {
			const pinRight = document.createElement('div');
			pinRight.className = 'og-popover-item';
			pinRight.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M8 12h8m-4-4 4 4-4 4"/></svg>
				<span>Pin Right</span>
			`;
			pinRight.addEventListener('click', handlePinRight);
			this._makeActivatable(pinRight);
			pinGroupContainer.appendChild(pinRight);
		}

		if (isPinnedLeft || isPinnedRight) {
			const unpin = document.createElement('div');
			unpin.className = 'og-popover-item';
			unpin.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				<span>Unpin Column</span>
			`;
			unpin.addEventListener('click', handleUnpin);
			this._makeActivatable(unpin);
			pinGroupContainer.appendChild(unpin);
		}

		if (column.enableRowGroup !== false) {
			const groupBy = state.groupBy || [];
			const isGrouped = groupBy.includes(colField);
			const groupBtn = document.createElement('div');
			groupBtn.className = 'og-popover-item';
			if (isGrouped) {
				groupBtn.innerHTML = `
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="8" y1="11" x2="16" y2="11"></line></svg>
					<span>Remove Group By</span>
				`;
				groupBtn.addEventListener('click', () => {
					api.removeGroupBy(colField);
					this.hide();
				});
			} else {
				groupBtn.innerHTML = `
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
					<span>Group by Column</span>
				`;
				groupBtn.addEventListener('click', () => {
					api.addGroupBy(colField);
					this.hide();
				});
			}
			this._makeActivatable(groupBtn);
			pinGroupContainer.appendChild(groupBtn);
		}

		popover.appendChild(pinGroupContainer);

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

		popover.setAttribute('role', 'menu');
		document.body.appendChild(popover);
		this._position(popover, rect);
		this._bindDismissListeners();
		// Move focus into the popover so keyboard users land on the first action and
		// Tab flows through the sort items into the native filter controls.
		sortAsc.focus({ preventScroll: true });
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
		document.removeEventListener('keydown', this._handleKeyDown);
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

	// Escape closes the popover from anywhere (built-in form controls or a custom menu).
	private _handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && this.activePopover) {
			e.preventDefault();
			this.hide();
			this.activeHeaderCell?.focus?.({ preventScroll: true });
		}
	};

	/** Make a non-native popover row (a div) keyboard-focusable + Enter/Space-activatable,
	 *  so it sits in the natural Tab order alongside the filter's native controls. */
	private _makeActivatable(el: HTMLElement): void {
		el.tabIndex = 0;
		el.setAttribute('role', 'menuitem');
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				el.click();
			}
		});
	}

	private _bindDismissListeners(): void {
		document.addEventListener('mousedown', this._handleOutsideClick);
		document.addEventListener('keydown', this._handleKeyDown);
		window.addEventListener('scroll', this.hide, { capture: true, passive: true });
		window.addEventListener('resize', this.hide);
	}

	private _position(popover: HTMLDivElement, rect: DOMRect): void {
		const popoverWidth = 220;
		const popoverHeight = popover.offsetHeight || 215;

		let left = rect.left;
		let top = rect.bottom + 4;
		let flippedAbove = false;

		if (left + popoverWidth > window.innerWidth) {
			left = window.innerWidth - popoverWidth - 8;
		}
		if (top + popoverHeight > window.innerHeight) {
			top = rect.top - popoverHeight - 4;
			flippedAbove = true;
		}

		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
		// Origin-aware entrance: grow/slide from the edge nearest the trigger (shadcn-style).
		popover.classList.add(flippedAbove ? 'og-placement-top' : 'og-placement-bottom');

		defaultGridScheduler.raf(() => {
			popover.classList.add('og-visible');
		});
	}
}
