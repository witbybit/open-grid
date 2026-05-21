import type { ColumnDef } from './store.js';
import { ViewportGeometry } from './viewportGeometry.js';

export class ColumnController<TRowData = unknown> {
	public columns: ColumnDef<TRowData>[] = [];
	private colIndexMap = new Map<string, number>();
	private columnMap = new Map<string, ColumnDef<TRowData>>();
	public geometry = new ViewportGeometry();
	private defaultColWidth: number = 100;

	constructor(defaultColWidth: number = 100) {
		this.defaultColWidth = defaultColWidth;
	}

	public updateColumns(columns: ColumnDef<TRowData>[], columnWidths: Record<string, number>, defaultColWidth?: number): void {
		if (defaultColWidth !== undefined) {
			this.defaultColWidth = defaultColWidth;
		}
		this.columns = columns;
		this.colIndexMap.clear();
		this.columnMap.clear();

		const widths: number[] = [];

		for (let i = 0; i < columns.length; i++) {
			const col = columns[i];
			if (col.field) {
				this.colIndexMap.set(col.field, i);
				this.columnMap.set(col.field, col);

				const customWidth = columnWidths[col.field] ?? col.width;
				widths.push(customWidth !== undefined ? customWidth : this.defaultColWidth);
			} else {
				widths.push(this.defaultColWidth);
			}
		}

		this.geometry.updateColumns(widths, this.defaultColWidth);
	}

	public getColumnIndex(colField: string): number {
		const idx = this.colIndexMap.get(colField);
		return idx !== undefined ? idx : -1;
	}

	public getColumnDef(colField: string): ColumnDef<TRowData> | undefined {
		return this.columnMap.get(colField);
	}

	public getColLeft(colIdx: number): number {
		const arr = this.geometry.colLefts;
		if (colIdx >= 0 && colIdx < arr.length) {
			return arr[colIdx];
		}
		return colIdx * this.defaultColWidth;
	}

	public getColWidth(colIdx: number): number {
		const arr = this.geometry.colWidths;
		if (colIdx >= 0 && colIdx < arr.length) {
			return arr[colIdx];
		}
		return this.defaultColWidth;
	}

	public getTotalWidth(): number {
		const lefts = this.geometry.colLefts;
		const widths = this.geometry.colWidths;
		if (lefts.length === 0) return 0;
		const lastIdx = lefts.length - 1;
		return lefts[lastIdx] + widths[lastIdx];
	}
}
