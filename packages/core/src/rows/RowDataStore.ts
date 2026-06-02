import { RowNode } from '../store.js';

export type RowUpdate<T> = (rows: T[]) => T[];

export interface RowTransactionResult<T> {
	changedNodes: RowNode<T>[];
	changedFieldsByRow: Map<string, Set<string>>;
	changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
	mismatch: boolean;
}

export class RowDataStore<T> {
	private rowsById = new Map<string, RowNode<T>>();
	private sourceOrder: string[] = [];
	private getRowId: (row: T) => string;

	constructor(getRowId: (row: T) => string) {
		this.getRowId = getRowId;
	}

	public setRows(rows: T[]): void {
		const nextNodeMap = new Map<string, RowNode<T>>();
		this.sourceOrder = rows.map((row) => {
			const id = this.getRowId(row);
			let node = this.rowsById.get(id);
			if (node) {
				node.setData(row);
			} else {
				node = new RowNode<T>(id, row);
			}
			nextNodeMap.set(id, node);
			return id;
		});
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

	public getNode(rowId: string): RowNode<T> | null {
		return this.rowsById.get(rowId) ?? null;
	}

	public getAllNodes(): RowNode<T>[] {
		return this.sourceOrder.map((id) => this.rowsById.get(id)!);
	}
}
