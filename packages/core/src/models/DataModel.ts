import { RowNode, compilePathGetter, type ColumnDef } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { isRawLoadingRowId } from '../ids.js';

export class DataModel<TRowData = unknown> {
	private engine!: GridEngine<TRowData>;
	private autoRowIdMap = new WeakMap<object, string>();
	private autoRowIdCounter = 0;
	private compiledGetters = new Map<string, (data: TRowData) => unknown>();
	private valueGetterCache = new Map<string, Map<string, unknown>>();

	public init(engine: GridEngine<TRowData>): void {
		this.engine = engine;
	}

	public getRowId = (row: TRowData): string => {
		const state = this.engine.stateManager.getState();
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
		return isRawLoadingRowId(rowId);
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

		const rowModel = this.engine.getRowModel();
		if (!rowModel) return '';
		const col = this.engine.columns.getColumnDef(colField);
		if (!col) return '';

		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		if (!node) {
			const idx = rowModel.getRowIndexById(rowId);
			if (idx === -1) return '';
			const row = rowModel.getRow(idx);
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

	private getStoredCellValue = (rowId: string, colField: string): unknown => {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		const rowModel = this.engine.getRowModel();
		if (!rowModel) return '';
		const col = this.engine.columns.getColumnDef(colField);
		if (!col) return '';

		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		const row =
			node?.data ??
			(() => {
				const idx = rowModel.getRowIndexById(rowId);
				return idx === -1 ? null : rowModel.getRow(idx);
			})();
		if (!row) return '';

		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		return getter(row);
	};

	public getCellValue = (rowId: string, colField: string): unknown => {
		const rawVal = this.getRawCellValue(rowId, colField);
		if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
			if (!this.engine.hasFormula(rowId, colField) || this.engine.getFormula(rowId, colField) !== rawVal) {
				this.engine.syncFormulaForCell(rowId, colField, rawVal);
			}
		} else {
			if (this.engine.hasFormula(rowId, colField)) {
				this.engine.syncFormulaForCell(rowId, colField, rawVal);
			}
		}

		if (this.engine.hasFormula(rowId, colField)) {
			return this.engine.evaluateFormulaCell(rowId, colField, (rId, cField) => this.getRawCellValue(rId, cField));
		}

		return rawVal;
	};

	public setCellValue = (rowId: string, colField: string, value: unknown): boolean => {
		const oldValue = this.getCellValue(rowId, colField);
		const oldStoredValue = this.getStoredCellValue(rowId, colField);
		if (oldStoredValue === value) return false;

		const rowModel = this.engine.getRowModel();
		if (!rowModel?.setCellValue) {
			return false;
		}

		const hadFormula = this.engine.hasFormula(rowId, colField);
		const previousFormula = this.engine.getFormula(rowId, colField);

		this.engine.syncFormulaForCell(rowId, colField, value);

		const applied = rowModel.setCellValue(rowId, colField, value);
		if (!applied) {
			if (hadFormula && previousFormula !== undefined) {
				this.engine.syncFormulaForCell(rowId, colField, previousFormula);
			} else {
				this.engine.syncFormulaForCell(rowId, colField, undefined);
			}
			return false;
		}

		// Invalidate this cell and any formula dependents.
		const invalidatedKeys = this.engine.invalidateFormulaCell(rowId, colField);

		// Also invalidate explicitly declared dynamic valueGetter dependents on this same row.
		// Uses the column reverse index so wide grids pay O(actual dependents), not O(total columns).
		for (const dependentField of this.engine.columns.getValueGetterDependents(colField)) {
			if (dependentField !== colField) {
				const key = `${rowId}:${dependentField}`;
				if (!invalidatedKeys.includes(key)) invalidatedKeys.push(key);
			}
		}

		for (const key of invalidatedKeys) {
			const colonIdx = key.indexOf(':');
			const rId = colonIdx === -1 ? key : key.substring(0, colonIdx);
			const cField = colonIdx === -1 ? '' : key.substring(colonIdx + 1);
			this.clearValueGetterCache(rId, cField);
		}

		if (this.engine.batchedUpdates) {
			// Batch cell notifications for better performance
			for (const key of invalidatedKeys) {
				this.engine.cellUpdateBatch.add(key);
			}

			// Schedule batched flush if not already scheduled
			if (!this.engine.batchFlushScheduled) {
				this.engine.batchFlushScheduled = true;
				if (typeof requestAnimationFrame !== 'undefined') {
					requestAnimationFrame(() => {
						this.engine.flushCellUpdates();
					});
				} else {
					Promise.resolve().then(() => {
						this.engine.flushCellUpdates();
					});
				}
			}
		} else {
			// Immediate mode: notify synchronously
			for (const key of invalidatedKeys) {
				const colonIdx = key.indexOf(':');
				const rId = colonIdx === -1 ? key : key.substring(0, colonIdx);
				const cField = colonIdx === -1 ? '' : key.substring(colonIdx + 1);
				this.engine.notifyCellChange(rId, cField);
			}
		}

		// Trigger cellValueChanged event
		this.engine.eventBus.dispatchEvent('cellValueChanged', {
			rowId,
			colField,
			oldValue,
			newValue: value,
		});
		return true;
	};
}
