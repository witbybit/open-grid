import type { GridEventListener } from '../../kernel/GridEvent.js';
import type { RowId } from '../rows/RowId.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatusBarPanelId = 'rowCount' | 'selectedCount' | 'filteredCount' | 'sum' | 'avg' | 'min' | 'max' | 'customText';

export interface StatusBarPanelDef {
	readonly id: string;
	/** Built-in metric or 'customText' for a static label. */
	readonly type: StatusBarPanelId;
	/** Label to show before the value (e.g. 'Rows: '). Default derived from type. */
	readonly label?: string;
	/** For type='sum'/'avg'/'min'/'max': which field to aggregate over. */
	readonly field?: string;
	/** For type='customText': the text to display. */
	readonly text?: string;
}

export interface StatusBarData {
	readonly rowCount: number;
	readonly filteredCount: number;
	readonly selectedCount: number;
	readonly panels: readonly ComputedPanel[];
}

export interface ComputedPanel {
	readonly id: string;
	readonly label: string;
	readonly value: string;
}

// ---------------------------------------------------------------------------
// StatusBarModel
// ---------------------------------------------------------------------------

export interface StatusBarPort<TRow> {
	getVisualRowCount(): number;
	getTotalRowCount(): number;
	getSelectedRowIds(): ReadonlySet<RowId>;
	getLoadedRows(): ReadonlyArray<{ id: RowId; data: TRow }>;
	getCellValue(rowId: RowId, field: string): unknown;
	subscribeToKernel(fn: GridEventListener): () => void;
}

export class StatusBarModel<TRow = unknown> {
	private readonly panels: StatusBarPanelDef[];
	private readonly listeners = new Set<() => void>();
	private data: StatusBarData;
	private unsub: (() => void) | null = null;

	constructor(
		private readonly port: StatusBarPort<TRow>,
		panels: StatusBarPanelDef[] = defaultPanels(),
	) {
		this.panels = panels;
		this.data = this._compute();
	}

	subscribeToKernel(): () => void {
		this.unsub?.();
		this.unsub = this.port.subscribeToKernel((event) => {
			if (
				event.type === 'rows.replaced' ||
				event.type === 'rows.changed' ||
				event.type === 'pipeline.changed' ||
				event.type === 'selection.changed' ||
				event.type === 'cells.changed'
			) {
				this.refresh();
			}
		});
		return () => this.unsub?.();
	}

	getData(): StatusBarData {
		return this.data;
	}

	refresh(): void {
		this.data = this._compute();
		this.listeners.forEach((fn) => fn());
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	}

	destroy(): void {
		this.unsub?.();
		this.listeners.clear();
	}

	private _compute(): StatusBarData {
		const rowCount = this.port.getVisualRowCount();
		const totalRowCount = this.port.getTotalRowCount();
		const selectedRowIds = this.port.getSelectedRowIds();
		const rows = this.port.getLoadedRows();

		const panels: ComputedPanel[] = this.panels.map((def) => {
			let value = '';
			switch (def.type) {
				case 'rowCount':
					value = formatNumber(rowCount);
					break;
				case 'filteredCount':
					value = `${formatNumber(rowCount)} / ${formatNumber(totalRowCount)}`;
					break;
				case 'selectedCount':
					value = formatNumber(selectedRowIds.size);
					break;
				case 'sum':
					if (def.field) {
						const sum = rows.reduce((acc, r) => {
							const v = Number(this.port.getCellValue(r.id, def.field!));
							return acc + (isNaN(v) ? 0 : v);
						}, 0);
						value = formatNumber(sum);
					}
					break;
				case 'avg':
					if (def.field && rows.length > 0) {
						const sum = rows.reduce((acc, r) => {
							const v = Number(this.port.getCellValue(r.id, def.field!));
							return acc + (isNaN(v) ? 0 : v);
						}, 0);
						value = formatDecimal(sum / rows.length);
					}
					break;
				case 'min':
					if (def.field && rows.length > 0) {
						const vals = rows.map((r) => Number(this.port.getCellValue(r.id, def.field!))).filter((n) => !isNaN(n));
						value = vals.length > 0 ? formatNumber(Math.min(...vals)) : '';
					}
					break;
				case 'max':
					if (def.field && rows.length > 0) {
						const vals = rows.map((r) => Number(this.port.getCellValue(r.id, def.field!))).filter((n) => !isNaN(n));
						value = vals.length > 0 ? formatNumber(Math.max(...vals)) : '';
					}
					break;
				case 'customText':
					value = def.text ?? '';
					break;
			}
			return { id: def.id, label: def.label ?? labelForType(def.type), value };
		});

		return {
			rowCount,
			filteredCount: rowCount,
			selectedCount: selectedRowIds.size,
			panels,
		};
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultPanels(): StatusBarPanelDef[] {
	return [
		{ id: 'rowCount', type: 'rowCount', label: 'Rows' },
		{ id: 'selectedCount', type: 'selectedCount', label: 'Selected' },
	];
}

function labelForType(type: StatusBarPanelId): string {
	switch (type) {
		case 'rowCount': return 'Rows';
		case 'filteredCount': return 'Filtered';
		case 'selectedCount': return 'Selected';
		case 'sum': return 'Sum';
		case 'avg': return 'Avg';
		case 'min': return 'Min';
		case 'max': return 'Max';
		case 'customText': return '';
	}
}

function formatNumber(n: number): string {
	return n.toLocaleString();
}

function formatDecimal(n: number): string {
	return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
