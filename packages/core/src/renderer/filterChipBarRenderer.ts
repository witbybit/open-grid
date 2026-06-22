import type { GridEngine } from '../engine/GridEngine.js';
import type { HeaderMenuController } from './headerMenuController.js';
import type { ColumnFilter } from '../filterModel.js';
import { getFilterChipText, applyFilterToModel } from '../filterOperations.js';
import type { GridQueryGroup, GridQueryNode } from '../query/GridQueryModel.js';

function countQueryConditions(group: GridQueryGroup): number {
	let count = 0;
	function visit(node: GridQueryNode): void {
		if (node.kind === 'condition') {
			count++;
		} else {
			for (const child of node.children) visit(child);
		}
	}
	visit(group);
	return count;
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
		const unsub3 = this.engine.stateManager.subscribeToKey('queryModel', () => this.render());
		this.unsubscribe = () => {
			unsub1();
			unsub2();
			unsub3();
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
		const queryModel = state.queryModel;
		bar.innerHTML = '';

		const filterCount = filterModel ? Object.keys(filterModel).length : 0;
		const hasQuery = queryModel && queryModel.root.children.length > 0;

		if (!state.showFilterChipBar || (filterCount === 0 && !hasQuery)) return;

		for (const [colField, filterItem] of Object.entries(filterModel ?? {})) {
			const col = state.columns.find((c) => c.field === colField);
			const label = col?.header ?? colField;
			const chipText = getFilterChipText(filterItem as ColumnFilter);

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
				this.engine.setFilterModel(applyFilterToModel(colField, null, this.engine.stateManager.getState().filterModel));
			});
			chip.appendChild(removeBtn);

			bar.appendChild(chip);
		}

		// Query chip — shows a summary of the active query model
		if (hasQuery) {
			const conditionCount = countQueryConditions(queryModel!.root);
			const chip = document.createElement('div');
			chip.className = 'og-filter-chip og-filter-chip--query';

			const icon = document.createElement('span');
			icon.style.cssText = 'font-size:10px;opacity:0.7;margin-right:3px;';
			icon.textContent = '⊕';
			chip.appendChild(icon);

			const chipLabel = document.createElement('span');
			chipLabel.className = 'og-filter-chip-label';
			chipLabel.textContent = `Query (${conditionCount} condition${conditionCount !== 1 ? 's' : ''})`;
			chip.appendChild(chipLabel);

			const removeBtn = document.createElement('button');
			removeBtn.className = 'og-filter-chip-remove';
			removeBtn.setAttribute('aria-label', 'Clear query');
			removeBtn.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
			removeBtn.addEventListener('click', () => {
				this.engine.setQueryModel(null);
			});
			chip.appendChild(removeBtn);

			bar.appendChild(chip);
		}

		// "Clear all" button — only shown when 2+ chips are visible
		const totalChips = filterCount + (hasQuery ? 1 : 0);
		if (totalChips >= 2) {
			const clearAll = document.createElement('button');
			clearAll.className = 'og-filter-clear-all';
			clearAll.textContent = 'Clear all';
			clearAll.addEventListener('click', () => {
				this.engine.setFilterModel(null);
				this.engine.setQueryModel(null);
			});
			bar.appendChild(clearAll);
		}
	}
}
