import type { GridEngine } from '../engine/GridEngine.js';
import type { HeaderMenuController } from './headerMenuController.js';
import type { ColumnFilter } from '../filterModel.js';

const TEXT_OP_LABELS: Record<string, string> = {
	contains: 'contains',
	notContains: '¬contains',
	equals: '=',
	notEquals: '≠',
	startsWith: 'starts',
	endsWith: 'ends',
	blank: 'is blank',
	notBlank: 'not blank',
};

const NUMBER_OP_LABELS: Record<string, string> = {
	equals: '=',
	notEquals: '≠',
	gt: '>',
	gte: '≥',
	lt: '<',
	lte: '≤',
	inRange: 'in range',
	blank: 'is blank',
	notBlank: 'not blank',
};

const DATE_OP_LABELS: Record<string, string> = {
	equals: 'on',
	before: 'before',
	after: 'after',
	inRange: 'between',
	blank: 'is blank',
	notBlank: 'not blank',
};

function chipTextForFilter(item: ColumnFilter): string {
	switch (item.type) {
		case 'text': {
			const op = TEXT_OP_LABELS[item.operator] ?? item.operator;
			if (item.operator === 'blank' || item.operator === 'notBlank') return op;
			return `${op} "${item.value}"`;
		}
		case 'number': {
			const op = NUMBER_OP_LABELS[item.operator] ?? item.operator;
			if (item.operator === 'blank' || item.operator === 'notBlank') return op;
			if (item.operator === 'inRange') return `${item.value} – ${item.valueTo ?? '…'}`;
			return `${op} ${item.value}`;
		}
		case 'date': {
			const op = DATE_OP_LABELS[item.operator] ?? item.operator;
			if (item.operator === 'blank' || item.operator === 'notBlank') return op;
			if (item.operator === 'inRange') return `${item.dateFrom} – ${item.dateTo ?? '…'}`;
			return `${op} ${item.dateFrom}`;
		}
		case 'set': {
			if (item.values.length === 0) return '(none)';
			const labels = item.values.slice(0, 3).map((v) => (v === null ? '(blank)' : String(v)));
			const extra = item.values.length > 3 ? ` +${item.values.length - 3} more` : '';
			return labels.join(', ') + extra;
		}
		case 'compound': {
			const [c1, c2] = item.conditions;
			return `${chipTextForFilter(c1)} ${item.operator} ${chipTextForFilter(c2)}`;
		}
	}
}

/**
 * Renders a horizontal chip strip below the group panel (above the column headers)
 * showing one chip per active filter. Each chip has a × to clear that single filter;
 * a "Clear all" button clears the entire filterModel.
 *
 * Clicking a chip (not the × button) re-opens the column's filter popover anchored
 * to the chip element — no sidebar required.
 *
 * The bar is hidden (and takes no space in the layout plan) when filterModel is empty.
 */
export class FilterChipBarRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly headerMenu: HeaderMenuController<TRowData>;
	private bar: HTMLDivElement | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(engine: GridEngine<TRowData>, headerMenu: HeaderMenuController<TRowData>) {
		this.engine = engine;
		this.headerMenu = headerMenu;
	}

	public mount(bar: HTMLDivElement): void {
		this.bar = bar;
		const unsub1 = this.engine.stateManager.subscribeToKey('filterModel', () => this.render());
		const unsub2 = this.engine.stateManager.subscribeToKey('showFilterChipBar', () => this.render());
		this.unsubscribe = () => {
			unsub1();
			unsub2();
		};
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

		const state = this.engine.stateManager.getState();
		const filterModel = state.filterModel;
		bar.innerHTML = '';

		if (!state.showFilterChipBar || !filterModel || Object.keys(filterModel).length === 0) return;

		for (const [colField, filterItem] of Object.entries(filterModel)) {
			const col = state.columns.find((c) => c.field === colField);
			const label = col?.header ?? colField;
			const chipText = chipTextForFilter(filterItem as ColumnFilter);

			const chip = document.createElement('div');
			chip.className = 'og-filter-chip';

			const chipLabel = document.createElement('span');
			chipLabel.className = 'og-filter-chip-label';
			chipLabel.textContent = `${label}: ${chipText}`;
			chipLabel.style.cursor = 'pointer';
			chipLabel.addEventListener('click', () => {
				this.headerMenu.showForField(colField, chip);
			});
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
