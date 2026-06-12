import type { GridEngine } from '../engine/GridEngine.js';

export class GeometryController<TRowData = unknown> {
	private allInvalid = false;
	private invalidRows = new Set<string>();
	private invalidColumns = new Set<string>();
	private rowHeightUpdates = new Map<string, number>();
	private columnWidthUpdates = new Map<string, number>();
	private readonly engine: GridEngine<TRowData>;

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

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
		this.rowHeightUpdates.set(rowId, height);
		this.invalidRows.add(rowId);
	}

	public updateColumnWidth(colId: string, width: number): void {
		this.columnWidthUpdates.set(colId, width);
		this.invalidColumns.add(colId);
	}

	public recomputeIfNeeded(): void {
		if (!this.allInvalid && this.invalidRows.size === 0 && this.invalidColumns.size === 0) return;

		const state = this.engine.stateManager.getState();
		if (this.invalidColumns.size > 0 || this.allInvalid) {
			this.engine.columns.updateColumns(state.columns, state.columnWidths, state.defaultColWidth);
		}
		if (this.engine.getRowModel() && (this.invalidRows.size > 0 || this.allInvalid)) {
			const heights: number[] = [];
			const rowModel = this.engine.getRowModel()!;
			for (let i = 0; i < rowModel.getVisualRowCount(); i++) {
				const row = rowModel.getVisualRow(i);
				heights.push(row ? (row.height ?? state.rowHeights[row.id] ?? state.defaultRowHeight) : state.defaultRowHeight);
			}
			this.engine.geometry.updateRows(heights, state.defaultRowHeight);
		}

		this.allInvalid = false;
		this.invalidRows.clear();
		this.invalidColumns.clear();
		this.rowHeightUpdates.clear();
		this.columnWidthUpdates.clear();
	}
}
