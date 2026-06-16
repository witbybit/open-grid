import { createFormulaRefKey } from '../ids.js';
import type { GridCellRange, ColumnDef, RowModel } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';

type FillDirection = 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';

interface CapturedCell {
	value: unknown;
	hasFormula: boolean;
	formula?: string;
}

interface FillSeries {
	allNumeric: boolean;
	baseNum: number;
	step: number;
}

interface FillRecord extends CapturedCell {
	rowId: string;
	colField: string;
}

export class SpreadsheetFillEngine<TRowData = unknown> {
	constructor(private readonly engine: GridEngine<TRowData>) {}

	public fillRange(source: GridCellRange, target: GridCellRange): void {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return;

		const state = this.engine.stateManager.getState();
		const columns = state.columns;

		const sourceBounds = this.resolveRangeBounds(source);
		const targetBounds = this.resolveRangeBounds(target);
		if (!sourceBounds || !targetBounds) return;

		let direction: FillDirection = 'DOWN';
		if (targetBounds.minRow > sourceBounds.maxRow) direction = 'DOWN';
		else if (targetBounds.maxRow < sourceBounds.minRow) direction = 'UP';
		else if (targetBounds.minCol > sourceBounds.maxCol) direction = 'RIGHT';
		else if (targetBounds.maxCol < sourceBounds.minCol) direction = 'LEFT';

		const oldValueRecord: FillRecord[] = [];
		const newValueRecord: FillRecord[] = [];

		if (direction === 'DOWN' || direction === 'UP') {
			this.fillRows(direction, sourceBounds, targetBounds, rowModel, columns, oldValueRecord, newValueRecord);
		}

		if (direction === 'RIGHT' || direction === 'LEFT') {
			this.fillColumns(direction, sourceBounds, targetBounds, rowModel, columns, oldValueRecord, newValueRecord);
		}

		if (newValueRecord.length > 0) {
			this.engine.commandHistory.add({
				undo: () => this.restoreRecords(oldValueRecord),
				redo: () => this.restoreRecords(newValueRecord),
			});
		}
	}

	private fillRows(
		direction: FillDirection,
		sourceBounds: GridBounds,
		targetBounds: GridBounds,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[],
		oldValueRecord: FillRecord[],
		newValueRecord: FillRecord[]
	): void {
		const fillRows = this.buildOrderedIndexes(targetBounds.minRow, targetBounds.maxRow, direction === 'UP');
		for (let c = targetBounds.minCol; c <= targetBounds.maxCol; c++) {
			const col = columns[c];
			if (!col) continue;

			const sourceValues: CapturedCell[] = [];
			for (let r = sourceBounds.minRow; r <= sourceBounds.maxRow; r++) {
				const visualRow = rowModel.getVisualRow(r);
				if (visualRow?.kind === 'data') sourceValues.push(this.captureCell(visualRow.rowId, col.field));
			}

			if (sourceValues.length === 0) continue;

			const series = this.analyzeFillSeries(sourceValues);
			fillRows.forEach((r, idx) => {
				const visualRow = rowModel.getVisualRow(r);
				if (visualRow?.kind !== 'data') return;

				const srcItem = sourceValues[idx % sourceValues.length];
				const deltaRow = r - (direction === 'DOWN' ? sourceBounds.maxRow : sourceBounds.minRow);
				this.applyFillValue(visualRow.rowId, col.field, idx, srcItem, series, deltaRow, 0, rowModel, columns, oldValueRecord, newValueRecord);
			});
		}
	}

	private fillColumns(
		direction: FillDirection,
		sourceBounds: GridBounds,
		targetBounds: GridBounds,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[],
		oldValueRecord: FillRecord[],
		newValueRecord: FillRecord[]
	): void {
		const fillCols = this.buildOrderedIndexes(targetBounds.minCol, targetBounds.maxCol, direction === 'LEFT');
		for (let r = targetBounds.minRow; r <= targetBounds.maxRow; r++) {
			const visualRow = rowModel.getVisualRow(r);
			if (visualRow?.kind !== 'data') continue;

			const sourceValues: CapturedCell[] = [];
			for (let c = sourceBounds.minCol; c <= sourceBounds.maxCol; c++) {
				const col = columns[c];
				if (col) sourceValues.push(this.captureCell(visualRow.rowId, col.field));
			}

			if (sourceValues.length === 0) continue;

			const series = this.analyzeFillSeries(sourceValues);
			fillCols.forEach((c, idx) => {
				const col = columns[c];
				if (!col) return;

				const srcItem = sourceValues[idx % sourceValues.length];
				const deltaCol = c - (direction === 'RIGHT' ? sourceBounds.maxCol : sourceBounds.minCol);
				this.applyFillValue(visualRow.rowId, col.field, idx, srcItem, series, 0, deltaCol, rowModel, columns, oldValueRecord, newValueRecord);
			});
		}
	}

	private restoreRecords(records: FillRecord[]): void {
		for (const item of records) {
			const restoreValue = item.hasFormula && item.formula ? item.formula : item.value;
			this.engine.dataMutation.applyCellValueChange(item.rowId, item.colField, restoreValue, {
				undoable: false,
				source: 'undo',
			});
		}
	}

	private resolveRangeBounds(range: GridCellRange): GridBounds | null {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return null;

		const startRowIdx = rowModel.getVisualIndexByRowId(range.start.rowId);
		const endRowIdx = rowModel.getVisualIndexByRowId(range.end.rowId);
		const startColIdx = this.engine.columns.getColumnIndex(range.start.colField);
		const endColIdx = this.engine.columns.getColumnIndex(range.end.colField);

		if (startRowIdx < 0 || endRowIdx < 0 || startColIdx < 0 || endColIdx < 0) return null;

		return {
			minRow: Math.min(startRowIdx, endRowIdx),
			maxRow: Math.max(startRowIdx, endRowIdx),
			minCol: Math.min(startColIdx, endColIdx),
			maxCol: Math.max(startColIdx, endColIdx),
		};
	}

	private buildOrderedIndexes(start: number, end: number, reverse: boolean): number[] {
		const indexes: number[] = [];
		if (reverse) {
			for (let i = end; i >= start; i--) indexes.push(i);
		} else {
			for (let i = start; i <= end; i++) indexes.push(i);
		}
		return indexes;
	}

	private captureCell(rowId: string, colField: string): CapturedCell {
		const hasFormula = this.engine.hasFormula(rowId, colField);
		return {
			value: this.engine.data.getCellValue(rowId, colField),
			hasFormula,
			formula: hasFormula ? this.engine.getFormula(rowId, colField) : undefined,
		};
	}

	private analyzeFillSeries(sourceValues: Array<{ value: unknown; hasFormula: boolean }>): FillSeries {
		const allNumeric = sourceValues.every((s) => !s.hasFormula && !Number.isNaN(parseFloat(String(s.value))) && s.value !== '');
		if (!allNumeric || sourceValues.length === 0) return { allNumeric: false, baseNum: 0, step: 0 };

		const numbers = sourceValues.map((s) => parseFloat(String(s.value)));
		if (numbers.length === 1) return { allNumeric: true, baseNum: numbers[0], step: 0 };

		let diffSum = 0;
		for (let i = 0; i < numbers.length - 1; i++) {
			diffSum += numbers[i + 1] - numbers[i];
		}
		return { allNumeric: true, baseNum: numbers[numbers.length - 1], step: diffSum / (numbers.length - 1) };
	}

	private applyFillValue(
		rowId: string,
		colField: string,
		index: number,
		source: CapturedCell,
		series: FillSeries,
		deltaRow: number,
		deltaCol: number,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[],
		oldValueRecord: FillRecord[],
		newValueRecord: FillRecord[]
	): void {
		const oldValue = this.captureCell(rowId, colField);
		let nextValue = source.value;
		let nextFormula: string | undefined;

		if (source.hasFormula && source.formula) {
			nextFormula = this.shiftFormulaReferences(source.formula, deltaRow, deltaCol, rowModel, columns);
			nextValue = nextFormula;
		} else if (series.allNumeric) {
			const finalVal = series.step === 0 ? series.baseNum : series.baseNum + series.step * (index + 1);
			nextValue = Number.isInteger(finalVal) ? finalVal : parseFloat(finalVal.toFixed(4));
		}

		const result = this.engine.dataMutation.applyCellValueChange(rowId, colField, nextValue, {
			undoable: false,
			source: 'fill',
		});
		if (!result.applied) return;

		oldValueRecord.push({ rowId, colField, ...oldValue });
		newValueRecord.push({
			rowId,
			colField,
			value: nextFormula ? undefined : nextValue,
			hasFormula: !!nextFormula,
			formula: nextFormula,
		});
	}

	private shiftFormulaReferences(
		formula: string,
		deltaRow: number,
		deltaCol: number,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[]
	): string {
		const regex = /\[([^\]:]+):([^\]:]+)\]/g;
		return formula.replace(regex, (_match, refRowId, refColField) => {
			let newRowId = refRowId;
			let newColField = refColField;

			if (deltaRow !== 0) {
				const rowIdx = rowModel.getVisualIndexByRowId(refRowId);
				if (rowIdx !== -1) {
					const newRowIdx = rowIdx + deltaRow;
					const newVisualRow = rowModel.getVisualRow(newRowIdx);
					if (newVisualRow?.kind === 'data') {
						newRowId = newVisualRow.rowId;
					}
				}
			}

			if (deltaCol !== 0) {
				const colIdx = this.engine.columns.getColumnIndex(refColField);
				if (colIdx !== -1) {
					const newColIdx = colIdx + deltaCol;
					const newCol = columns[newColIdx];
					if (newCol) {
						newColField = newCol.field;
					}
				}
			}

			return createFormulaRefKey(newRowId, newColField);
		});
	}
}

interface GridBounds {
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}
