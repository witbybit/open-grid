export class GeometryModel {
	// Row Geometry arrays
	public rowTops = new Float64Array(0);
	public rowHeights = new Float64Array(0);
	private rowCapacity = 0;
	private rowCount = 0;

	// Column Geometry arrays
	public colLefts = new Float64Array(0);
	public colWidths = new Float64Array(0);
	private colCapacity = 0;
	private colCount = 0;
	private allInvalid = false;
	private invalidRows = new Set<string>();
	private invalidColumns = new Set<string>();

	public init(): void {}

	public invalidateAll(): void {
		this.allInvalid = true;
	}

	public invalidateRows(rowIds: string[]): void {
		for (const rowId of rowIds) {
			this.invalidRows.add(rowId);
		}
	}

	public invalidateColumns(colIds: string[]): void {
		for (const colId of colIds) {
			this.invalidColumns.add(colId);
		}
	}

	public updateRowHeight(rowId: string, height: number): void {
		const rowIdx = Number(rowId);
		if (Number.isInteger(rowIdx) && rowIdx >= 0 && rowIdx < this.rowCount) {
			this.rowHeights[rowIdx] = height;
		}
		this.invalidateRows([rowId]);
	}

	public updateColumnWidth(colId: string, width: number): void {
		const colIdx = Number(colId);
		if (Number.isInteger(colIdx) && colIdx >= 0 && colIdx < this.colCount) {
			this.colWidths[colIdx] = width;
		}
		this.invalidateColumns([colId]);
	}

	public recomputeIfNeeded(): boolean {
		const changed = this.allInvalid || this.invalidRows.size > 0 || this.invalidColumns.size > 0;
		this.allInvalid = false;
		this.invalidRows.clear();
		this.invalidColumns.clear();
		return changed;
	}

	public updateColumns(widths: number[], defaultColWidth: number): void {
		const len = widths.length;
		if (len > this.colCapacity) {
			this.colCapacity = Math.max(len, this.colCapacity * 2);
			this.colWidths = new Float64Array(this.colCapacity);
			this.colLefts = new Float64Array(this.colCapacity);
		}
		this.colCount = len;

		let left = 0;
		for (let i = 0; i < len; i++) {
			const w = widths[i] !== undefined ? widths[i] : defaultColWidth;
			this.colWidths[i] = w;
			this.colLefts[i] = left;
			left += w;
		}
	}

	public updateRows(heights: number[], defaultRowHeight: number): void {
		const len = heights.length;
		if (len > this.rowCapacity) {
			this.rowCapacity = Math.max(len, this.rowCapacity * 2);
			this.rowHeights = new Float64Array(this.rowCapacity);
			this.rowTops = new Float64Array(this.rowCapacity);
		}
		this.rowCount = len;

		let top = 0;
		for (let i = 0; i < len; i++) {
			const h = heights[i] !== undefined ? heights[i] : defaultRowHeight;
			this.rowHeights[i] = h;
			this.rowTops[i] = top;
			top += h;
		}
	}

	public getRowTop(rowIdx: number, defaultRowHeight: number): number {
		if (rowIdx >= 0 && rowIdx < this.rowCount) {
			return this.rowTops[rowIdx];
		}
		return rowIdx * defaultRowHeight;
	}

	public getRowHeight(rowIdx: number, defaultRowHeight: number): number {
		if (rowIdx >= 0 && rowIdx < this.rowCount) {
			return this.rowHeights[rowIdx];
		}
		return defaultRowHeight;
	}

	/** Phase 9: returns the pixel offset of the bottom edge of a row. */
	public getRowBottom(rowIdx: number, defaultRowHeight: number): number {
		if (rowIdx >= 0 && rowIdx < this.rowCount) {
			return this.rowTops[rowIdx] + this.rowHeights[rowIdx];
		}
		return (rowIdx + 1) * defaultRowHeight;
	}

	/** Phase 9: alias for getRowTop for pixel-first API consistency. */
	public getRowOffset(rowIdx: number, defaultRowHeight: number): number {
		return this.getRowTop(rowIdx, defaultRowHeight);
	}

	public getTotalHeight(defaultRowHeight: number): number {
		if (this.rowCount === 0) return 0;
		const lastIdx = this.rowCount - 1;
		return this.rowTops[lastIdx] + this.rowHeights[lastIdx];
	}

	public getRowCount(): number {
		return this.rowCount;
	}

	public getColLeft(colIdx: number, defaultColWidth: number): number {
		if (colIdx >= 0 && colIdx < this.colCount) {
			return this.colLefts[colIdx];
		}
		return colIdx * defaultColWidth;
	}

	public getColWidth(colIdx: number, defaultColWidth: number): number {
		if (colIdx >= 0 && colIdx < this.colCount) {
			return this.colWidths[colIdx];
		}
		return defaultColWidth;
	}

	public getTotalWidth(defaultColWidth: number): number {
		if (this.colCount === 0) return 0;
		const lastIdx = this.colCount - 1;
		return this.colLefts[lastIdx] + this.colWidths[lastIdx];
	}

	public getColumnCount(): number {
		return this.colCount;
	}

	/**
	 * Maps pixel offsets to row and column indexes with binary search.
	 */
	public getRowIndexAtOffset(offset: number): number {
		const len = this.rowCount;
		if (len === 0) return 0;

		let low = 0;
		let high = len - 1;

		while (low <= high) {
			const mid = (low + high) >> 1;
			const pos = this.rowTops[mid];

			if (pos <= offset) {
				if (mid === len - 1 || this.rowTops[mid + 1] > offset) {
					return mid;
				}
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		return 0;
	}

	public getColIndexAtOffset(offset: number): number {
		const len = this.colCount;
		if (len === 0) return 0;

		let low = 0;
		let high = len - 1;

		while (low <= high) {
			const mid = (low + high) >> 1;
			const pos = this.colLefts[mid];

			if (pos <= offset) {
				if (mid === len - 1 || this.colLefts[mid + 1] > offset) {
					return mid;
				}
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		return 0;
	}
}
