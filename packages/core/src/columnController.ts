import type { ColumnDef } from './store.js';
import { ViewportGeometry } from './viewportGeometry.js';
import type { GridEngine } from './engine/GridEngine.js';

export class ColumnController<TRowData = unknown> {
	private engine?: GridEngine<TRowData>;
	private fallbackColumns: ColumnDef<TRowData>[] = [];
	private fallbackGeometry = new ViewportGeometry();
	private defaultColWidth: number = 100;

	constructor(defaultColWidth: number = 100, engine?: GridEngine<TRowData>) {
		this.defaultColWidth = defaultColWidth;
		this.engine = engine;
	}

	public get columns(): ColumnDef<TRowData>[] {
		if (this.engine) {
			return this.engine.stateManager.getState().columns;
		}
		return this.fallbackColumns;
	}

	public set columns(cols: ColumnDef<TRowData>[]) {
		if (this.engine) {
			this.engine.stateManager.setState({ columns: cols });
		} else {
			this.fallbackColumns = cols;
		}
	}

	public get geometry(): ViewportGeometry {
		if (this.engine) {
			return {
				colLefts: this.engine.geometry.colLefts,
				colWidths: this.engine.geometry.colWidths,
				rowTops: this.engine.geometry.rowTops,
				rowHeights: this.engine.geometry.rowHeights,
				updateColumns: (widths: number[], defWidth: number) => {
					this.engine!.geometry.updateColumns(widths, defWidth);
				},
				updateRows: (heights: number[], defHeight: number) => {
					this.engine!.geometry.updateRows(heights, defHeight);
				},
				getIndexAtOffset: (offset: number, cumulativePositions: Float64Array) => {
					return this.engine!.geometry.getColIndexAtOffset(offset);
				},
			} as any;
		}
		return this.fallbackGeometry;
	}

	public updateColumns(columns: ColumnDef<TRowData>[], columnWidths: Record<string, number>, defaultColWidth?: number): void {
		if (defaultColWidth !== undefined) {
			this.defaultColWidth = defaultColWidth;
		}
		if (this.engine) {
			this.engine.columns.updateColumns(columns, columnWidths, this.defaultColWidth);
			return;
		}
		this.fallbackColumns = columns;

		const widths: number[] = [];
		for (let i = 0; i < columns.length; i++) {
			const col = columns[i];
			if (col.field) {
				const customWidth = columnWidths[col.field] ?? col.width;
				widths.push(customWidth !== undefined ? customWidth : this.defaultColWidth);
			} else {
				widths.push(this.defaultColWidth);
			}
		}
		this.fallbackGeometry.updateColumns(widths, this.defaultColWidth);
	}

	public getColumnIndex(colField: string): number {
		if (this.engine) {
			return this.engine.columns.getColumnIndex(colField);
		}
		for (let i = 0; i < this.fallbackColumns.length; i++) {
			if (this.fallbackColumns[i].field === colField) return i;
		}
		return -1;
	}

	public getColumnDef(colField: string): ColumnDef<TRowData> | undefined {
		if (this.engine) {
			return this.engine.columns.getColumnDef(colField);
		}
		return this.fallbackColumns.find(c => c.field === colField);
	}

	public getColLeft(colIdx: number): number {
		if (this.engine) {
			return this.engine.geometry.getColLeft(colIdx, this.defaultColWidth);
		}
		const arr = this.fallbackGeometry.colLefts;
		if (colIdx >= 0 && colIdx < arr.length) {
			return arr[colIdx];
		}
		return colIdx * this.defaultColWidth;
	}

	public getColWidth(colIdx: number): number {
		if (this.engine) {
			return this.engine.geometry.getColWidth(colIdx, this.defaultColWidth);
		}
		const arr = this.fallbackGeometry.colWidths;
		if (colIdx >= 0 && colIdx < arr.length) {
			return arr[colIdx];
		}
		return this.defaultColWidth;
	}

	public getTotalWidth(): number {
		if (this.engine) {
			return this.engine.geometry.getTotalWidth(this.defaultColWidth);
		}
		const lefts = this.fallbackGeometry.colLefts;
		const widths = this.fallbackGeometry.colWidths;
		if (lefts.length === 0) return 0;
		const lastIdx = lefts.length - 1;
		return lefts[lastIdx] + widths[lastIdx];
	}
}
