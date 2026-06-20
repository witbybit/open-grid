import type { DataModel } from '../models/DataModel.js';
import type { ColumnModel } from '../models/ColumnModel.js';
import type { FormulaCellCoordinate } from '../calculations/dagEngine.js';
import type { BatchCellValueUpdate, GridCellPointer } from '../api/GridApi.js';
import type { RowModel, CellValueWritableRowModel } from '../rowModel.js';

export type { BatchCellValueUpdate };

export interface CellValueChangeOptions {
	bypassValueSetter?: boolean;
	source?: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo' | 'transaction';
}

export interface CellValueChangeResult {
	applied: boolean;
	rowId: string;
	colField: string;
	oldRawValue: unknown;
	oldComputedValue: unknown;
	newRawValue: unknown;
	newComputedValue?: unknown;
	invalidatedCells: GridCellPointer[];
}

export interface DataMutationDeps<TRowData = unknown> {
	data: DataModel<TRowData>;
	columns: ColumnModel<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	invalidateFormulaCell: (rowId: string, colField: string) => FormulaCellCoordinate[];
}

export class DataMutationController<TRowData = unknown> {
	constructor(private readonly deps: DataMutationDeps<TRowData>) {}

	private getCellValueWritableRowModel(): CellValueWritableRowModel<TRowData> | null {
		const rowModel = this.deps.getRowModel();
		if (!rowModel) {
			return null;
		}
		const candidate = rowModel as unknown as Partial<CellValueWritableRowModel<TRowData>>;
		if (typeof candidate.setCellValue !== 'function') {
			return null;
		}
		return rowModel as unknown as CellValueWritableRowModel<TRowData>;
	}

	applyCellValueChange(rowId: string, colField: string, value: unknown, options: CellValueChangeOptions = {}): CellValueChangeResult {
		const notApplied = (oldRawValue: unknown, oldComputedValue: unknown): CellValueChangeResult => ({
			applied: false,
			rowId,
			colField,
			oldRawValue,
			oldComputedValue,
			newRawValue: value,
			invalidatedCells: [],
		});

		const col = this.deps.columns.getColumnDef(colField);
		const oldRawValue = this.deps.data.getRawCellValue(rowId, colField);
		const oldComputedValue = this.deps.data.getCellValue(rowId, colField);

		const oldStoredValue = col?.valueGetter ? this.deps.data.getStoredCellValue(rowId, colField) : oldRawValue;
		if (oldStoredValue === value) return notApplied(oldRawValue, oldComputedValue);

		const rowModel = this.getCellValueWritableRowModel();
		if (!rowModel) return notApplied(oldRawValue, oldComputedValue);

		const writeApplied = rowModel.setCellValue(rowId, colField, value, { bypassValueSetter: options.bypassValueSetter === true });
		if (!writeApplied) return notApplied(oldRawValue, oldComputedValue);

		this.deps.syncFormulaForCell(rowId, colField, value);

		const invalidatedFormulaCells = this.deps.invalidateFormulaCell(rowId, colField);
		const dependentFields = this.deps.columns.getValueGetterDependents(colField).filter((f) => f !== colField);

		const invalidatedCells: GridCellPointer[] = [{ rowId, colField }];
		const seen = new Set<string>();
		seen.add(rowId + ':' + colField);

		const addCell = (rId: string, cField: string): void => {
			const key = rId + ':' + cField;
			if (!seen.has(key)) {
				seen.add(key);
				invalidatedCells.push({ rowId: rId, colField: cField });
			}
		};

		for (const f of dependentFields) addCell(rowId, f);
		for (const c of invalidatedFormulaCells) addCell(c.rowId, c.colField);

		for (const c of invalidatedCells) {
			this.deps.data.clearValueGetterCache(c.rowId, c.colField);
		}

		const newComputedValue = this.deps.data.getCellValue(rowId, colField);

		return {
			applied: true,
			rowId,
			colField,
			oldRawValue,
			oldComputedValue,
			newRawValue: value,
			newComputedValue,
			invalidatedCells,
		};
	}
}
