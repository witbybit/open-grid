import type {
	ColumnDef,
	GridCellRange,
	GridCellRangeBounds,
	GridCellPointer,
	GridSelectionSource,
	GridSelectionState,
	RowModel,
	SelectionChangeResult,
} from '../store.js';

export class SelectionModel {
	private state: GridSelectionState = {
		focus: null,
		anchor: null,
		range: null,
		bounds: null,
		source: 'program',
	};

	public init(): void {}

	public getState(): GridSelectionState {
		return this.state;
	}

	public setSelection(selection: Partial<GridSelectionState>): GridSelectionState {
		const next = {
			...this.state,
			...selection,
		};
		if (
			next.focus === this.state.focus &&
			next.anchor === this.state.anchor &&
			next.range === this.state.range &&
			next.bounds === this.state.bounds &&
			next.source === this.state.source
		) {
			return this.state;
		}
		this.state = next;
		return this.state;
	}

	public createCellSelection(pointer: GridCellPointer | null, source: GridSelectionSource = 'program'): GridSelectionState {
		return {
			focus: pointer,
			anchor: pointer,
			range: pointer ? { start: pointer, end: pointer } : null,
			bounds: null,
			source,
		};
	}

	public extendSelection(anchor: GridCellPointer | null, end: GridCellPointer, source: GridSelectionSource = 'program'): GridSelectionState {
		const start = anchor ?? this.state.anchor ?? this.state.focus ?? end;
		return {
			focus: end,
			anchor: start,
			range: { start, end },
			bounds: null,
			source,
		};
	}

	public isRowSelected(rowIndex: number): boolean {
		const bounds = this.state.bounds;
		return !!bounds && rowIndex >= bounds.minRow && rowIndex <= bounds.maxRow;
	}

	public isCellSelected(rowIndex: number, colIndex: number): boolean {
		const bounds = this.state.bounds;
		return !!bounds && rowIndex >= bounds.minRow && rowIndex <= bounds.maxRow && colIndex >= bounds.minCol && colIndex <= bounds.maxCol;
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

	public forEachDirtyCoordinateInViewport(
		oldBounds: GridCellRangeBounds | null,
		newBounds: GridCellRangeBounds | null,
		viewport: GridCellRangeBounds,
		visit: (rowIdx: number, colIdx: number) => void
	): void {
		if (!oldBounds && !newBounds) return;

		const minRow = Math.max(viewport.minRow, Math.min(oldBounds?.minRow ?? newBounds!.minRow, newBounds?.minRow ?? oldBounds!.minRow));
		const maxRow = Math.min(viewport.maxRow, Math.max(oldBounds?.maxRow ?? newBounds!.maxRow, newBounds?.maxRow ?? oldBounds!.maxRow));
		const minCol = Math.max(viewport.minCol, Math.min(oldBounds?.minCol ?? newBounds!.minCol, newBounds?.minCol ?? oldBounds!.minCol));
		const maxCol = Math.min(viewport.maxCol, Math.max(oldBounds?.maxCol ?? newBounds!.maxCol, newBounds?.maxCol ?? oldBounds!.maxCol));

		if (minRow > maxRow || minCol > maxCol) return;

		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				const inOld = !!oldBounds && r >= oldBounds.minRow && r <= oldBounds.maxRow && c >= oldBounds.minCol && c <= oldBounds.maxCol;
				const inNew = !!newBounds && r >= newBounds.minRow && r <= newBounds.maxRow && c >= newBounds.minCol && c <= newBounds.maxCol;

				if (inOld !== inNew) {
					visit(r, c);
				}
			}
		}
	}

	public describeChange<TRowData>(
		prevSelection: GridSelectionState,
		nextSelection: GridSelectionState,
		rowModel: RowModel<TRowData> | null,
		columns: ColumnDef<TRowData>[]
	): SelectionChangeResult {
		const invalidatedCells: GridCellPointer[] = [];
		const invalidatedRows: string[] = [];
		const seenCells = new Set<string>();
		const seenRows = new Set<string>();
		const addCell = (cell: GridCellPointer | null) => {
			if (!cell) return;
			const key = `${cell.rowId}:${cell.colField}`;
			if (seenCells.has(key)) return;
			seenCells.add(key);
			invalidatedCells.push(cell);
		};
		const addRow = (rowId: string | null | undefined) => {
			if (!rowId || seenRows.has(rowId)) return;
			seenRows.add(rowId);
			invalidatedRows.push(rowId);
		};

		addCell(prevSelection.focus);
		addCell(nextSelection.focus);
		addRow(prevSelection.focus?.rowId);
		addRow(nextSelection.focus?.rowId);

		if (rowModel) {
			const dirty = this.getDirtyCoordinates(prevSelection.bounds, nextSelection.bounds);
			for (const { rowIdx, colIdx } of dirty) {
				const visualRow = rowModel.getVisualRow(rowIdx);
				const col = columns[colIdx];
				if (visualRow?.kind === 'data' && col) {
					addCell({ rowId: visualRow.rowId, colField: col.field });
					addRow(visualRow.rowId);
				} else if (visualRow) {
					addRow(visualRow.id);
				}
			}
		}

		return {
			invalidatedCells,
			invalidatedRows,
			overlayChanged: prevSelection.bounds !== nextSelection.bounds || prevSelection.focus !== nextSelection.focus,
		};
	}
}
