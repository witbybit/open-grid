import { RowNode, compilePathGetter, type ColumnDef } from '../store.js';
import type { DataModelRuntime } from '../engine/runtimePorts.js';

export class DataModel<TRowData = unknown> {
	private autoRowIdMap = new WeakMap<object, string>();
	private autoRowIdCounter = 0;
	private compiledGetters = new Map<string, (data: TRowData) => unknown>();
	private valueGetterCache = new Map<string, Map<string, unknown>>();

	constructor(private readonly runtime: DataModelRuntime<TRowData>) {}

	public getRowId = (row: TRowData): string => {
		const state = this.runtime.getState();
		if (state.getRowId) {
			return state.getRowId(row);
		}
		if (typeof row === 'object' && row !== null) {
			const rowRecord = row as Record<string, unknown>;
			if (rowRecord.id !== undefined && rowRecord.id !== null) {
				return String(rowRecord.id);
			}
			let id = this.autoRowIdMap.get(row);
			if (id === undefined) {
				id = `__row_${this.autoRowIdCounter++}__`;
				this.autoRowIdMap.set(row, id);
			}
			return id;
		}
		return String(row);
	};

	public isRowLoading(rowId: string): boolean {
		return rowId.startsWith('__loading_');
	}

	public updateCompiledGetters(columns: ColumnDef<TRowData>[]): void {
		this.compiledGetters.clear();
		this.clearValueGetterCache();
		for (let i = 0; i < columns.length; i++) {
			const col = columns[i];
			if (col.field) {
				this.compiledGetters.set(col.field, compilePathGetter(col.field));
			}
		}
	}

	public clearValueGetterCache(rowId?: string, colField?: string): void {
		if (!rowId) {
			this.valueGetterCache.clear();
			return;
		}

		const rowCache = this.valueGetterCache.get(rowId);
		if (!rowCache) return;

		if (colField) {
			rowCache.delete(colField);
			if (rowCache.size === 0) {
				this.valueGetterCache.delete(rowId);
			}
			return;
		}

		this.valueGetterCache.delete(rowId);
	}

	private getValueGetterValue(rowId: string, colField: string, col: ColumnDef<TRowData>, node: RowNode<TRowData>): unknown {
		if (this.runtime.isScrolling() || this.runtime.isScrollFrameActive()) {
			this.runtime.recordValueGetterDuringScroll();
		}
		if (!col.valueGetterDependencies) {
			return col.valueGetter!({ node, row: node.data, colField });
		}

		let rowCache = this.valueGetterCache.get(rowId);
		if (!rowCache) {
			rowCache = new Map<string, unknown>();
			this.valueGetterCache.set(rowId, rowCache);
		}
		if (rowCache.has(colField)) {
			return rowCache.get(colField);
		}

		const value = col.valueGetter!({ node, row: node.data, colField });
		rowCache.set(colField, value);
		return value;
	}

	public getRawCellValue = (rowId: string, colField: string): unknown => {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return '';
		const col = this.runtime.getColumnDef(colField);
		if (!col) return '';

		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		if (!node) {
			const idx = rowModel.getVisualIndexByRowId(rowId);
			if (idx === -1) return '';
			const visualRow = rowModel.getVisualRow(idx);
			const row = visualRow?.kind === 'data' ? visualRow.node.data : null;
			if (!row) return '';
			if (col.valueGetter) {
				const dummyNode = new RowNode<TRowData>(rowId, row);
				return this.getValueGetterValue(rowId, colField, col, dummyNode);
			}
			const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
			return getter(row);
		}

		if (col.valueGetter) {
			return this.getValueGetterValue(rowId, colField, col, node);
		}
		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		return node.getCellValue(colField, getter);
	};

	public getStoredCellValue = (rowId: string, colField: string): unknown => {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return '';
		const col = this.runtime.getColumnDef(colField);
		if (!col) return '';

		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		const row =
			node?.data ??
			(() => {
				const idx = rowModel.getVisualIndexByRowId(rowId);
				if (idx === -1) return null;
				const visualRow = rowModel.getVisualRow(idx);
				return visualRow?.kind === 'data' ? visualRow.node.data : null;
			})();
		if (!row) return '';

		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		return getter(row);
	};

	public getCachedDisplayValue(rowId: string, colField: string): string | undefined {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		if (this.runtime.hasFormula(rowId, colField)) {
			const res = this.runtime.getCachedFormulaValue(rowId, colField);
			if (res.hasCached) {
				return res.value == null ? '' : String(res.value);
			}
			return undefined;
		}

		const col = this.runtime.getColumnDef(colField);
		if (col?.valueGetter) {
			const rowCache = this.valueGetterCache.get(rowId);
			if (rowCache && rowCache.has(colField)) {
				const val = rowCache.get(colField);
				return val == null ? '' : String(val);
			}
			return undefined;
		}

		const cheapVal = this.getCheapDisplayValue(rowId, colField);
		return cheapVal;
	}

	public getCheapDisplayValue(rowId: string, colField: string): string {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		const col = this.runtime.getColumnDef(colField);
		if (!col) return '';

		if (col.valueGetter || this.runtime.hasFormula(rowId, colField)) {
			const rowCache = this.valueGetterCache.get(rowId);
			if (rowCache && rowCache.has(colField)) {
				const val = rowCache.get(colField);
				return val == null ? '' : String(val);
			}
			if (this.runtime.hasFormula(rowId, colField)) {
				const res = this.runtime.getCachedFormulaValue(rowId, colField);
				if (res.hasCached) {
					return res.value == null ? '' : String(res.value);
				}
			}
			return '';
		}

		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return '';

		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		const row = node ? node.data : rowModel.getRawRowById ? rowModel.getRawRowById(rowId) : null;
		if (!row) return '';

		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		const rawVal = getter(row);
		return rawVal == null ? '' : String(rawVal);
	}

	public getComputedCellValue(rowId: string, colField: string): unknown {
		return this.getCellValue(rowId, colField);
	}

	public getCellValue = (rowId: string, colField: string): unknown => {
		if (this.runtime.isScrolling() || this.runtime.isScrollFrameActive()) {
			this.runtime.recordGetCellValueDuringScroll();
		}
		const rawVal = this.getRawCellValue(rowId, colField);
		if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
			if (!this.runtime.hasFormula(rowId, colField) || this.runtime.getFormula(rowId, colField) !== rawVal) {
				this.runtime.syncFormulaForCell(rowId, colField, rawVal);
			}
		} else {
			if (this.runtime.hasFormula(rowId, colField)) {
				this.runtime.syncFormulaForCell(rowId, colField, rawVal);
			}
		}

		if (this.runtime.hasFormula(rowId, colField)) {
			if (this.runtime.isScrolling() || this.runtime.isScrollFrameActive()) {
				this.runtime.recordFormulaDuringScroll();
			}
			return this.runtime.evaluateFormulaCell(rowId, colField, (rId, cField) => this.getRawCellValue(rId, cField));
		}

		return rawVal;
	};
}
