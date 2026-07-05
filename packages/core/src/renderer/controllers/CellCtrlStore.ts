import type { ColumnInstanceId } from '../../columnDef.js';
import { createCellControllerKey, createCellCtrl, type CellControllerKey, type CellCtrl, type CreateCellCtrlInput } from './CellCtrl.js';

export class CellCtrlStore<TRowData = unknown> {
	private readonly byKey = new Map<CellControllerKey, CellCtrl>();
	private readonly keysByRowId = new Map<string, Set<CellControllerKey>>();
	private readonly keysByColumnInstanceId = new Map<ColumnInstanceId, Set<CellControllerKey>>();

	public get(key: CellControllerKey): CellCtrl | undefined {
		return this.byKey.get(key);
	}

	public getByRowAndColumn(rowId: string, columnInstanceId: ColumnInstanceId): CellCtrl | undefined {
		return this.byKey.get(createCellControllerKey(rowId, columnInstanceId));
	}

	public getOrCreate(input: CreateCellCtrlInput): { cellCtrl: CellCtrl; created: boolean };
	public getOrCreate(rowId: string, columnInstanceId: ColumnInstanceId, field: string): { cellCtrl: CellCtrl; created: boolean };
	public getOrCreate(
		inputOrRowId: CreateCellCtrlInput | string,
		columnInstanceIdArg?: ColumnInstanceId,
		fieldArg?: string
	): { cellCtrl: CellCtrl; created: boolean } {
		const input =
			typeof inputOrRowId === 'string'
				? {
						rowId: inputOrRowId,
						columnInstanceId: columnInstanceIdArg!,
						colField: fieldArg!,
					}
				: inputOrRowId;
		const { rowId, columnInstanceId } = input;
		const key = createCellControllerKey(rowId, columnInstanceId);
		const existing = this.byKey.get(key);
		if (existing) {
			existing.rowIndex = input.rowIndex ?? existing.rowIndex;
			existing.rowCtrlKey = input.rowCtrlKey ?? existing.rowCtrlKey;
			existing.colIndex = input.colIndex ?? existing.colIndex;
			existing.scrollPresentation = input.scrollPresentation ?? existing.scrollPresentation;
			existing.freshness = input.freshness ?? existing.freshness;
			return { cellCtrl: existing, created: false };
		}
		const cellCtrl = createCellCtrl(input);
		this.byKey.set(key, cellCtrl);
		let rowKeys = this.keysByRowId.get(rowId);
		if (!rowKeys) {
			rowKeys = new Set();
			this.keysByRowId.set(rowId, rowKeys);
		}
		rowKeys.add(key);
		let columnKeys = this.keysByColumnInstanceId.get(columnInstanceId);
		if (!columnKeys) {
			columnKeys = new Set();
			this.keysByColumnInstanceId.set(columnInstanceId, columnKeys);
		}
		columnKeys.add(key);
		return { cellCtrl, created: true };
	}

	public destroyRow(rowId: string): void {
		const keys = this.keysByRowId.get(rowId);
		if (!keys) return;
		for (const key of keys) {
			const cellCtrl = this.byKey.get(key);
			if (!cellCtrl) continue;
			this.byKey.delete(key);
			const columnKeys = this.keysByColumnInstanceId.get(cellCtrl.columnInstanceId);
			columnKeys?.delete(key);
			if (columnKeys?.size === 0) this.keysByColumnInstanceId.delete(cellCtrl.columnInstanceId);
		}
		this.keysByRowId.delete(rowId);
	}

	public clear(): void {
		this.byKey.clear();
		this.keysByRowId.clear();
		this.keysByColumnInstanceId.clear();
	}
}
