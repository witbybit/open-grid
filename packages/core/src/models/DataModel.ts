import { RowNode, compilePathGetter, type ColumnDef } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';

export class DataModel<TRowData = unknown> {
	private engine!: GridEngine<TRowData>;
	private autoRowIdMap = new WeakMap<any, string>();
	private autoRowIdCounter = 0;
	private compiledGetters = new Map<string, (data: TRowData) => any>();

	public init(engine: GridEngine<TRowData>): void {
		this.engine = engine;
	}

	public getRowId = (row: TRowData): string => {
		const state = this.engine.stateManager.getState();
		if (state.getRowId) {
			return state.getRowId(row);
		}
		if (typeof row === 'object' && row !== null) {
			const anyRow = row as any;
			if (anyRow.id !== undefined && anyRow.id !== null) {
				return String(anyRow.id);
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
		for (let i = 0; i < columns.length; i++) {
			const col = columns[i];
			if (col.field) {
				this.compiledGetters.set(col.field, compilePathGetter(col.field));
			}
		}
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
				return col.valueGetter({ node: dummyNode, row, colField });
			}
			const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
			return getter(row);
		}

		if (col.valueGetter) {
			return col.valueGetter({ node, row: node.data, colField });
		}
		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		return node.getCellValue(colField, getter);
	};

	public getCellValue = (rowId: string, colField: string): unknown => {
		const rawVal = this.getRawCellValue(rowId, colField);
		if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
			if (!this.engine.dagEngine.hasFormula(rowId, colField) || this.engine.dagEngine.getFormula(rowId, colField) !== rawVal) {
				this.engine.dagEngine.registerFormula(rowId, colField, rawVal);
			}
		} else {
			if (this.engine.dagEngine.hasFormula(rowId, colField)) {
				this.engine.dagEngine.clearFormula(rowId, colField);
			}
		}

		if (this.engine.dagEngine.hasFormula(rowId, colField)) {
			return this.engine.dagEngine.getCellValue(rowId, colField, (rId, cField) => this.getRawCellValue(rId, cField));
		}

		return rawVal;
	};

	public setCellValue = (rowId: string, colField: string, value: unknown): boolean => {
		const oldValue = this.getCellValue(rowId, colField);
		const oldRawValue = this.getRawCellValue(rowId, colField);
		if (oldRawValue === value) return false;

		const rowModel = this.engine.getRowModel();
		if (!rowModel?.setCellValue) {
			return false;
		}

		const hadFormula = this.engine.dagEngine.hasFormula(rowId, colField);
		const previousFormula = this.engine.dagEngine.getFormula(rowId, colField);

		if (typeof value === 'string' && value.startsWith('=')) {
			this.engine.dagEngine.registerFormula(rowId, colField, value);
		} else {
			this.engine.dagEngine.clearFormula(rowId, colField);
		}

		const applied = rowModel.setCellValue(rowId, colField, value);
		if (!applied) {
			if (hadFormula && previousFormula !== undefined) {
				this.engine.dagEngine.registerFormula(rowId, colField, previousFormula);
			} else {
				this.engine.dagEngine.clearFormula(rowId, colField);
			}
			return false;
		}

		// Invalidate this cell and all its dependents in the DAG engine
		const invalidatedKeys = this.engine.dagEngine.invalidateCell(rowId, colField);

		// Also invalidate any dynamic valueGetter columns on this same row
		const state = this.engine.stateManager.getState();
		for (let i = 0; i < state.columns.length; i++) {
			const col = state.columns[i];
			if (col.valueGetter) {
				const key = `${rowId}:${col.field}`;
				if (!invalidatedKeys.includes(key)) {
					invalidatedKeys.push(key);
				}
			}
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
