import type { RowModel, RowModelRefreshResult } from '../rowModel.js';
import type { VisualRow } from '../visualRow.js';
import type { RowNode } from '../rowNode.js';

export interface MinimalRowModelOptions<TRowData> {
	visualRows: VisualRow<TRowData>[];
	getRowNodeById?: (rowId: string) => RowNode<TRowData> | null;
	getRawRowById?: (rowId: string) => TRowData | null;
}

export function createMinimalRowModel<TRowData>(options: MinimalRowModelOptions<TRowData>): RowModel<TRowData> {
	return {
		getVisualRow: (index) => options.visualRows[index] ?? null,
		getVisualRowCount: () => options.visualRows.length,
		getVisualIndexById: (id) => options.visualRows.findIndex((row) => row.id === id),
		getVisualIndexByRowId: (id) => options.visualRows.findIndex((row) => row.kind === 'data' && row.rowId === id),
		getRowNodeById: options.getRowNodeById ?? (() => null),
		getRawRowById: options.getRawRowById ?? (() => null),
		refresh: (): RowModelRefreshResult => ({ changed: false }),
	};
}
