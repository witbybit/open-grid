import type { ColumnDef } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import type { InternalGridState } from '../state/GridState.js';
import type { GridEventPayloadMap } from '../api/GridEvents.js';
import { GridEventName } from '../api/GridEvents.js';

interface ClipboardContext<TRowData> {
	getState(): InternalGridState<TRowData>;
	getVisualRow(rowIdx: number): VisualRow<TRowData> | null;
	getVisualIndexByRowId(rowId: string): number | null;
	getColumnIndex(colField: string): number;
	getCellValue(rowId: string, colField: string): unknown;
	getCheapDisplayValue(rowId: string, colField: string): string;
	getRawRowById(rowId: string): TRowData | null;
	batchCellValues(updates: { rowId: string; colField: string; value: unknown }[], source: 'paste' | 'api' | 'fill'): void;
	dispatchEvent<K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void;
}

interface CopyResult {
	text: string;
	cells: Array<{ rowId: string; colField: string }>;
	rowCount: number;
	colCount: number;
}

export class ClipboardController<TRowData = unknown> {
	constructor(private readonly c: ClipboardContext<TRowData>) {}

	public async copySelectedRange(): Promise<void> {
		const state = this.c.getState();
		const selection = state.selection;
		const bounds = selection.bounds;

		if (!bounds) {
			const focus = selection.focus;
			if (!focus) return;
			const text = this._getCellText(focus.rowId, focus.colField, state);
			await this._writeToClipboard(text);
			this.c.dispatchEvent(GridEventName.cellsCopied, {
				cells: [{ rowId: focus.rowId, colField: focus.colField }],
				rowCount: 1,
				colCount: 1,
				text,
			});
			return;
		}

		await this._copyRange(bounds.minRow, bounds.maxRow, bounds.minCol, bounds.maxCol);
	}

	public async copyRange(minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void> {
		await this._copyRange(minRow, maxRow, minCol, maxCol);
	}

	public async pasteFromClipboard(): Promise<void> {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		const state = this.c.getState();
		const selection = state.selection;
		const focus = selection.focus;
		if (!focus) return;

		const focusRowIdx = this.c.getVisualIndexByRowId(focus.rowId) ?? -1;
		const focusColIdx = this.c.getColumnIndex(focus.colField);
		if (focusRowIdx === -1 || focusColIdx === -1) return;

		const startRow = selection.bounds ? selection.bounds.minRow : focusRowIdx;
		const startCol = selection.bounds ? selection.bounds.minCol : focusColIdx;

		try {
			const text = await navigator.clipboard.readText();
			if (!text) return;

			const lines = text.split(/\r?\n/);
			const updates: { rowId: string; colField: string; value: unknown }[] = [];
			let pastedRows = 0;
			let pastedCols = 0;

			for (let r = 0; r < lines.length; r++) {
				if (!lines[r] && r === lines.length - 1) break; // skip trailing newline
				const vr = this.c.getVisualRow(startRow + r);
				if (!vr || vr.kind !== 'data') continue;
				const rowId = vr.rowId;
				const cells = lines[r].split('\t');
				let colsPasted = 0;
				for (let c = 0; c < cells.length; c++) {
					const col = state.columns[startCol + c] as ColumnDef<TRowData> | undefined;
					if (!col) break;
					let value: unknown = cells[c];
					if (col.onPaste) {
						const row = this.c.getRawRowById(rowId);
						if (row !== null) value = col.onPaste({ row, rowId, colField: col.field, pastedText: cells[c] });
					}
					updates.push({ rowId, colField: col.field, value });
					colsPasted++;
				}
				pastedRows++;
				if (colsPasted > pastedCols) pastedCols = colsPasted;
			}

			if (updates.length > 0) {
				this.c.batchCellValues(updates, 'paste');
				this.c.dispatchEvent(GridEventName.cellsPasted, { rowCount: pastedRows, colCount: pastedCols });
			}
		} catch {
			// Clipboard access denied — silently ignore
		}
	}

	private async _copyRange(minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void> {
		const state = this.c.getState();
		const result = this._buildTsv(minRow, maxRow, minCol, maxCol, state);
		if (!result) return;
		await this._writeToClipboard(result.text);
		this.c.dispatchEvent(GridEventName.cellsCopied, {
			cells: result.cells,
			rowCount: result.rowCount,
			colCount: result.colCount,
			text: result.text,
		});
	}

	private _buildTsv(minRow: number, maxRow: number, minCol: number, maxCol: number, state: InternalGridState<TRowData>): CopyResult | null {
		const cells: Array<{ rowId: string; colField: string }> = [];
		const rows: string[] = [];

		for (let r = minRow; r <= maxRow; r++) {
			const vr = this.c.getVisualRow(r);
			if (!vr || vr.kind !== 'data') continue;
			const rowCells: string[] = [];
			for (let c = minCol; c <= maxCol; c++) {
				const col = state.columns[c] as ColumnDef<TRowData> | undefined;
				if (!col) continue;
				rowCells.push(this._getCellText(vr.rowId, col.field, state));
				cells.push({ rowId: vr.rowId, colField: col.field });
			}
			rows.push(rowCells.join('\t'));
		}

		if (rows.length === 0) return null;
		return {
			text: rows.join('\n'),
			cells,
			rowCount: maxRow - minRow + 1,
			colCount: maxCol - minCol + 1,
		};
	}

	private _getCellText(rowId: string, colField: string, state: InternalGridState<TRowData>): string {
		const col = state.columns.find((c) => c.field === colField) as ColumnDef<TRowData> | undefined;
		if (col?.onCopy) {
			const row = this.c.getRawRowById(rowId);
			if (row !== null) {
				return col.onCopy({ row, rowId, colField, value: this.c.getCellValue(rowId, colField) });
			}
		}
		if (col?.valueFormatter) {
			const value = this.c.getCellValue(rowId, colField);
			const rowData = this.c.getRawRowById(rowId) as TRowData;
			return col.valueFormatter({ value, rowData, colDef: col, rowId });
		}
		return this.c.getCheapDisplayValue(rowId, colField);
	}

	private async _writeToClipboard(text: string): Promise<void> {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		await navigator.clipboard.writeText(text).catch(() => {});
	}
}
