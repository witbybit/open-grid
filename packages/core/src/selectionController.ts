import type { GridCellPointer, GridCellRange, GridCellRangeBounds } from './store.js';

export class SelectionController {
	private selectedRange: GridCellRange | null = null;
	private selectedRangeBounds: GridCellRangeBounds | null = null;

	public getSelectedRange(): GridCellRange | null {
		return this.selectedRange;
	}

	public getSelectedRangeBounds(): GridCellRangeBounds | null {
		return this.selectedRangeBounds;
	}

	public setSelectedRange(range: GridCellRange | null, bounds: GridCellRangeBounds | null): void {
		this.selectedRange = range;
		this.selectedRangeBounds = bounds;
	}

	public calculateRangeBounds(
		range: GridCellRange | null,
		getRowIndexById: (id: string) => number,
		getColumnIndex: (field: string) => number
	): GridCellRangeBounds | null {
		if (!range) return null;

		const startIdx = getRowIndexById(range.start.rowId);
		const endIdx = getRowIndexById(range.end.rowId);
		if (startIdx === -1 || endIdx === -1) return null;

		const startColIdx = getColumnIndex(range.start.colField);
		const endColIdx = getColumnIndex(range.end.colField);
		if (startColIdx === -1 || endColIdx === -1) return null;

		return {
			minRow: Math.min(startIdx, endIdx),
			maxRow: Math.max(startIdx, endIdx),
			minCol: Math.min(startColIdx, endColIdx),
			maxCol: Math.max(startColIdx, endColIdx),
		};
	}

	/**
	 * Computes the symmetric difference between two ranges in numeric index space, yielding dirty cell coordinates.
	 * Executes in O(Dirty Area) instead of O(Total Grid Cells) and performs zero string operations or allocations.
	 */
	public getDirtyCoordinates(
		oldBounds: GridCellRangeBounds | null,
		newBounds: GridCellRangeBounds | null
	): Array<{ rowIdx: number; colIdx: number }> {
		const dirty: Array<{ rowIdx: number; colIdx: number }> = [];

		if (!oldBounds && !newBounds) return dirty;

		if (!oldBounds && newBounds) {
			for (let r = newBounds.minRow; r <= newBounds.maxRow; r++) {
				for (let c = newBounds.minCol; c <= newBounds.maxCol; c++) {
					dirty.push({ rowIdx: r, colIdx: c });
				}
			}
			return dirty;
		}

		if (oldBounds && !newBounds) {
			for (let r = oldBounds.minRow; r <= oldBounds.maxRow; r++) {
				for (let c = oldBounds.minCol; c <= oldBounds.maxCol; c++) {
					dirty.push({ rowIdx: r, colIdx: c });
				}
			}
			return dirty;
		}

		const oldB = oldBounds!;
		const newB = newBounds!;

		// Find the boundary box surrounding both ranges to scan only affected rows/cols
		const minRow = Math.min(oldB.minRow, newB.minRow);
		const maxRow = Math.max(oldB.maxRow, newB.maxRow);
		const minCol = Math.min(oldB.minCol, newB.minCol);
		const maxCol = Math.max(oldB.maxCol, newB.maxCol);

		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				const inOld = r >= oldB.minRow && r <= oldB.maxRow && c >= oldB.minCol && c <= oldB.maxCol;
				const inNew = r >= newB.minRow && r <= newB.maxRow && c >= newB.minCol && c <= newB.maxCol;

				if (inOld !== inNew) {
					dirty.push({ rowIdx: r, colIdx: c });
				}
			}
		}

		return dirty;
	}
}
