import type { GridCellRange, GridRowsAccessor } from './api/GridApi.js';
import type { VisualRow } from './visualRow.js';
import type { RowNode } from './rowNode.js';
import type { RowModel } from './store.js';

/** Minimal interface required to build a GridRowsAccessor from a GridStore. */
export interface RowsAccessorSource<TRowData> {
	getVisualRowCount(): number;
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getDataRowAtVisualIndex(index: number): TRowData | null;
	getVisualIndexByRowId(rowId: string): number | null;
	getRawRowById(rowId: string): TRowData | null;
	getRowNodeById(rowId: string): RowNode<TRowData> | null;
	getRowModel(): RowModel<TRowData> | null;
	getState(): { selection: { bounds: { minRow: number; maxRow: number } | null }; selectedRowIds: string[] };
}

export function createRowsAccessor<TRowData>(src: RowsAccessorSource<TRowData>): GridRowsAccessor<TRowData> {
	return {
		forEach: (callback) => {
			const count = src.getVisualRowCount();
			let dataIndex = 0;
			for (let i = 0; i < count; i++) {
				const row = src.getDataRowAtVisualIndex(i);
				if (row !== null) {
					callback(row, dataIndex++);
				}
			}
		},
		getAll: () => {
			const count = src.getVisualRowCount();
			const rows: TRowData[] = [];
			for (let i = 0; i < count; i++) {
				const row = src.getDataRowAtVisualIndex(i);
				if (row !== null) {
					rows.push(row);
				}
			}
			return rows;
		},
		getSelected: () => {
			const bounds = src.getState().selection.bounds;
			if (!bounds) return [];
			const rows: TRowData[] = [];
			for (let i = bounds.minRow; i <= bounds.maxRow; i++) {
				const row = src.getDataRowAtVisualIndex(i);
				if (row !== null) {
					rows.push(row);
				}
			}
			return rows;
		},
		getSelectedIds: () => {
			const bounds = src.getState().selection.bounds;
			if (!bounds) return [];
			const ids: string[] = [];
			for (let i = bounds.minRow; i <= bounds.maxRow; i++) {
				const vr = src.getVisualRow(i);
				if (vr?.kind === 'data') {
					ids.push(vr.rowId);
				}
			}
			return ids;
		},
		getById: (id) => {
			return src.getRawRowById(id);
		},
		getNodeById: (id) => {
			return src.getRowNodeById(id);
		},
		getCount: () => {
			const count = src.getVisualRowCount();
			let dataCount = 0;
			for (let i = 0; i < count; i++) {
				const vr = src.getVisualRow(i);
				if (vr?.kind === 'data') {
					dataCount++;
				}
			}
			return dataCount;
		},
		getVisualRowById: (id) => {
			const index = src.getVisualIndexByRowId(id);
			if (index === null || index === -1) return null;
			return src.getVisualRow(index);
		},
		inRange: (range: GridCellRange) => {
			const startIdx = src.getVisualIndexByRowId(range.start.rowId);
			const endIdx = src.getVisualIndexByRowId(range.end.rowId);
			const hasValidIndices = startIdx !== null && endIdx !== null && startIdx !== -1 && endIdx !== -1;

			return {
				forEach: (callback) => {
					if (!hasValidIndices) return;
					const minRow = Math.min(startIdx!, endIdx!);
					const maxRow = Math.max(startIdx!, endIdx!);
					let idx = 0;
					for (let i = minRow; i <= maxRow; i++) {
						const vr = src.getVisualRow(i);
						if (vr?.kind === 'data') {
							callback(vr.rowId, idx++);
						}
					}
				},
				getIds: () => {
					if (!hasValidIndices) return [];
					const minRow = Math.min(startIdx!, endIdx!);
					const maxRow = Math.max(startIdx!, endIdx!);
					const ids: string[] = [];
					for (let i = minRow; i <= maxRow; i++) {
						const vr = src.getVisualRow(i);
						if (vr?.kind === 'data') {
							ids.push(vr.rowId);
						}
					}
					return ids;
				},
				getData: () => {
					if (!hasValidIndices) return [];
					const minRow = Math.min(startIdx!, endIdx!);
					const maxRow = Math.max(startIdx!, endIdx!);
					const data: TRowData[] = [];
					for (let i = minRow; i <= maxRow; i++) {
						const row = src.getDataRowAtVisualIndex(i);
						if (row !== null) {
							data.push(row);
						}
					}
					return data;
				},
			};
		},
		getChecked: (): TRowData[] => {
			const checkedSet = new Set(src.getState().selectedRowIds);
			const result: TRowData[] = [];
			const rowModel = src.getRowModel();
			if (rowModel) {
				const count = rowModel.getVisualRowCount();
				for (let i = 0; i < count; i++) {
					const vr = rowModel.getVisualRow(i);
					if (vr?.kind === 'data' && checkedSet.has(vr.rowId)) {
						const node = rowModel.getRowNodeById(vr.rowId);
						if (node) result.push(node.data);
					}
				}
			}
			return result;
		},
		getCheckedIds: (): string[] => {
			return [...src.getState().selectedRowIds];
		},
	};
}
