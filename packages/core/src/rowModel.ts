import { type ColumnDef, setValueByPath, compilePathGetter } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { RowDataTransaction, RowNodeTransaction } from './api/GridApi.js';
import type { ClientRowModelRuntime } from './engine/runtimePorts.js';
import { getFieldRoot } from './ids.js';
import { RowNode } from './rowNode.js';
import { RowPipeline, type RowModelConfig, type RowPipelineOutput } from './rows/RowPipeline.js';
import type { PageWindow } from './rows/pageModel.js';
import { RowDataStore } from './rows/RowDataStore.js';
import type { VisualRow } from './visualRow.js';

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

// ── Row model contract types ──────────────────────────────────────────────────
// Defined here to avoid a circular import with store.ts. store.ts re-exports these.

export type RowRefreshReason = 'sort' | 'filter' | 'group' | 'tree' | 'expansion' | 'detail' | 'flatten' | 'bulk' | 'edit';

export interface RowModelRefreshResult {
	changed: boolean;
	reason?: RowRefreshReason;
	previousRowCount?: number;
	nextRowCount?: number;
	changedStartIndex?: number;
	changedEndIndex?: number;
	groupId?: string;
}

export interface RowModel<TRowData = unknown> {
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getDataRowCount?(): number;
	getVisualRowIndexById(id: string): number;
	getVisualIndexById(visualRowId: string): number;
	getVisualIndexByRowId(rowId: string): number;
	getRowNodeById(rowId: string): RowNode<TRowData> | null;
	getRawRowById(rowId: string): TRowData | null;
	toggleGroupExpanded?(groupId: string): RowModelRefreshResult | void;
	toggleDetailExpanded?(rowId: string): RowModelRefreshResult | void;
	isGroupExpanded?(groupId: string): boolean;
	isDetailExpanded?(rowId: string): boolean;
	expandAllGroups?(): RowModelRefreshResult | void;
	collapseAllGroups?(): RowModelRefreshResult | void;
	getStickyGroupMeta?(): Map<number, number>;
	/** The active client page-window (Plan 041), or null when pagination is off. */
	getPageWindow?(): PageWindow | null;
	getGroupMeta?(groupId: string): GroupRowMeta | null;
	getGroupMetaByVisualIndex?(visualIndex: number): GroupRowMeta | null;
	setRows?(rows: TRowData[]): void;
	updateRows?(updater: (rows: TRowData[]) => TRowData[]): void;
	applyTransaction?(transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData>;
	refresh(reason?: RowRefreshReason): RowModelRefreshResult;
	purgeCache?(): void;
	setDatasource?(datasource: import('./serverRowModel.js').IGridDatasource<TRowData>, blockSize?: number): void;
	goToPage?(page: number): void;
	setCellValue?(rowId: string, colField: string, value: unknown): boolean;
	loadVisibleBlocks?(startRow: number, endRow: number): void;
}

export interface GroupRowMeta {
	groupId: string;
	visualIndex: number;
	depth: number;
	parentGroupId: string | null;
	/** Index of the first child visual row (group or data), or -1 if collapsed. */
	firstChildIndex: number;
	/** Index of the last child visual row (group or data), or -1 if collapsed. */
	lastChildIndex: number;
	firstLeafIndex: number;
	lastLeafIndex: number;
	/** rowIds of all visible (non-collapsed) data rows beneath this group. */
	visibleDescendantRowIds: string[];
	/** groupIds of immediate child group rows that are visible. */
	childGroupIds: string[];
	leafCount: number;
	childCount: number;
	expanded: boolean;
	aggregateValues?: Record<string, unknown>;
}

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

function createColumnLookup<TData>(columns: Array<ColumnDef<TData>>): Map<string, ColumnDef<TData>> {
	const columnById = new Map<string, ColumnDef<TData>>();
	columns.forEach((column) => {
		columnById.set(column.field, column);
	});
	return columnById;
}

function sameVisualRowIdentity<TData>(left: VisualRow<TData>, right: VisualRow<TData>): boolean {
	return left.kind === right.kind && left.id === right.id;
}

function describeVisualRowDiff<TData>(
	previousRows: Array<VisualRow<TData>>,
	nextRows: Array<VisualRow<TData>>,
	reason?: RowRefreshReason,
	groupId?: string
): RowModelRefreshResult {
	let prefix = 0;
	const minLength = Math.min(previousRows.length, nextRows.length);
	while (prefix < minLength && sameVisualRowIdentity(previousRows[prefix], nextRows[prefix])) {
		prefix++;
	}

	let suffix = 0;
	while (
		suffix < minLength - prefix &&
		sameVisualRowIdentity(previousRows[previousRows.length - 1 - suffix], nextRows[nextRows.length - 1 - suffix])
	) {
		suffix++;
	}

	const changed = previousRows.length !== nextRows.length || prefix < previousRows.length || prefix < nextRows.length;
	const changedEndIndex = changed ? Math.max(previousRows.length, nextRows.length) - suffix - 1 : undefined;

	return {
		changed,
		reason,
		previousRowCount: previousRows.length,
		nextRowCount: nextRows.length,
		changedStartIndex: changed ? prefix : undefined,
		changedEndIndex,
		groupId,
	};
}

function prepareFilters<TData>(columns: Array<ColumnDef<TData>>, filterModel: FilterModel | null | undefined): PreparedFilter<TData>[] {
	const preparedFilters: PreparedFilter<TData>[] = [];
	if (!filterModel) return preparedFilters;

	const columnById = createColumnLookup(columns);
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

	return preparedFilters;
}

function nodeMatchesPreparedFilters<TData>(node: RowNode<TData>, preparedFilters: PreparedFilter<TData>[]): boolean {
	for (let i = 0; i < preparedFilters.length; i++) {
		const pf = preparedFilters[i];
		const val = pf.getter(node);
		if (!matchesPreparedFilter(val, pf)) {
			return false;
		}
	}
	return true;
}

export function applyClientFilterOnly<TData>(
	nodes: RowNode<TData>[],
	columns: Array<ColumnDef<TData>>,
	filterModel: FilterModel | null | undefined
): RowNode<TData>[] {
	const preparedFilters = prepareFilters(columns, filterModel);
	if (preparedFilters.length === 0) return nodes;
	return nodes.filter((node) => nodeMatchesPreparedFilters(node, preparedFilters));
}

export function applyClientSortAndFilter<TData>(
	nodes: RowNode<TData>[],
	columns: Array<ColumnDef<TData>>,
	sortModel: SortModel | null | undefined,
	filterModel: FilterModel | null | undefined
): Array<{ node: RowNode<TData>; sourceIndex: number }> {
	const columnById = createColumnLookup(columns);
	let result = nodes.map((node, sourceIndex) => ({ node, sourceIndex }));

	// 1. Pre-compile and pre-resolve active filters to avoid O(N) entries allocations, string manipulation, and Map lookups
	const preparedFilters = prepareFilters(columns, filterModel);
	if (preparedFilters.length > 0) {
		result = result.filter(({ node }) => nodeMatchesPreparedFilters(node, preparedFilters));
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
	private readonly runtime: ClientRowModelRuntime<TData>;
	private dataStore: RowDataStore<TData>;
	private visualRows: Array<VisualRow<TData>> = [];
	private visualRowIdToIndex = new Map<string, number>();
	private rowIdToVisualIndex = new Map<string, number>();
	private rowIdToVisualRowId = new Map<string, string>();
	private rowIdToVisualRowIds: Map<string, string[]> | undefined;
	private dataRowCount = 0;
	private unsubscribers: Array<() => void> = [];

	private pipeline = new RowPipeline<TData>();
	private _stickyGroupMeta = new Map<number, number>();
	private _groupMeta = new Map<string, GroupRowMeta>();
	private _groupMetaByVisualIndex = new Map<number, GroupRowMeta>();
	private _pageWindow: PageWindow | null = null;

	public getStickyGroupMeta = (): Map<number, number> => this._stickyGroupMeta;
	public getPageWindow = (): PageWindow | null => this._pageWindow;
	public getGroupMeta = (groupId: string): GroupRowMeta | null => this._groupMeta.get(groupId) ?? null;
	public getGroupMetaByVisualIndex = (visualIndex: number): GroupRowMeta | null => this._groupMetaByVisualIndex.get(visualIndex) ?? null;

	public getDataRowCount = (): number => this.dataRowCount;

	public toggleGroupExpanded = (groupId: string): RowModelRefreshResult => {
		const expansion = this.runtime.getState().expansion;
		if (groupId.startsWith('group:')) {
			const groups = { ...expansion.groups };
			if (groups[groupId]) {
				delete groups[groupId];
			} else {
				groups[groupId] = true;
			}
			this.runtime.updateExpansion(() => ({ ...expansion, groups }));
		} else {
			const treeRows = { ...expansion.treeRows };
			if (treeRows[groupId]) {
				delete treeRows[groupId];
			} else {
				treeRows[groupId] = true;
			}
			this.runtime.updateExpansion(() => ({ ...expansion, treeRows }));
		}
		return this.refresh('expansion', groupId);
	};

	public toggleDetailExpanded = (rowId: string): RowModelRefreshResult => {
		const expansion = this.runtime.getState().expansion;
		const details = { ...expansion.details };
		if (details[rowId]) {
			delete details[rowId];
		} else {
			details[rowId] = true;
		}
		this.runtime.updateExpansion(() => ({ ...expansion, details }));
		return this.refresh('detail');
	};

	public isGroupExpanded = (groupId: string): boolean => {
		const expansion = this.runtime.getState().expansion;
		return groupId.startsWith('group:') ? !!expansion.groups[groupId] : !!expansion.treeRows[groupId];
	};

	public isDetailExpanded = (rowId: string): boolean => {
		return !!this.runtime.getState().expansion.details[rowId];
	};

	public expandAllGroups = (): RowModelRefreshResult => {
		const state = this.runtime.getState();
		const allIds = this.pipeline.collectAllGroupIds({
			nodes: this.dataStore.getAllNodes(),
			columns: state.columns,
			groupBy: state.groupBy,
			rowModelConfig: state.rowModelConfig,
			filterModel: state.filterModel,
		});
		const groups: Record<string, true> = {};
		for (const id of allIds) groups[id] = true;
		this.runtime.updateExpansion((expansion) => ({ ...expansion, groups }));
		return this.refresh('expansion');
	};

	public collapseAllGroups = (): RowModelRefreshResult => {
		this.runtime.updateExpansion((expansion) => ({ ...expansion, groups: {} }));
		return this.refresh('expansion');
	};

	constructor(runtime: ClientRowModelRuntime<TData>, options: ClientRowModelOptions<TData>) {
		this.runtime = runtime;
		this.dataStore = new RowDataStore<TData>((row) => this.runtime.getRowId(row));

		this.runtime.initializeModel({
			columns: options.columns,
		});

		this.runtime.registerRowModel(this);

		this.unsubscribers.push(
			this.runtime.addEventListener(GridEventName.sortChanged, () => this.refresh()),
			this.runtime.addEventListener(GridEventName.filterChanged, () => this.refresh()),
			this.runtime.addEventListener(GridEventName.groupByChanged, () => this.refresh()),
			this.runtime.addEventListener(GridEventName.aggDefsChanged, () => this.refresh()),
			this.runtime.addEventListener(GridEventName.showGroupFooterChanged, () => this.refresh()),
			this.runtime.addEventListener(GridEventName.enableStickyGroupRowsChanged, () => this.refresh()),
			// Client pagination page change → re-run the pipeline with the new page window.
			this.runtime.addEventListener(GridEventName.paginationChanged, () => this.refresh('flatten'))
		);
		this.setRows(options.rows);
	}

	public dispose(): void {
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	public setRows(rows: TData[]): void {
		this.dataStore.setRows(rows);
		this.runtime.clearFormulas();
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
		const allInvalidatedCells = new Map<string, Set<string>>();
		const addInvalidatedCell = (rowId: string, field: string) => {
			let fields = allInvalidatedCells.get(rowId);
			if (!fields) {
				fields = new Set<string>();
				allInvalidatedCells.set(rowId, fields);
			}
			fields.add(field);
		};
		for (const [rowId, fields] of result.changedFieldsByRow) {
			for (const field of fields) {
				addInvalidatedCell(rowId, field);

				const node = this.dataStore.getNode(rowId);
				if (node) {
					const nextVal = (node.data as Record<string, unknown>)[field];
					this.runtime.syncFormulaForCell(rowId, field, nextVal);
				}

				const invalidated = this.runtime.invalidateFormulaCell(rowId, field);
				for (const cell of invalidated) {
					addInvalidatedCell(cell.rowId, cell.colField);
				}
			}
		}

		// Check if any of the changed fields are part of the active sort or filter models
		const state = this.runtime.getState();
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
			const notifyCells = new Map<string, Set<string>>();
			const addNotifyCell = (rowId: string, field: string) => {
				let fields = notifyCells.get(rowId);
				if (!fields) {
					fields = new Set<string>();
					notifyCells.set(rowId, fields);
				}
				fields.add(field);
			};
			for (const [rowId, fields] of allInvalidatedCells) {
				for (const field of fields) addNotifyCell(rowId, field);
			}
			for (const node of result.changedNodes) {
				const changedFields = result.changedFieldsByRow.get(node.id);
				if (changedFields) {
					for (const field of changedFields) {
						addNotifyCell(node.id, field);
						for (const dependentField of this.runtime.getValueGetterDependents(field)) {
							if (dependentField !== field) {
								addNotifyCell(node.id, dependentField);
							}
						}
					}
				}
			}

			this.runtime.notifyBulkCellChange(notifyCells);

			if (result.changedValuesByRow.size > 0) {
				this.runtime.dispatchRowsUpdated({
					changedValuesByRow: result.changedValuesByRow,
					changedNodes: result.changedNodes,
				});
			}
		}
	}

	public applyTransaction = (transaction: RowDataTransaction<TData>): RowNodeTransaction<TData> => {
		const result = this.dataStore.applyTransaction(transaction);

		if (result.updated.length > 0) {
			const notifyCells = new Map<string, Set<string>>();
			for (const [rowId, fields] of result.changedFieldsByRow) {
				const cellSet = new Set<string>();
				for (const field of fields) {
					cellSet.add(field);
					for (const dep of this.runtime.getValueGetterDependents(field)) {
						if (dep !== field) cellSet.add(dep);
					}
				}
				notifyCells.set(rowId, cellSet);
			}
			this.runtime.notifyBulkCellChange(notifyCells);
		}

		if (result.added.length > 0 || result.removed.length > 0) {
			this.refresh('bulk');
		}

		if (result.added.length > 0 || result.removed.length > 0 || result.updated.length > 0) {
			this.runtime.dispatchRowsUpdated({
				changedValuesByRow: result.changedValuesByRow,
				changedNodes: result.updated,
				addedNodes: result.added,
				removedNodes: result.removed,
			});
		}

		return {
			add: result.added,
			remove: result.removed,
			update: result.updated,
		};
	};

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

		const col = this.runtime.getColumnDef(colField);
		const oldValue = this.runtime.getCellValue(rowId, colField);
		const updatedRow = col?.valueSetter ? { ...node.data } : node.data;
		if (col?.valueSetter) {
			// Sync path: call valueSetter with params. Async setters are handled by commitEdit.
			const result = col.valueSetter({ value, oldValue, row: updatedRow, colField, abort: () => {} });
			if (result === false || (result instanceof Promise && false)) return false;
			// For sync-returning false, bail out. Async setters proceed optimistically here.
			if (!(result instanceof Promise) && !result) return false;
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		if (updatedRow !== node.data) {
			node.setData(updatedRow);
		} else {
			node.clearValueCache();
		}

		// If the edited cell field affects active sorting, filtering, grouping, or aggregates,
		// we must re-run the pipeline to update the row positions, visibility, or computed aggregates.
		const state = this.runtime.getState();
		let needsRefresh = false;

		if (state.sortModel && state.sortModel.some((s) => s.colId === colField)) {
			needsRefresh = true;
		} else if (state.filterModel && state.filterModel[colField] !== undefined) {
			needsRefresh = true;
		} else if (state.groupBy && state.groupBy.includes(colField)) {
			needsRefresh = true;
		} else if (this.runtime.hasValueGetter(colField)) {
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

	public refresh(reason?: RowRefreshReason, groupId?: string): RowModelRefreshResult {
		const state = this.runtime.getState();
		const previousRows = this.visualRows;

		const expansion = state.expansion;
		const rowModelConfig: RowModelConfig<TData> | undefined =
			state.rowModelConfig ??
			(state.groupBy?.length || state.getParentId || state.masterDetailEnabled
				? {
						type: 'client',
						grouping: state.groupBy?.length
							? { model: state.groupBy.map((colId) => ({ colId })), includeFooter: !!state.showGroupFooter }
							: undefined,
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
			aggDefs: state.aggDefs ?? [],
			expandedGroupIds: new Set(Object.keys(expansion.groups)),
			expandedTreeRowIds: new Set(Object.keys(expansion.treeRows)),
			expandedDetailRowIds: new Set(Object.keys(expansion.details)),
			defaultRowHeight: state.defaultRowHeight,
			rowHeightsRecord: state.rowHeights,
			groupRowHeight: state.groupRowHeight,
			detailRowHeight: state.detailRowHeight,
			masterDetailEnabled: state.masterDetailEnabled,
			detailRenderer: state.detailRenderer,
			reportFault: this.runtime.reportRowPipelineFault,
			// Client pagination (Plan 041): slice happens inside the pipeline so every
			// derived map/meta/geometry stays page-consistent. Undefined → full list.
			pagination: state.pagination ? { pageSize: state.pagination.pageSize, page: state.pagination.page ?? 0 } : undefined,
		});
		const { visualRows } = result;
		const refreshResult = describeVisualRowDiff(previousRows, visualRows, reason, groupId);

		this.visualRows = visualRows;
		this._pageWindow = result.pageWindow ?? null;
		this.visualRowIdToIndex = result.visualRowIdToIndex;
		this.rowIdToVisualIndex = result.rowIdToVisualIndex;
		this.rowIdToVisualRowId = result.rowIdToVisualRowId;
		this.rowIdToVisualRowIds = result.rowIdToVisualRowIds;
		this._stickyGroupMeta = result.stickyGroupMeta;
		this._groupMeta = result.groupMeta;
		this._groupMetaByVisualIndex = result.groupMetaByVisualIndex;
		this.dataRowCount = result.stats.totalDataRows;

		this.runtime.bumpGlobalVersion();

		return refreshResult;
	}
}
