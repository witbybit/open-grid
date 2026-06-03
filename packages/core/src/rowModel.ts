import {
	GridStore,
	ColumnDef,
	RowModel,
	RowNode,
	setValueByPath,
	compilePathGetter,
	type VisualRow,
	type RowRefreshReason,
	type RowModelRefreshResult,
} from './store.js';
import { createCellKey, getFieldRoot } from './ids.js';
import { RowPipeline, type RowModelConfig } from './rows/RowPipeline.js';
import { RowDataStore } from './rows/RowDataStore.js';

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
}

export type { GroupDef, RowModelConfig } from './rows/RowPipeline.js';

function getFilterItemValue(item: FilterModelItem | unknown): { operator: FilterOperator; filter: unknown } {
	if (item && typeof item === 'object' && 'filter' in item) {
		const typedItem = item as FilterModelItem;
		return { operator: typedItem.type ?? 'contains', filter: typedItem.filter };
	}
	return { operator: 'contains', filter: item };
}

function compareValues(a: unknown, b: unknown): number {
	if (a === b) return 0;
	if (a == null) return -1;
	if (b == null) return 1;

	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}

	const aNumber = Number(a);
	const bNumber = Number(b);
	if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
		return aNumber - bNumber;
	}

	const aStr = String(a);
	const bStr = String(b);
	if (aStr < bStr) return -1;
	if (aStr > bStr) return 1;
	return 0;
}

export function getColumnValue<TData>(node: RowNode<TData>, column: ColumnDef<TData> | undefined): unknown {
	if (!column) return undefined;
	if (column.valueGetter) return column.valueGetter({ node, row: node.data, colField: column.field });
	const getter = compilePathGetter(column.field);
	return node.getCellValue(column.field, getter);
}

interface PreparedFilter<TData> {
	column: ColumnDef<TData>;
	getter: (node: RowNode<TData>) => unknown;
	operator: FilterOperator;
	textFilter: string;
	numericFilter: number;
}

function matchesPreparedFilter<TData>(value: unknown, pf: PreparedFilter<TData>): boolean {
	const textValue = String(value ?? '').toLowerCase();
	const numericValue = Number(value);

	switch (pf.operator) {
		case 'equals':
			return textValue === pf.textFilter;
		case 'startsWith':
			return textValue.startsWith(pf.textFilter);
		case 'endsWith':
			return textValue.endsWith(pf.textFilter);
		case 'gt':
			return numericValue > pf.numericFilter;
		case 'gte':
			return numericValue >= pf.numericFilter;
		case 'lt':
			return numericValue < pf.numericFilter;
		case 'lte':
			return numericValue <= pf.numericFilter;
		case 'contains':
		default:
			return textValue.includes(pf.textFilter);
	}
}

function fieldsAffectColumn(fields: Set<string>, columnField: string): boolean {
	return fields.has(columnField) || fields.has(getFieldRoot(columnField));
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

	// 1. Pre-compile and pre-resolve active filters to avoid O(N) entries allocations, string manipulation, and Map lookups
	const preparedFilters: PreparedFilter<TData>[] = [];
	if (filterModel) {
		for (const [colId, item] of Object.entries(filterModel)) {
			const { operator, filter } = getFilterItemValue(item);
			if (filter == null || filter === '') continue;

			const column = columnById.get(colId);
			if (!column) continue;

			const textFilter = String(filter).toLowerCase();
			const numericFilter = Number(filter);

			let getter: (node: RowNode<TData>) => unknown;
			if (column.valueGetter) {
				const colValGetter = column.valueGetter;
				getter = (node: RowNode<TData>) => colValGetter({ node, row: node.data, colField: column.field });
			} else {
				const pathGetter = compilePathGetter(column.field);
				getter = (node: RowNode<TData>) => node.getCellValue(column.field, pathGetter);
			}

			preparedFilters.push({
				column,
				getter,
				operator,
				textFilter,
				numericFilter,
			});
		}
	}

	if (preparedFilters.length > 0) {
		result = result.filter(({ node }) => {
			for (let i = 0; i < preparedFilters.length; i++) {
				const pf = preparedFilters[i];
				const val = pf.getter(node);
				if (!matchesPreparedFilter(val, pf)) {
					return false;
				}
			}
			return true;
		});
	}

	// 2. Pre-compile sort getters to avoid O(N log N) getter compilations and map lookups
	if (sortModel?.length) {
		const precompiledSortGetters = sortModel.map((sortItem) => {
			const column = columnById.get(sortItem.colId);
			let getter: (node: RowNode<TData>) => unknown;
			if (column) {
				if (column.valueGetter) {
					const colValGetter = column.valueGetter;
					getter = (node: RowNode<TData>) => colValGetter({ node, row: node.data, colField: column.field });
				} else {
					const pathGetter = compilePathGetter(column.field);
					getter = (node: RowNode<TData>) => node.getCellValue(column.field, pathGetter);
				}
			} else {
				getter = () => undefined;
			}
			return getter;
		});

		// Schwartzian transform: extract sort keys in O(N) using pre-allocated arrays to minimize allocation overhead
		const sortData = result.map((item) => {
			const keys = new Array(sortModel.length);
			for (let i = 0; i < sortModel.length; i++) {
				keys[i] = precompiledSortGetters[i](item.node);
			}
			return { item, keys };
		});

		sortData.sort((left, right) => {
			for (let i = 0; i < sortModel.length; i++) {
				const sortItem = sortModel[i];
				const comparison = compareValues(left.keys[i], right.keys[i]);
				if (comparison !== 0) {
					return sortItem.sort === 'desc' ? -comparison : comparison;
				}
			}
			return left.item.sourceIndex - right.item.sourceIndex;
		});

		result = sortData.map((d) => d.item);
	}

	return result;
}

export class ClientRowModelController<TData = unknown> implements RowModel<TData> {
	private store: GridStore<TData>;
	private dataStore: RowDataStore<TData>;
	private visualRows: Array<VisualRow<TData>> = [];
	private visualRowIdToIndex = new Map<string, number>();
	private rowIdToVisualIndex = new Map<string, number>();
	private rowIdToVisualRowId = new Map<string, string>();
	private rowIdToVisualRowIds: Map<string, string[]> | undefined;
	private unsubscribers: Array<() => void> = [];

	private pipeline = new RowPipeline<TData>();

	public toggleGroupExpanded = (groupId: string): void => {
		const expansion = this.store.getState().expansion;
		if (groupId.startsWith('group:')) {
			const groups = { ...expansion.groups };
			if (groups[groupId]) {
				delete groups[groupId];
			} else {
				groups[groupId] = true;
			}
			this.store.setState({ expansion: { ...expansion, groups } });
		} else {
			const treeRows = { ...expansion.treeRows };
			if (treeRows[groupId]) {
				delete treeRows[groupId];
			} else {
				treeRows[groupId] = true;
			}
			this.store.setState({ expansion: { ...expansion, treeRows } });
		}
		this.refresh();
	};

	public toggleDetailExpanded = (rowId: string): void => {
		const expansion = this.store.getState().expansion;
		const details = { ...expansion.details };
		if (details[rowId]) {
			delete details[rowId];
		} else {
			details[rowId] = true;
		}
		this.store.setState({ expansion: { ...expansion, details } });
		this.refresh();
	};

	public isGroupExpanded = (groupId: string): boolean => {
		const expansion = this.store.getState().expansion;
		return groupId.startsWith('group:') ? !!expansion.groups[groupId] : !!expansion.treeRows[groupId];
	};

	public isDetailExpanded = (rowId: string): boolean => {
		return !!this.store.getState().expansion.details[rowId];
	};

	constructor(store: GridStore<TData>, options: ClientRowModelOptions<TData>) {
		this.store = store;
		this.dataStore = new RowDataStore<TData>((row) => this.store.getRowId(row));

		// Set base columns and config in store
		this.store.setState({
			columns: options.columns,
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
		this.dataStore.setRows(rows);
		this.store.engine.clearFormulas();
		this.refresh();
	}

	public updateRows(updater: (rows: TData[]) => TData[]): void {
		const result = this.dataStore.updateRows(updater);

		if (result.mismatch) {
			const currentRows = this.dataStore.getAllNodes().map((n) => n.data);
			this.setRows(updater(currentRows));
			return;
		}

		if (result.changedNodes.length === 0) return;

		// Invalidate changed cells and gather affected formula dependents.
		const allInvalidatedKeys = new Set<string>();
		for (const [rowId, fields] of result.changedFieldsByRow) {
			for (const field of fields) {
				const cellKey = createCellKey(rowId, field);
				allInvalidatedKeys.add(cellKey);

				const node = this.dataStore.getNode(rowId);
				if (node) {
					const nextVal = (node.data as Record<string, unknown>)[field];
					this.store.engine.syncFormulaForCell(rowId, field, nextVal);
				}

				const invalidated = this.store.engine.invalidateFormulaCell(rowId, field);
				for (const k of invalidated) {
					allInvalidatedKeys.add(k);
				}
			}
		}

		// Check if any of the changed fields are part of the active sort or filter models
		const state = this.store.getState();
		let needsFullRefresh = false;

		if (state.sortModel && state.sortModel.length > 0) {
			for (const sortItem of state.sortModel) {
				for (const [_, fields] of result.changedFieldsByRow) {
					if (fieldsAffectColumn(fields, sortItem.colId)) {
						needsFullRefresh = true;
						break;
					}
				}
				if (needsFullRefresh) break;
			}
		}

		if (!needsFullRefresh && state.filterModel && Object.keys(state.filterModel).length > 0) {
			for (const filterColId of Object.keys(state.filterModel)) {
				for (const [_, fields] of result.changedFieldsByRow) {
					if (fieldsAffectColumn(fields, filterColId)) {
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
			// No sorting or filtering is affected. Notify only changed cells, formula dependents,
			// and explicitly declared valueGetter dependents.
			const notifyKeys = new Set<string>(allInvalidatedKeys);
			for (const node of result.changedNodes) {
				const changedFields = result.changedFieldsByRow.get(node.id);
				if (changedFields) {
					for (const field of changedFields) {
						notifyKeys.add(createCellKey(node.id, field));
						for (const dependentField of this.store.engine.columns.getValueGetterDependents(field)) {
							if (dependentField !== field) {
								notifyKeys.add(createCellKey(node.id, dependentField));
							}
						}
					}
				}
			}

			for (const key of notifyKeys) {
				const colonIdx = key.indexOf(':');
				const rId = colonIdx === -1 ? key : key.substring(0, colonIdx);
				const cField = colonIdx === -1 ? '' : key.substring(colonIdx + 1);
				this.store.engine.notifyCellChange(rId, cField);
			}

			for (const [rowId, values] of result.changedValuesByRow) {
				for (const [colField, change] of values) {
					this.store.dispatchEvent('cellValueChanged', {
						rowId,
						colField,
						oldValue: change.oldValue,
						newValue: change.newValue,
					});
				}
			}
		}
	}

	public getVisualRow = (index: number): VisualRow<TData> | null => {
		return this.visualRows[index] ?? null;
	};

	public getVisualRowCount = (): number => {
		return this.visualRows.length;
	};

	public getVisualRowIndexById = (id: string): number => {
		const idx = this.visualRowIdToIndex.get(id) ?? this.rowIdToVisualIndex.get(id);
		return idx !== undefined ? idx : -1;
	};

	public getVisualIndexById = (visualRowId: string): number => {
		const idx = this.visualRowIdToIndex.get(visualRowId);
		return idx !== undefined ? idx : -1;
	};

	public getVisualIndexByRowId = (rowId: string): number => {
		const idx = this.rowIdToVisualIndex.get(rowId);
		return idx !== undefined ? idx : -1;
	};

	public getRow = (index: number): TData | null => {
		const row = this.getVisualRow(index);
		return row?.kind === 'data' ? row.node.data : null;
	};

	public getRowNode = (index: number): RowNode<TData> | null => {
		const row = this.getVisualRow(index);
		return row?.kind === 'data' ? row.node : null;
	};

	public getRowIndexById = (rowId: string): number => {
		return this.getVisualIndexByRowId(rowId);
	};

	public getDataRowById = (rowId: string): TData | null => {
		return this.getRawRowById(rowId);
	};

	public getRowNodeById = (rowId: string): RowNode<TData> | null => {
		return this.dataStore.getNode(rowId);
	};

	public getRawRowById = (rowId: string): TData | null => {
		return this.dataStore.getNode(rowId)?.data ?? null;
	};

	public setCellValue = (rowId: string, colField: string, value: unknown): boolean => {
		const node = this.getRowNodeById(rowId);
		if (!node) return false;

		const col = this.store.getColumnDef(colField);
		const updatedRow = { ...node.data };
		if (col?.valueSetter) {
			if (!col.valueSetter(updatedRow, value)) return false;
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.setData(updatedRow);

		// If the edited cell field affects active sorting, filtering, grouping, or aggregates,
		// we must re-run the pipeline to update the row positions, visibility, or computed aggregates.
		const state = this.store.getState();
		let needsRefresh = false;

		if (state.sortModel && state.sortModel.some((s) => s.colId === colField)) {
			needsRefresh = true;
		} else if (state.filterModel && state.filterModel[colField] !== undefined) {
			needsRefresh = true;
		} else if (state.groupBy && state.groupBy.includes(colField)) {
			needsRefresh = true;
		} else if (this.store.engine.columns.hasValueGetter(colField)) {
			needsRefresh = true;
		} else {
			// If grouping or custom row models (e.g. parentId tree) are active, any cell edit
			// might affect group calculations, so we refresh to keep aggregations/hierarchies correct.
			const hasGrouping = state.groupBy && state.groupBy.length > 0;
			const hasTree = !!state.getParentId;
			if (hasGrouping || hasTree) {
				needsRefresh = true;
			}
		}

		if (needsRefresh) {
			this.refresh();
		}

		return true;
	};

	public refresh(reason?: RowRefreshReason): RowModelRefreshResult {
		const state = this.store.getState();

		const expansion = state.expansion;
		const rowModelConfig: RowModelConfig<TData> | undefined =
			state.rowModelConfig ??
			(state.groupBy?.length || state.getParentId || state.masterDetailEnabled
				? {
						type: 'client',
						grouping: state.groupBy?.length ? { model: state.groupBy.map((colId) => ({ colId })) } : undefined,
						treeData: state.getParentId ? { enabled: true, getParentId: state.getParentId } : undefined,
						masterDetail: state.masterDetailEnabled
							? {
									enabled: true,
									expandedRowIds: expansion.details,
									defaultDetailHeight: state.detailRowHeight,
								}
							: undefined,
					}
				: undefined);

		const result = this.pipeline.run({
			nodes: this.dataStore.getAllNodes(),
			columns: state.columns,
			sortModel: state.sortModel,
			filterModel: state.filterModel,
			groupBy: state.groupBy,
			rowModelConfig,
			getParentId: state.getParentId,
			expandedGroupIds: new Set(Object.keys(expansion.groups)),
			expandedTreeRowIds: new Set(Object.keys(expansion.treeRows)),
			expandedDetailRowIds: new Set(Object.keys(expansion.details)),
			defaultRowHeight: state.defaultRowHeight,
			rowHeightsRecord: state.rowHeights,
			groupRowHeight: state.groupRowHeight,
			detailRowHeight: state.detailRowHeight,
			masterDetailEnabled: state.masterDetailEnabled,
			detailRenderer: state.detailRenderer,
		});
		const { visualRows } = result;

		const changed = visualRows.length !== this.visualRows.length || visualRows.some((row, idx) => row !== this.visualRows[idx]);

		this.visualRows = visualRows;
		this.visualRowIdToIndex = result.visualRowIdToIndex;
		this.rowIdToVisualIndex = result.rowIdToVisualIndex;
		this.rowIdToVisualRowId = result.rowIdToVisualRowId;
		this.rowIdToVisualRowIds = result.rowIdToVisualRowIds;

		this.store.setState({
			dataVersion: state.dataVersion + 1,
		});

		return { changed };
	}
}
