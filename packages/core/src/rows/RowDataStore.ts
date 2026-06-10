import { RowNode, validateRowIds } from '../store.js';

export type RowUpdate<T> = (rows: T[]) => T[];

export interface RowTransactionResult<T> {
	changedNodes: RowNode<T>[];
	changedFieldsByRow: Map<string, Set<string>>;
	changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
	mismatch: boolean;
}

export interface StoreTransactionResult<T> {
	added: RowNode<T>[];
	removed: RowNode<T>[];
	updated: RowNode<T>[];
	changedFieldsByRow: Map<string, Set<string>>;
	changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
}

export class RowDataStore<T> {
	private rowsById = new Map<string, RowNode<T>>();
	private sourceOrder: string[] = [];
	private getRowId: (row: T) => string;

	constructor(getRowId: (row: T) => string) {
		this.getRowId = getRowId;
	}

	public setRows(rows: T[]): void {
		// Validate before mutating any state so a bad input is a no-op.
		const ids = rows.map((row, index) => {
			if (row == null) {
				throw new Error(`Open Grid: row at index ${index} is null or undefined.`);
			}
			const id = this.getRowId(row);
			if (typeof id !== 'string' || id.length === 0) {
				throw new Error(`Open Grid: getRowId() returned an invalid id for row at index ${index}.`);
			}
			return id;
		});
		validateRowIds(ids, 'setRows');

		const nextNodeMap = new Map<string, RowNode<T>>();
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			const id = ids[i];
			let node = this.rowsById.get(id);
			if (node) {
				node.setData(row);
			} else {
				node = new RowNode<T>(id, row);
			}
			nextNodeMap.set(id, node);
		}
		this.sourceOrder = ids;
		this.rowsById = nextNodeMap;
	}

	public updateRows(updater: RowUpdate<T>): RowTransactionResult<T> {
		const currentRows = this.sourceOrder.map((id) => this.rowsById.get(id)!.data);
		const nextRows = updater(currentRows);

		if (nextRows.length !== this.sourceOrder.length) {
			return {
				changedNodes: [],
				changedFieldsByRow: new Map(),
				changedValuesByRow: new Map(),
				mismatch: true,
			};
		}

		const changedNodes: RowNode<T>[] = [];
		const changedFieldsByRow = new Map<string, Set<string>>();
		const changedValuesByRow = new Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>();

		for (let i = 0; i < this.sourceOrder.length; i++) {
			const currentId = this.sourceOrder[i];
			const node = this.rowsById.get(currentId)!;
			const nextRow = nextRows[i];
			if (!nextRow) continue;

			const nextId = this.getRowId(nextRow);
			if (node.id !== nextId) {
				return {
					changedNodes: [],
					changedFieldsByRow: new Map(),
					changedValuesByRow: new Map(),
					mismatch: true,
				};
			}

			const prevRow = node.data;
			if (prevRow !== nextRow) {
				const changedFields = new Set<string>();
				const changedValues = new Map<string, { oldValue: unknown; newValue: unknown }>();
				const prevKeys = Object.keys(prevRow as object);
				const nextKeys = Object.keys(nextRow as object);
				const allKeys = new Set([...prevKeys, ...nextKeys]);

				for (const key of allKeys) {
					const oldValue = (prevRow as Record<string, unknown>)[key];
					const newValue = (nextRow as Record<string, unknown>)[key];
					if (oldValue !== newValue) {
						changedFields.add(key);
						changedValues.set(key, { oldValue, newValue });
					}
				}

				if (changedFields.size > 0) {
					node.setData(nextRow);
					changedNodes.push(node);
					changedFieldsByRow.set(node.id, changedFields);
					changedValuesByRow.set(node.id, changedValues);
				}
			}
		}

		return {
			changedNodes,
			changedFieldsByRow,
			changedValuesByRow,
			mismatch: false,
		};
	}

	public applyTransaction(transaction: { add?: T[]; addIndex?: number; remove?: T[]; update?: T[] }): StoreTransactionResult<T> {
		const added: RowNode<T>[] = [];
		const removed: RowNode<T>[] = [];
		const updated: RowNode<T>[] = [];
		const changedFieldsByRow = new Map<string, Set<string>>();
		const changedValuesByRow = new Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>();

		if (transaction.remove) {
			for (const row of transaction.remove) {
				const id = this.getRowId(row);
				const node = this.rowsById.get(id);
				if (node) {
					removed.push(node);
					this.rowsById.delete(id);
				}
			}
			if (removed.length > 0) {
				const removedIds = new Set(removed.map((n) => n.id));
				this.sourceOrder = this.sourceOrder.filter((id) => !removedIds.has(id));
			}
		}

		if (transaction.update) {
			for (const row of transaction.update) {
				const id = this.getRowId(row);
				const node = this.rowsById.get(id);
				if (!node) continue;

				const prevRow = node.data;
				if (prevRow === row) continue;

				const changedFields = new Set<string>();
				const changedValues = new Map<string, { oldValue: unknown; newValue: unknown }>();
				const allKeys = new Set([...Object.keys(prevRow as object), ...Object.keys(row as object)]);

				for (const key of allKeys) {
					const oldValue = (prevRow as Record<string, unknown>)[key];
					const newValue = (row as Record<string, unknown>)[key];
					if (oldValue !== newValue) {
						changedFields.add(key);
						changedValues.set(key, { oldValue, newValue });
					}
				}

				if (changedFields.size > 0) {
					node.setData(row);
					updated.push(node);
					changedFieldsByRow.set(id, changedFields);
					changedValuesByRow.set(id, changedValues);
				}
			}
		}

		if (transaction.add && transaction.add.length > 0) {
			const newNodes: RowNode<T>[] = [];
			for (const row of transaction.add) {
				const id = this.getRowId(row);
				if (this.rowsById.has(id)) continue;
				const node = new RowNode<T>(id, row);
				this.rowsById.set(id, node);
				newNodes.push(node);
				added.push(node);
			}

			if (newNodes.length > 0) {
				const addIndex = transaction.addIndex ?? this.sourceOrder.length;
				const newIds = newNodes.map((n) => n.id);
				this.sourceOrder.splice(addIndex, 0, ...newIds);
			}
		}

		return { added, removed, updated, changedFieldsByRow, changedValuesByRow };
	}

	public getNode(rowId: string): RowNode<T> | null {
		return this.rowsById.get(rowId) ?? null;
	}

	public getAllNodes(): RowNode<T>[] {
		return this.sourceOrder.map((id) => this.rowsById.get(id)!);
	}
}
