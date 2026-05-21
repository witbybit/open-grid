import type { RowModel } from './store.js';
import { ViewportGeometry } from './viewportGeometry.js';

export class RowController<TRowData = unknown> {
	private rowModel: RowModel<TRowData> | null = null;
	public geometry = new ViewportGeometry();
	private defaultRowHeight: number = 40;

	constructor(defaultRowHeight: number = 40) {
		this.defaultRowHeight = defaultRowHeight;
	}

	public registerRowModel(rowModel: RowModel<TRowData>): void {
		this.rowModel = rowModel;
	}

	public getRowModel(): RowModel<TRowData> | null {
		return this.rowModel;
	}

	public refreshRowGeometry(rowHeightsRecord: Record<string, number>, defaultRowHeight?: number): void {
		if (defaultRowHeight !== undefined) {
			this.defaultRowHeight = defaultRowHeight;
		}
		if (!this.rowModel) {
			this.geometry.updateRows([], this.defaultRowHeight);
			return;
		}

		const count = this.rowModel.getRowCount();
		const heights: number[] = [];

		for (let i = 0; i < count; i++) {
			const node = this.rowModel.getRowNode(i);
			if (node) {
				const explicitHeight = rowHeightsRecord[node.id];
				const h = explicitHeight !== undefined ? explicitHeight : this.defaultRowHeight;
				heights.push(h);
			} else {
				heights.push(this.defaultRowHeight);
			}
		}

		this.geometry.updateRows(heights, this.defaultRowHeight);
	}

	public getRowTop(rowIdx: number): number {
		const arr = this.geometry.rowTops;
		if (rowIdx >= 0 && rowIdx < arr.length) {
			return arr[rowIdx];
		}
		return rowIdx * this.defaultRowHeight;
	}

	public getRowHeight(rowIdx: number): number {
		const arr = this.geometry.rowHeights;
		if (rowIdx >= 0 && rowIdx < arr.length) {
			return arr[rowIdx];
		}
		return this.defaultRowHeight;
	}

	public getTotalHeight(): number {
		const tops = this.geometry.rowTops;
		const heights = this.geometry.rowHeights;
		if (tops.length === 0) return 0;
		const lastIdx = tops.length - 1;
		return tops[lastIdx] + heights[lastIdx];
	}
}
