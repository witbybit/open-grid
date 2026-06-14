import type { GridEngine } from '../engine/GridEngine.js';
import type { FilterModelItem } from '../rowModel.js';

const OPERATOR_LABELS: Record<string, string> = {
	contains: 'contains',
	equals: '=',
	startsWith: 'starts',
	endsWith: 'ends',
	gt: '>',
	gte: '≥',
	lt: '<',
	lte: '≤',
};

/**
 * Renders a horizontal chip strip below the group panel (above the column headers)
 * showing one chip per active filter. Each chip has a × to clear that single filter;
 * a "Clear all" button clears the entire filterModel.
 *
 * The bar is hidden (and takes no space in the layout plan) when filterModel is empty.
 */
export class FilterChipBarRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private bar: HTMLDivElement | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

	public mount(bar: HTMLDivElement): void {
		this.bar = bar;
		this.unsubscribe = this.engine.stateManager.subscribeToKey('filterModel', () => this.render());
		this.render();
	}

	public unmount(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.bar) {
			this.bar.innerHTML = '';
			this.bar = null;
		}
	}

	private render(): void {
		const bar = this.bar;
		if (!bar) return;

		const filterModel = this.engine.stateManager.getState().filterModel;
		bar.innerHTML = '';

		if (!filterModel || Object.keys(filterModel).length === 0) return;

		const state = this.engine.stateManager.getState();

		for (const [colField, filterItem] of Object.entries(filterModel)) {
			const col = state.columns.find((c) => c.field === colField);
			const label = col?.header ?? colField;

			let operatorLabel = 'contains';
			let filterValue = '';
			if (filterItem && typeof filterItem === 'object' && 'filter' in filterItem) {
				const item = filterItem as FilterModelItem;
				operatorLabel = OPERATOR_LABELS[item.type ?? 'contains'] ?? item.type ?? 'contains';
				filterValue = String(item.filter ?? '');
			} else {
				filterValue = String(filterItem ?? '');
			}

			const chip = document.createElement('div');
			chip.className = 'og-filter-chip';

			const chipLabel = document.createElement('span');
			chipLabel.className = 'og-filter-chip-label';
			chipLabel.textContent = `${label}: ${operatorLabel} "${filterValue}"`;
			chip.appendChild(chipLabel);

			const removeBtn = document.createElement('button');
			removeBtn.className = 'og-filter-chip-remove';
			removeBtn.setAttribute('aria-label', `Remove filter on ${label}`);
			removeBtn.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
			removeBtn.addEventListener('click', () => {
				const next = { ...this.engine.stateManager.getState().filterModel };
				delete next[colField];
				this.engine.setFilterModel(Object.keys(next).length > 0 ? next : null);
			});
			chip.appendChild(removeBtn);

			bar.appendChild(chip);
		}

		// "Clear all" button — only shown when 2+ filters are active
		if (Object.keys(filterModel).length >= 2) {
			const clearAll = document.createElement('button');
			clearAll.className = 'og-filter-clear-all';
			clearAll.textContent = 'Clear all';
			clearAll.addEventListener('click', () => {
				this.engine.setFilterModel(null);
			});
			bar.appendChild(clearAll);
		}
	}
}
