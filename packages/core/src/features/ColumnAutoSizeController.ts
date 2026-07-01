import type { ColumnDef } from '../columnDef.js';
import type { DataModel } from '../models/DataModel.js';
import type { ColumnModel } from '../models/ColumnModel.js';
import type { RowModel } from '../rowModel.js';
import type { ColumnFeatureController } from './ColumnFeatureController.js';
import type { InternalGridState } from '../state/GridState.js';

export interface AutoSizeColumnOptions {
	/** Include the header label in the measurement. Default: true */
	includeHeader?: boolean;
	/** Maximum number of rows to sample. Default: 500 */
	maxRows?: number;
	/** Extra pixels added to each side of the measured text width. Default: 8 */
	padding?: number;
}

export interface AutoSizeAllColumnsOptions extends AutoSizeColumnOptions {
	/** Skip pinned columns. Default: false */
	skipPinned?: boolean;
}

interface AutoSizeContext<TRowData> {
	getState(): InternalGridState<TRowData>;
	columns: ColumnModel<TRowData>;
	data: DataModel<TRowData>;
	columnFeature: ColumnFeatureController<TRowData>;
	getRowModel(): RowModel<TRowData> | null;
	getContainerElement?(): HTMLElement | null;
}

export class ColumnAutoSizeController<TRowData = unknown> {
	private _ctx: CanvasRenderingContext2D | null = null;

	constructor(private readonly c: AutoSizeContext<TRowData>) {}

	public autoSizeColumn(colField: string, opts?: AutoSizeColumnOptions): void {
		const ctx = this._getCtx();
		if (!ctx) return;

		const includeHeader = opts?.includeHeader ?? true;
		const maxRows = opts?.maxRows ?? 500;
		const padding = opts?.padding ?? 8;

		const state = this.c.getState();
		const col = state.columns.find((c) => c.field === colField) as ColumnDef<TRowData> | undefined;
		if (!col || col.hide) return;

		ctx.font = this._readCellFont();
		let maxWidth = 0;

		if (includeHeader) {
			maxWidth = ctx.measureText(col.header ?? col.field).width;
		}

		const rowModel = this.c.getRowModel();
		if (rowModel) {
			const count = Math.min(rowModel.getVisualRowCount(), maxRows);
			for (let i = 0; i < count; i++) {
				const vr = rowModel.getVisualRow(i);
				if (!vr || vr.kind !== 'data') continue;
				const rowId = vr.rowId;
				let text: string;
				if (col.valueFormatter) {
					const rawValue = this.c.data.getCellValue(rowId, colField);
					const node = rowModel.getRowNodeById(rowId);
					text = col.valueFormatter({ value: rawValue, rowData: node?.data as TRowData, colDef: col, rowId });
				} else {
					text = this.c.data.getCheapDisplayValue(rowId, colField);
				}
				const w = ctx.measureText(text).width;
				if (w > maxWidth) maxWidth = w;
			}
		}

		const target = Math.ceil(Math.min(Math.max(maxWidth + padding * 2, col.minWidth ?? 40), col.maxWidth ?? 2000));
		this.c.columnFeature.resizeColumn(colField, target, true);
	}

	public autoSizeAllColumns(opts?: AutoSizeAllColumnsOptions): void {
		const skipPinned = opts?.skipPinned ?? false;
		const state = this.c.getState();
		const { left = 0, right = 0 } = state.pinnedColumns ?? {};
		const displayed = this.c.columns.getDisplayedColumns();
		for (let i = 0; i < displayed.length; i++) {
			if (skipPinned && (i < left || i >= displayed.length - right)) continue;
			this.autoSizeColumn(displayed[i].field, opts);
		}
	}

	private _getCtx(): CanvasRenderingContext2D | null {
		if (!this._ctx) {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = 1;
				canvas.height = 1;
				this._ctx = canvas.getContext('2d');
			} catch {
				return null;
			}
		}
		return this._ctx;
	}

	private _readCellFont(): string {
		const container = this.c.getContainerElement?.();
		if (!container) return '14px sans-serif';
		const style = getComputedStyle(container);
		const size = style.getPropertyValue('--og-cell-font-size').trim() || '14px';
		const family = style.getPropertyValue('--og-cell-font-family').trim() || 'sans-serif';
		return `${size} ${family}`;
	}
}
