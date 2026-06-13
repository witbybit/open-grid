import type { GridEngine } from '../engine/GridEngine.js';
import { GridEventName } from '../store.js';

/**
 * Status bar (Plan 039 Phase 5) — read-only chrome docked at the bottom of the grid.
 *
 * Renders a row of panels with live counts (total data rows, selected rows). It is a
 * first-class layer: `ViewportRenderer` builds the `.og-layer-status-bar` element from
 * the layer registry and positions it from the layout plan; this renderer only fills it.
 * Mirrors the GroupPanelRenderer lifecycle (mount(el) → render → event subscriptions).
 */
export class StatusBarRenderer<TRowData = unknown> {
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
		// Counts change on data updates, filtering, grouping, and selection.
		for (const evt of [
			GridEventName.rowsUpdated,
			GridEventName.filterChanged,
			GridEventName.groupByChanged,
			GridEventName.selectionChanged,
			GridEventName.paginationChanged,
		]) {
			this.unsubscribers.push(this.engine.eventBus.addEventListener(evt, rerender));
		}
	}

	public unmount(): void {
		for (const unsub of this.unsubscribers) unsub();
		this.unsubscribers = [];
		this.bar = null;
	}

	private formatNumber(n: number): string {
		// Locale-grouped digits without pulling in Intl options churn per render.
		return n.toLocaleString();
	}

	public render(): void {
		if (!this.bar) return;
		const rowModel = this.engine.getRowModel();
		const totalRows = rowModel?.getDataRowCount?.() ?? rowModel?.getVisualRowCount?.() ?? 0;
		const selectedCount = this.engine.stateManager.getState().selectedRowIds?.length ?? 0;

		const panels: Array<{ label: string; value: string }> = [{ label: 'Rows', value: this.formatNumber(totalRows) }];
		if (selectedCount > 0) {
			panels.push({ label: 'Selected', value: this.formatNumber(selectedCount) });
		}

		this.bar.textContent = '';
		// Left-aligned panels; a spacer keeps room for right-docked panels later.
		for (const p of panels) {
			const panel = document.createElement('div');
			panel.className = 'og-status-bar-panel';
			const label = document.createElement('span');
			label.className = 'og-status-bar-panel-label';
			label.textContent = `${p.label}:`;
			const value = document.createElement('span');
			value.className = 'og-status-bar-panel-value';
			value.textContent = p.value;
			panel.appendChild(label);
			panel.appendChild(value);
			this.bar.appendChild(panel);
		}
		const spacer = document.createElement('div');
		spacer.className = 'og-status-bar-spacer';
		this.bar.appendChild(spacer);
	}
}
