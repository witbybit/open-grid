import { RowNode, GridEventName, compilePathGetter, type ColumnDef, type GridCellPointer } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';

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
		if (this.engine.isScrolling || this.engine.isScrollFrameActive) {
			this.engine.valueGetterCallsDuringScroll++;
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

		const rowModel = this.engine.getRowModel();
		if (!rowModel) return '';
		const col = this.engine.columns.getColumnDef(colField);
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

		const rowModel = this.engine.getRowModel();
		if (!rowModel) return '';
		const col = this.engine.columns.getColumnDef(colField);
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

		if (this.engine.hasFormula(rowId, colField)) {
			const res = this.engine.getCachedFormulaValue(rowId, colField);
			if (res.hasCached) {
				return res.value == null ? '' : String(res.value);
			}
			return undefined;
		}

		const col = this.engine.columns.getColumnDef(colField);
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

		const col = this.engine.columns.getColumnDef(colField);
		if (!col) return '';

		if (col.valueGetter || this.engine.hasFormula(rowId, colField)) {
			const rowCache = this.valueGetterCache.get(rowId);
			if (rowCache && rowCache.has(colField)) {
				const val = rowCache.get(colField);
				return val == null ? '' : String(val);
			}
			if (this.engine.hasFormula(rowId, colField)) {
				const res = this.engine.getCachedFormulaValue(rowId, colField);
				if (res.hasCached) {
					return res.value == null ? '' : String(res.value);
				}
			}
			return '';
		}

		const rowModel = this.engine.getRowModel();
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
		if (this.engine.isScrolling || this.engine.isScrollFrameActive) {
			this.engine.getCellValueCallsDuringScroll++;
		}
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
			if (this.engine.isScrolling || this.engine.isScrollFrameActive) {
				this.engine.formulaCallsDuringScroll++;
			}
			return this.engine.evaluateFormulaCell(rowId, colField, (rId, cField) => this.getRawCellValue(rId, cField));
		}

		return rawVal;
	};

	public setCellValue = (rowId: string, colField: string, value: unknown, knownOldStoredValue?: unknown): boolean => {
		const shouldEmitValueChanged = this.engine.eventBus.hasListeners(GridEventName.cellValueChanged);
		const oldValue = shouldEmitValueChanged ? this.getCellValue(rowId, colField) : undefined;
		const oldStoredValue = knownOldStoredValue !== undefined ? knownOldStoredValue : this.getStoredCellValue(rowId, colField);
		if (oldStoredValue === value) return false;

		const rowModel = this.engine.getRowModel();
		if (!rowModel?.setCellValue) {
			return false;
		}

		const applied = rowModel.setCellValue(rowId, colField, value);
		if (!applied) return false;

		this.engine.syncFormulaForCell(rowId, colField, value);

		// Invalidate this cell and any formula dependents.
		const invalidatedFormulaCells = this.engine.invalidateFormulaCell(rowId, colField);
		const dependentFields = this.engine.columns.getValueGetterDependents(colField).filter((dependentField) => dependentField !== colField);

		if (invalidatedFormulaCells.length <= 1 && dependentFields.length === 0) {
			this.clearValueGetterCache(rowId, colField);

			if (this.engine.batchedUpdates) {
				this.engine.enqueueCellUpdate(rowId, colField);
				this.scheduleBatchFlush();
			} else {
				this.engine.notifyCellChange(rowId, colField);
			}
			if (shouldEmitValueChanged) {
				this.engine.eventBus.dispatchEvent(GridEventName.cellValueChanged, {
					rowId,
					colField,
					oldValue,
					newValue: value,
				});
			}
			return true;
		}

		const invalidatedCells: GridCellPointer[] = [{ rowId, colField }];
		const seenInvalidatedCells = new Set<string>([`${rowId}\u0000${colField}`]);
		const addInvalidatedCell = (rId: string, cField: string) => {
			const key = `${rId}\u0000${cField}`;
			if (seenInvalidatedCells.has(key)) return;
			seenInvalidatedCells.add(key);
			invalidatedCells.push({ rowId: rId, colField: cField });
		};

		// Also invalidate explicitly declared dynamic valueGetter dependents on this same row.
		// Uses the column reverse index so wide grids pay O(actual dependents), not O(total columns).
		for (const dependentField of dependentFields) {
			addInvalidatedCell(rowId, dependentField);
		}

		for (const cell of invalidatedFormulaCells) {
			addInvalidatedCell(cell.rowId, cell.colField);
		}

		for (const cell of invalidatedCells) {
			this.clearValueGetterCache(cell.rowId, cell.colField);
		}

		if (this.engine.batchedUpdates) {
			// Batch cell notifications for better performance
			for (const cell of invalidatedCells) {
				this.engine.enqueueCellUpdate(cell.rowId, cell.colField);
			}

			// Schedule batched flush if not already scheduled
			this.scheduleBatchFlush();
		} else {
			// Immediate mode: notify synchronously
			for (const cell of invalidatedCells) {
				this.engine.notifyCellChange(cell.rowId, cell.colField);
			}
		}

		if (shouldEmitValueChanged) {
			this.engine.eventBus.dispatchEvent(GridEventName.cellValueChanged, {
				rowId,
				colField,
				oldValue,
				newValue: value,
			});
		}
		return true;
	};

	private scheduleBatchFlush(): void {
		this.engine.scheduleBatchFlush();
	}
}
