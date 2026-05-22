import type { RowModel } from './store.js';
import { ViewportGeometry } from './viewportGeometry.js';
import type { GridEngine } from './engine/GridEngine.js';

export class RowController<TRowData = unknown> {
	private engine?: GridEngine<TRowData>;
	private fallbackRowModel: RowModel<TRowData> | null = null;
	private fallbackGeometry = new ViewportGeometry();
	private defaultRowHeight: number = 40;

	constructor(defaultRowHeight: number = 40, engine?: GridEngine<TRowData>) {
		this.defaultRowHeight = defaultRowHeight;
		this.engine = engine;
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
					return this.engine!.geometry.getRowIndexAtOffset(offset);
				},
			} as any;
		}
		return this.fallbackGeometry;
	}

	public registerRowModel(rowModel: RowModel<TRowData>): void {
		if (this.engine) {
			this.engine.registerRowModel(rowModel);
			return;
		}
		this.fallbackRowModel = rowModel;
	}

	public getRowModel(): RowModel<TRowData> | null {
		if (this.engine) {
			return this.engine.getRowModel();
		}
		return this.fallbackRowModel;
	}

	public refreshRowGeometry(rowHeightsRecord: Record<string, number>, defaultRowHeight?: number): void {
		if (defaultRowHeight !== undefined) {
			this.defaultRowHeight = defaultRowHeight;
		}
		if (this.engine) {
			// Handled automatically via GridEngine state changes
			return;
		}

		if (!this.fallbackRowModel) {
			this.fallbackGeometry.updateRows([], this.defaultRowHeight);
			return;
		}

		const count = this.fallbackRowModel.getRowCount();
		const heights: number[] = [];

		for (let i = 0; i < count; i++) {
			const node = this.fallbackRowModel.getRowNode(i);
			if (node) {
				const explicitHeight = rowHeightsRecord[node.id];
				const h = explicitHeight !== undefined ? explicitHeight : this.defaultRowHeight;
				heights.push(h);
			} else {
				heights.push(this.defaultRowHeight);
			}
		}

		this.fallbackGeometry.updateRows(heights, this.defaultRowHeight);
	}

	public getRowTop(rowIdx: number): number {
		if (this.engine) {
			return this.engine.geometry.getRowTop(rowIdx, this.defaultRowHeight);
		}
		const arr = this.fallbackGeometry.rowTops;
		if (rowIdx >= 0 && rowIdx < arr.length) {
			return arr[rowIdx];
		}
		return rowIdx * this.defaultRowHeight;
	}

	public getRowHeight(rowIdx: number): number {
		if (this.engine) {
			return this.engine.geometry.getRowHeight(rowIdx, this.defaultRowHeight);
		}
		const arr = this.fallbackGeometry.rowHeights;
		if (rowIdx >= 0 && rowIdx < arr.length) {
			return arr[rowIdx];
		}
		return this.defaultRowHeight;
	}

	public getTotalHeight(): number {
		if (this.engine) {
			return this.engine.geometry.getTotalHeight(this.defaultRowHeight);
		}
		const tops = this.fallbackGeometry.rowTops;
		const heights = this.fallbackGeometry.rowHeights;
		if (tops.length === 0) return 0;
		const lastIdx = tops.length - 1;
		return tops[lastIdx] + heights[lastIdx];
	}
}
