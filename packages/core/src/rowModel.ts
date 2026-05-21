import { GridStore, ColumnDef, RowModel, RowNode, getValueByPath, setValueByPath, compilePathGetter } from './store.js';

export type SortDirection = 'asc' | 'desc';

export interface SortModelItem {
	colId: string;
	sort: SortDirection;
}

export type SortModel = SortModelItem[];

export type FilterOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte';

export interface FilterModelItem {
	type?: FilterOperator;
	filter: unknown;
}

export type FilterModel = Record<string, FilterModelItem | unknown>;

export interface ClientRowModelOptions<TData = unknown> {
	rows: TData[];
	columns: Array<ColumnDef<TData>>;
	rowIdField?: keyof TData & string;
}

function getFilterItemValue(item: FilterModelItem | unknown): { operator: FilterOperator; filter: unknown } {
	if (item && typeof item === 'object' && 'filter' in item) {
		const typedItem = item as FilterModelItem;
		return { operator: typedItem.type ?? 'contains', filter: typedItem.filter };
	}
	return { operator: 'contains', filter: item };
}

function compareValues(a: unknown, b: unknown): number {
	if (a == null && b == null) return 0;
	if (a == null) return -1;
	if (b == null) return 1;

	const aNumber = typeof a === 'number' ? a : Number(a);
	const bNumber = typeof b === 'number' ? b : Number(b);
	if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
		return aNumber - bNumber;
	}

	return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function matchesFilter(value: unknown, item: FilterModelItem | unknown): boolean {
	const { operator, filter } = getFilterItemValue(item);
	if (filter == null || filter === '') return true;

	const textValue = String(value ?? '').toLowerCase();
	const textFilter = String(filter).toLowerCase();
	const numericValue = Number(value);
	const numericFilter = Number(filter);

	switch (operator) {
		case 'equals':
			return textValue === textFilter;
		case 'startsWith':
			return textValue.startsWith(textFilter);
		case 'endsWith':
			return textValue.endsWith(textFilter);
		case 'gt':
			return numericValue > numericFilter;
		case 'gte':
			return numericValue >= numericFilter;
		case 'lt':
			return numericValue < numericFilter;
		case 'lte':
			return numericValue <= numericFilter;
		case 'contains':
		default:
			return textValue.includes(textFilter);
	}
}

export function getColumnValue<TData>(node: RowNode<TData>, column: ColumnDef<TData> | undefined): unknown {
	if (!column) return undefined;
	if (column.valueGetter) return column.valueGetter({ node, row: node.data, colField: column.field });
	const getter = compilePathGetter(column.field);
	return node.getCellValue(column.field, getter);
}

export function applyClientSortAndFilter<TData>(
	nodes: RowNode<TData>[],
	columns: Array<ColumnDef<TData>>,
	sortModel: SortModel | null | undefined,
	filterModel: FilterModel | null | undefined
): Array<{ node: RowNode<TData>; sourceIndex: number }> {
	const columnById = new Map<string, ColumnDef<TData>>();
	columns.forEach((column) => {
		columnById.set(column.field, column);
	});

	let result = nodes.map((node, sourceIndex) => ({ node, sourceIndex }));

	if (filterModel) {
		result = result.filter(({ node }) =>
			Object.entries(filterModel).every(([colId, item]) => matchesFilter(getColumnValue(node, columnById.get(colId)), item))
		);
	}

	if (sortModel?.length) {
		result = [...result].sort((left, right) => {
			for (const sortItem of sortModel) {
				const column = columnById.get(sortItem.colId);
				const comparison = compareValues(getColumnValue(left.node, column), getColumnValue(right.node, column));
				if (comparison !== 0) {
					return sortItem.sort === 'desc' ? -comparison : comparison;
				}
			}
			return left.sourceIndex - right.sourceIndex;
		});
	}

	return result;
}


export class ClientRowModelController<TData = unknown> implements RowModel<TData> {
	private store: GridStore<TData>;
	private allNodes: RowNode<TData>[] = [];
	private activeNodes: RowNode<TData>[] = [];
	private nodeMap = new Map<string, RowNode<TData>>();
	private rowIdMap = new Map<string, number>();
	private unsubscribers: Array<() => void> = [];

	constructor(store: GridStore<TData>, options: ClientRowModelOptions<TData>) {
		this.store = store;

		// Set base columns and config in store
		this.store.setState({
			columns: options.columns,
			rowIdField: options.rowIdField ?? ('id' as keyof TData & string),
		});

		this.store.registerRowModel(this);

		this.unsubscribers.push(
			this.store.addEventListener('sortChanged', () => this.refresh()),
			this.store.addEventListener('filterChanged', () => this.refresh())
		);
		this.setRows(options.rows);
	}

	public dispose(): void {
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	public setRows(rows: TData[]): void {
		const rowIdField = this.store.getState().rowIdField;
		const nextNodeMap = new Map<string, RowNode<TData>>();

		this.allNodes = rows.map((row) => {
			const id = String(row[rowIdField]);
			let node = this.nodeMap.get(id);
			if (node) {
				node.data = row;
				node.clearValueCache();
			} else {
				node = new RowNode<TData>(id, row);
			}
			nextNodeMap.set(id, node);
			return node;
		});

		this.nodeMap = nextNodeMap;
		this.refresh();
	}

	public updateRows(updater: (rows: TData[]) => TData[]): void {
		const currentRows = this.allNodes.map((n) => n.data);
		const nextRows = updater(currentRows);

		if (nextRows.length !== this.allNodes.length) {
			this.setRows(nextRows);
			return;
		}

		const rowIdField = this.store.getState().rowIdField;
		const changedNodes: RowNode<TData>[] = [];
		const changedFieldsByRow = new Map<string, Set<string>>();

		for (let i = 0; i < this.allNodes.length; i++) {
			const node = this.allNodes[i];
			const nextRow = nextRows[i];
			if (!nextRow) continue;

			// Verify that the row ID is the same
			const nextId = String(nextRow[rowIdField]);
			if (node.id !== nextId) {
				// Structural mismatch of row IDs, fallback to full setRows
				this.setRows(nextRows);
				return;
			}

			const prevRow = node.data;
			if (prevRow !== nextRow) {
				// Find which fields actually changed
				const changedFields = new Set<string>();
				const prevKeys = Object.keys(prevRow as object);
				const nextKeys = Object.keys(nextRow as object);
				const allKeys = new Set([...prevKeys, ...nextKeys]);
				
				for (const key of allKeys) {
					if ((prevRow as any)[key] !== (nextRow as any)[key]) {
						changedFields.add(key);
					}
				}

				if (changedFields.size > 0) {
					node.data = nextRow;
					node.clearValueCache();
					changedNodes.push(node);
					changedFieldsByRow.set(node.id, changedFields);
				}
			}
		}

		if (changedNodes.length === 0) return;

		// Check if any of the changed fields are part of the active sort or filter models
		const state = this.store.getState();
		let needsFullRefresh = false;

		if (state.sortModel && state.sortModel.length > 0) {
			for (const sortItem of state.sortModel) {
				for (const [_, fields] of changedFieldsByRow) {
					if (fields.has(sortItem.colId)) {
						needsFullRefresh = true;
						break;
					}
				}
				if (needsFullRefresh) break;
			}
		}

		if (!needsFullRefresh && state.filterModel && Object.keys(state.filterModel).length > 0) {
			for (const filterColId of Object.keys(state.filterModel)) {
				for (const [_, fields] of changedFieldsByRow) {
					if (fields.has(filterColId)) {
						needsFullRefresh = true;
						break;
					}
				}
				if (needsFullRefresh) break;
			}
		}

		if (needsFullRefresh) {
			this.refresh();
		} else {
			// No sorting or filtering is affected! We can just notify coordinate-targeted listeners for all columns on the changed rows
			this.store.startTransaction();
			for (const node of changedNodes) {
				this.store.triggerCellNotifications(node.id);
			}
			this.store.endTransaction();
		}
	}

	public getRow = (index: number): TData | null => {
		const node = this.activeNodes[index];
		return node ? node.data : null;
	};

	public getRowNode = (index: number): RowNode<TData> | null => {
		return this.activeNodes[index] ?? null;
	};

	public getRowCount = (): number => {
		return this.activeNodes.length;
	};

	public getRowIndexById = (rowId: string): number => {
		const idx = this.rowIdMap.get(rowId);
		return idx !== undefined ? idx : -1;
	};

	public getRowNodeById = (rowId: string): RowNode<TData> | null => {
		return this.nodeMap.get(rowId) ?? null;
	};

	public setCellValue = (rowId: string, colField: string, value: unknown): void => {
		const node = this.getRowNodeById(rowId);
		if (!node) return;

		const col = this.store.getColumnDef(colField);
		const updatedRow = { ...node.data };
		if (col?.valueSetter) {
			col.valueSetter(updatedRow, value);
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.data = updatedRow;
		node.clearValueCache();
	};

	public refresh(): void {
		const state = this.store.getState();
		const visible = applyClientSortAndFilter(this.allNodes, state.columns, state.sortModel, state.filterModel);

		this.activeNodes = visible.map((v) => v.node);

		const rowIdField = state.rowIdField;
		this.rowIdMap.clear();

		let currentTop = 0;
		this.activeNodes.forEach((node, index) => {
			if (node) {
				node.rowIndex = index;
				node.rowTop = currentTop;
				const explicitHeight = state.rowHeights[node.id];
				node.rowHeight = explicitHeight !== undefined ? explicitHeight : state.defaultRowHeight;

				currentTop += node.rowHeight;
				this.rowIdMap.set(node.id, index);
			}
		});

		this.store.setState({
			dataVersion: state.dataVersion + 1,
		});
	}
}

