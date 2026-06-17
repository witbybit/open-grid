import { type ColumnDef, setValueByPath, compilePathGetter } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { RowDataTransaction, RowNodeTransaction, RowSelectionScope } from './api/GridApi.js';
import type { ClientRowModelRuntime } from './engine/runtimePorts.js';
import { getFieldRoot } from './ids.js';
import { RowNode } from './rowNode.js';
import { RowPipeline, type RowModelConfig, type RowPipelineOutput } from './rows/RowPipeline.js';
import { RowDependencyRegistry, classifyMutation } from './rows/rowMutationClassifier.js';
import type { PageWindow } from './rows/pageModel.js';
import { RowDataStore } from './rows/RowDataStore.js';
import { toDataVisualRowId } from './rows/visualRowIds.js';
import type { VisualRow } from './visualRow.js';
import {
	type FilterModel,
	type TextFilterCondition,
	type NumberFilterCondition,
	type DateFilterCondition,
	type SetFilterCondition,
	type FilterCondition,
	type CompoundFilterCondition,
	type ColumnFilter,
} from './filterModel.js';

export type {
	FilterModel,
	ColumnFilter,
	FilterCondition,
	CompoundFilterCondition,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
};
export type { TextFilterOperator, NumberFilterOperator, DateFilterOperator, SelectFilterCondition } from './filterModel.js';

export type SortDirection = 'asc' | 'desc';

export interface SortModelItem {
	colId: string;
	sort: SortDirection;
}

export type SortModel = SortModelItem[];

export interface ClientRowModelOptions<TData = unknown> {
	rows: TData[];
	columns: Array<ColumnDef<TData>>;
}

export type { GroupDef, RowModelConfig } from './rows/RowPipeline.js';

// ── Row model contract types ──────────────────────────────────────────────────
// Defined here to avoid a circular import with store.ts. store.ts re-exports these.

export type RowRefreshReason = 'sort' | 'filter' | 'group' | 'tree' | 'expansion' | 'detail' | 'flatten' | 'bulk' | 'edit' | 'row-order';

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
	getSelectableDataRowIds?(scope?: RowSelectionScope): string[];
	toggleGroupExpanded?(groupId: string): RowModelRefreshResult | void;
	toggleDetailExpanded?(rowId: string): RowModelRefreshResult | void;
	isGroupExpanded?(groupId: string): boolean;
	isDetailExpanded?(rowId: string): boolean;
	expandAllGroups?(): RowModelRefreshResult | void;
	collapseAllGroups?(): RowModelRefreshResult | void;
	getStickyGroupMeta?(): Map<number, number>;
	/** The active client page-window (Plan 041), or null when pagination is off. */
	getPageWindow?(): PageWindow | null;
	/** Returns all data nodes (unfiltered) for distinct-value computation. */
	getAllDataNodes?(): RowNode<TRowData>[];
	getGroupMeta?(groupId: string): GroupRowMeta | null;
	getGroupMetaByVisualIndex?(visualIndex: number): GroupRowMeta | null;
	setRows?(rows: TRowData[]): void;
	updateRows?(updater: (rows: TRowData[]) => TRowData[]): void;
	applyTransaction?(transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData>;
	getRowOrder?(): string[];
	setRowOrder?(rowIds: string[]): void;
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

// ── Filter preparation ────────────────────────────────────────────────────────

interface PreparedBase<TData> {
	getter: (node: RowNode<TData>) => unknown;
}

interface PreparedTextFilter<TData> extends PreparedBase<TData> {
	kind: 'text';
	operator: TextFilterCondition['operator'];
	textValue: string;
}

interface PreparedNumberFilter<TData> extends PreparedBase<TData> {
	kind: 'number';
	operator: NumberFilterCondition['operator'];
	value: number;
	valueTo?: number;
}

interface PreparedDateFilter<TData> extends PreparedBase<TData> {
	kind: 'date';
	operator: DateFilterCondition['operator'];
	dateFrom: Date;
	dateTo?: Date;
}

interface PreparedSetFilter<TData> extends PreparedBase<TData> {
	kind: 'set';
	valueSet: Set<string>;
	includeNull: boolean;
}

interface PreparedSelectFilter<TData> extends PreparedBase<TData> {
	kind: 'select';
	valueSet: Set<string>;
	includeNull: boolean;
	matchMode: 'any' | 'all';
}

interface PreparedCompoundFilter<TData> {
	kind: 'compound';
	logicalOp: 'AND' | 'OR';
	left: PreparedColumnFilter<TData>;
	right: PreparedColumnFilter<TData>;
}

type PreparedColumnFilter<TData> =
	| PreparedTextFilter<TData>
	| PreparedNumberFilter<TData>
	| PreparedDateFilter<TData>
	| PreparedSetFilter<TData>
	| PreparedSelectFilter<TData>
	| PreparedCompoundFilter<TData>;

function parseFilterDate(raw: string): Date | null {
	const d = new Date(raw);
	return isNaN(d.getTime()) ? null : d;
}

function stripTime(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseCellDate(value: unknown): Date | null {
	if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
	if (typeof value === 'number') return new Date(value);
	if (typeof value === 'string') {
		const d = new Date(value);
		return isNaN(d.getTime()) ? null : d;
	}
	return null;
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

function matchTextFilter(value: unknown, pf: PreparedTextFilter<unknown>): boolean {
	const isBlank = value == null || value === '';
	if (pf.operator === 'blank') return isBlank;
	if (pf.operator === 'notBlank') return !isBlank;
	const text = String(value ?? '').toLowerCase();
	switch (pf.operator) {
		case 'equals':
			return text === pf.textValue;
		case 'notEquals':
			return text !== pf.textValue;
		case 'startsWith':
			return text.startsWith(pf.textValue);
		case 'endsWith':
			return text.endsWith(pf.textValue);
		case 'notContains':
			return !text.includes(pf.textValue);
		case 'contains':
		default:
			return text.includes(pf.textValue);
	}
}

function matchNumberFilter(value: unknown, pf: PreparedNumberFilter<unknown>): boolean {
	const isBlank = value == null || value === '';
	if (pf.operator === 'blank') return isBlank;
	if (pf.operator === 'notBlank') return !isBlank;
	if (isBlank) return false;
	const n = Number(value);
	if (isNaN(n)) return false;
	switch (pf.operator) {
		case 'equals':
			return n === pf.value;
		case 'notEquals':
			return n !== pf.value;
		case 'gt':
			return n > pf.value;
		case 'gte':
			return n >= pf.value;
		case 'lt':
			return n < pf.value;
		case 'lte':
			return n <= pf.value;
		case 'inRange':
			return pf.valueTo !== undefined ? n >= pf.value && n <= pf.valueTo : n >= pf.value;
	}
}

function matchDateFilter(value: unknown, pf: PreparedDateFilter<unknown>): boolean {
	const isBlank = value == null || value === '';
	if (pf.operator === 'blank') return isBlank;
	if (pf.operator === 'notBlank') return !isBlank;
	const cellDate = parseCellDate(value);
	if (!cellDate) return false;
	switch (pf.operator) {
		case 'equals':
			return stripTime(cellDate).getTime() === stripTime(pf.dateFrom).getTime();
		case 'before':
			return cellDate < pf.dateFrom;
		case 'after':
			return cellDate > pf.dateFrom;
		case 'inRange':
			return pf.dateTo !== undefined ? cellDate >= pf.dateFrom && cellDate <= pf.dateTo : cellDate >= pf.dateFrom;
	}
}

function matchSetFilter(value: unknown, pf: PreparedSetFilter<unknown>): boolean {
	if (pf.valueSet.size === 0 && !pf.includeNull) return false;
	if (value == null || value === '') return pf.includeNull;
	return pf.valueSet.has(String(value).toLowerCase());
}

function matchSelectFilter(value: unknown, pf: PreparedSelectFilter<unknown>): boolean {
	if (pf.valueSet.size === 0 && !pf.includeNull) return false;
	if (value == null || value === '') return pf.includeNull;
	const strVal = String(value).toLowerCase();
	if (pf.matchMode === 'all') {
		// Unusual: cell value must equal every selected value (useful for multi-valued cells)
		return pf.valueSet.has(strVal) && pf.valueSet.size === 1;
	}
	// Default: OR — any selected value matches
	return pf.valueSet.has(strVal);
}

function matchPreparedFilter<TData>(node: RowNode<TData>, pf: PreparedColumnFilter<TData>): boolean {
	if (pf.kind === 'compound') {
		const l = matchPreparedFilter(node, pf.left);
		const r = matchPreparedFilter(node, pf.right);
		return pf.logicalOp === 'AND' ? l && r : l || r;
	}
	const value = pf.getter(node);
	switch (pf.kind) {
		case 'text':
			return matchTextFilter(value, pf as PreparedTextFilter<unknown>);
		case 'number':
			return matchNumberFilter(value, pf as PreparedNumberFilter<unknown>);
		case 'date':
			return matchDateFilter(value, pf as PreparedDateFilter<unknown>);
		case 'set':
			return matchSetFilter(value, pf as PreparedSetFilter<unknown>);
		case 'select':
			return matchSelectFilter(value, pf as PreparedSelectFilter<unknown>);
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

function makeGetter<TData>(column: ColumnDef<TData>): (node: RowNode<TData>) => unknown {
	if (column.valueGetter) {
		const vg = column.valueGetter;
		return (node) => vg({ node, row: node.data, colField: column.field });
	}
	const pg = compilePathGetter(column.field);
	return (node) => node.getCellValue(column.field, pg);
}

function prepareCondition<TData>(condition: FilterCondition, getter: (node: RowNode<TData>) => unknown): PreparedColumnFilter<TData> | null {
	if (condition.type === 'text') {
		return { kind: 'text', getter, operator: condition.operator, textValue: condition.value.toLowerCase() };
	}
	if (condition.type === 'number') {
		return { kind: 'number', getter, operator: condition.operator, value: condition.value, valueTo: condition.valueTo };
	}
	if (condition.type === 'date') {
		if (condition.operator === 'blank' || condition.operator === 'notBlank') {
			return { kind: 'date', getter, operator: condition.operator, dateFrom: new Date(0) };
		}
		const dateFrom = parseFilterDate(condition.dateFrom);
		if (!dateFrom) return null;
		const dateTo = condition.dateTo ? (parseFilterDate(condition.dateTo) ?? undefined) : undefined;
		return { kind: 'date', getter, operator: condition.operator, dateFrom, dateTo };
	}
	if (condition.type === 'set') {
		const hasNull = condition.values.includes(null);
		const valueSet = new Set(condition.values.filter((v): v is string | number => v !== null).map((v) => String(v).toLowerCase()));
		return { kind: 'set', getter, valueSet, includeNull: hasNull };
	}
	if (condition.type === 'select') {
		const hasNull = condition.values.includes(null);
		const valueSet = new Set(condition.values.filter((v): v is string | number => v !== null).map((v) => String(v).toLowerCase()));
		return { kind: 'select', getter, valueSet, includeNull: hasNull, matchMode: condition.matchMode ?? 'any' };
	}
	return null;
}

function prepareColumnFilter<TData>(columnFilter: ColumnFilter, getter: (node: RowNode<TData>) => unknown): PreparedColumnFilter<TData> | null {
	if (columnFilter.type === 'compound') {
		const [c1, c2] = columnFilter.conditions;
		const left = prepareCondition<TData>(c1, getter);
		const right = prepareCondition<TData>(c2, getter);
		if (!left || !right) return null;
		return { kind: 'compound', logicalOp: columnFilter.operator, left, right };
	}
	return prepareCondition(columnFilter, getter);
}

function prepareFilters<TData>(columns: Array<ColumnDef<TData>>, filterModel: FilterModel | null | undefined): PreparedColumnFilter<TData>[] {
	const result: PreparedColumnFilter<TData>[] = [];
	if (!filterModel) return result;
	const columnById = createColumnLookup(columns);

	for (const [colId, rawItem] of Object.entries(filterModel)) {
		const item = rawItem as ColumnFilter;
		if (!item) continue;
		const column = columnById.get(colId);
		if (!column) continue;
		const getter = makeGetter(column);
		const prepared = prepareColumnFilter(item, getter);
		if (prepared) result.push(prepared);
	}

	return result;
}

function nodeMatchesPreparedFilters<TData>(node: RowNode<TData>, preparedFilters: PreparedColumnFilter<TData>[]): boolean {
	for (let i = 0; i < preparedFilters.length; i++) {
		if (!matchPreparedFilter(node, preparedFilters[i])) return false;
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
	readonly dependencyRegistry = new RowDependencyRegistry<TData>();
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
			this.runtime.addEventListener(GridEventName.sortChanged, () => {
				this.rebuildDependencyRegistry();
				this.refresh();
			}),
			this.runtime.addEventListener(GridEventName.filterChanged, () => {
				this.rebuildDependencyRegistry();
				this.refresh();
			}),
			this.runtime.addEventListener(GridEventName.groupByChanged, () => {
				this.rebuildDependencyRegistry();
				this.refresh();
			}),
			this.runtime.addEventListener(GridEventName.aggDefsChanged, () => {
				this.rebuildDependencyRegistry();
				this.refresh();
			}),
			this.runtime.addEventListener(GridEventName.showGroupFooterChanged, () => this.refresh()),
			this.runtime.addEventListener(GridEventName.enableStickyGroupRowsChanged, () => this.refresh()),
			// Client pagination page change → re-run the pipeline with the new page window.
			this.runtime.addEventListener(GridEventName.paginationChanged, () => this.refresh('flatten'))
		);
		this.rebuildDependencyRegistry();
		this.setRows(options.rows);
	}

	public dispose(): void {
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	private rebuildDependencyRegistry(): void {
		const state = this.runtime.getState();
		this.dependencyRegistry.update({
			columns: state.columns,
			sortModel: state.sortModel,
			filterModel: state.filterModel,
			groupBy: state.groupBy,
			aggDefs: state.aggDefs,
			hasTreeParent: !!state.getParentId,
			treeParentDependencies: state.rowModelConfig?.treeData?.getParentIdDependencies,
		});
	}

	/** @internal Exposed for use by the incremental update path. */
	public classifyFieldMutation(changedFields: ReadonlySet<string>) {
		return classifyMutation(changedFields, this.dependencyRegistry);
	}

	/**
	 * Returns true when at least one of the changed nodes would enter or exit the active filter,
	 * meaning the visual row array must be rebuilt. Returns true immediately for grouped/tree grids
	 * because group rows may appear or disappear when all their children enter/exit the filter.
	 */
	private filterMembershipChanged(changedNodes: RowNode<TData>[]): boolean {
		const state = this.runtime.getState();
		if (state.groupBy?.length || state.rowModelConfig?.treeData?.enabled) return true;
		const preparedFilters = prepareFilters(state.columns, state.filterModel);
		for (const node of changedNodes) {
			const wasVisible = this.rowIdToVisualIndex.has(node.id);
			const passes = preparedFilters.length === 0 || nodeMatchesPreparedFilters(node, preparedFilters);
			if (wasVisible !== passes) return true;
		}
		return false;
	}

	/**
	 * Incrementally repositions changed rows within the sorted visual array, avoiding a full
	 * pipeline rebuild. Only applicable to flat (non-grouped, non-tree) grids with an active sort
	 * and no pagination. Returns false to signal that the caller must fall back to full refresh.
	 */
	private relocateSortedRows(changedNodes: RowNode<TData>[]): boolean {
		const state = this.runtime.getState();
		if (state.groupBy?.length) return false;
		if (state.rowModelConfig?.treeData?.enabled) return false;
		if (state.rowModelConfig?.masterDetail?.enabled) return false;
		if (!state.sortModel || state.sortModel.length === 0) return false;
		if (this._pageWindow !== null) return false;

		// Build sort key getters mirroring the pipeline's comparator
		const columnById = createColumnLookup(state.columns);
		const sortGetters = state.sortModel.map((sortItem) => {
			const col = columnById.get(sortItem.colId);
			if (col) {
				if (col.valueGetter) {
					const vg = col.valueGetter;
					return (node: RowNode<TData>): unknown => vg({ node, row: node.data, colField: col.field });
				}
				const pg = compilePathGetter(col.field);
				return (node: RowNode<TData>): unknown => node.getCellValue(col.field, pg);
			}
			return (): undefined => undefined;
		});

		// Pre-build source index map for stable-sort tiebreaker
		const allNodes = this.dataStore.getAllNodes();
		const sourceIndexOf = new Map<string, number>();
		for (let i = 0; i < allNodes.length; i++) sourceIndexOf.set(allNodes[i].id, i);

		const compareNodes = (a: RowNode<TData>, b: RowNode<TData>): number => {
			for (let i = 0; i < state.sortModel!.length; i++) {
				const aVal = sortGetters[i](a);
				const bVal = sortGetters[i](b);
				const cmp = compareValues(aVal, bVal);
				if (cmp !== 0) return state.sortModel![i].sort === 'desc' ? -cmp : cmp;
			}
			return (sourceIndexOf.get(a.id) ?? 0) - (sourceIndexOf.get(b.id) ?? 0);
		};

		// Collect VisualRow objects and old indices for each changed node
		const toRelocate: Array<{ node: RowNode<TData>; vr: VisualRow<TData>; oldIdx: number }> = [];
		for (const node of changedNodes) {
			const oldIdx = this.rowIdToVisualIndex.get(node.id);
			if (oldIdx === undefined) continue; // was filtered out; stays filtered (sort-key can't change filter membership)
			const vr = this.visualRows[oldIdx];
			if (vr?.kind === 'data') toRelocate.push({ node, vr, oldIdx });
		}
		if (toRelocate.length === 0) return true;

		// Remove in descending index order so prior splices don't shift remaining indices
		toRelocate.sort((a, b) => b.oldIdx - a.oldIdx);
		const mutable = this.visualRows.slice();
		for (const item of toRelocate) mutable.splice(item.oldIdx, 1);

		// Insert each row at its new sorted position
		for (const item of toRelocate) {
			let lo = 0,
				hi = mutable.length;
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				const midVR = mutable[mid];
				if (midVR?.kind !== 'data') {
					lo = mid + 1;
					continue;
				}
				if (compareNodes(item.node, midVR.node) <= 0) hi = mid;
				else lo = mid + 1;
			}
			mutable.splice(lo, 0, item.vr);
		}

		// Rebuild all three index maps from the updated array
		this.visualRows = mutable;
		this.visualRowIdToIndex = new Map();
		this.rowIdToVisualIndex = new Map();
		this.rowIdToVisualRowId = new Map();
		for (let i = 0; i < this.visualRows.length; i++) {
			const vr = this.visualRows[i];
			this.visualRowIdToIndex.set(vr.id, i);
			if (vr.kind === 'data') {
				this.rowIdToVisualIndex.set(vr.rowId, i);
				this.rowIdToVisualRowId.set(vr.rowId, vr.id);
			}
		}
		return true;
	}

	public setRows(rows: TData[]): void {
		this.dataStore.setRows(rows);
		this.runtime.clearFormulas();
		this.refresh();
	}

	/**
	 * Threshold (added + removed rows) above which a full pipeline rebuild is cheaper than
	 * incremental insert/remove into the visual array. Chosen empirically: below this threshold
	 * individual array splices + map rebuilds outperform a full O(N log N) sort.
	 */
	private static readonly INCREMENTAL_TX_LIMIT = 100;

	/**
	 * Attempts to apply structural row mutations (adds/removes) incrementally on flat grids.
	 * Returns false to signal full rebuild is needed (grouped/tree/paginated grids, or when
	 * the transaction exceeds the INCREMENTAL_TX_LIMIT threshold).
	 */
	private tryIncrementalTransaction(added: RowNode<TData>[], removed: RowNode<TData>[]): boolean {
		const state = this.runtime.getState();
		if (state.groupBy?.length) return false;
		if (state.rowModelConfig?.treeData?.enabled) return false;
		if (state.rowModelConfig?.masterDetail?.enabled) return false;
		if (this._pageWindow !== null) return false;
		if (added.length + removed.length > ClientRowModelController.INCREMENTAL_TX_LIMIT) return false;

		const mutable = this.visualRows.slice();

		// Removals: collect visual indices in descending order so splices don't shift later indices
		if (removed.length > 0) {
			const removalIndices: number[] = [];
			for (const node of removed) {
				const idx = this.rowIdToVisualIndex.get(node.id);
				if (idx !== undefined) removalIndices.push(idx);
			}
			removalIndices.sort((a, b) => b - a);
			for (const idx of removalIndices) mutable.splice(idx, 1);
		}

		// Additions: filter-check, then insert at sorted position (or append if unsorted)
		if (added.length > 0) {
			const preparedFilters = prepareFilters(state.columns, state.filterModel);
			const hasSort = !!(state.sortModel && state.sortModel.length > 0);

			let sortComparator: ((a: RowNode<TData>, b: RowNode<TData>) => number) | null = null;
			if (hasSort) {
				const columnById = createColumnLookup(state.columns);
				const sortGetters = state.sortModel!.map((sortItem) => {
					const col = columnById.get(sortItem.colId);
					if (col) {
						if (col.valueGetter) {
							const vg = col.valueGetter;
							return (node: RowNode<TData>): unknown => vg({ node, row: node.data, colField: col.field });
						}
						const pg = compilePathGetter(col.field);
						return (node: RowNode<TData>): unknown => node.getCellValue(col.field, pg);
					}
					return (): undefined => undefined;
				});
				const allNodes = this.dataStore.getAllNodes();
				const sourceIndexOf = new Map<string, number>();
				for (let i = 0; i < allNodes.length; i++) sourceIndexOf.set(allNodes[i].id, i);

				sortComparator = (a: RowNode<TData>, b: RowNode<TData>): number => {
					for (let i = 0; i < state.sortModel!.length; i++) {
						const cmp = compareValues(sortGetters[i](a), sortGetters[i](b));
						if (cmp !== 0) return state.sortModel![i].sort === 'desc' ? -cmp : cmp;
					}
					return (sourceIndexOf.get(a.id) ?? 0) - (sourceIndexOf.get(b.id) ?? 0);
				};
			}

			for (const node of added) {
				if (preparedFilters.length > 0 && !nodeMatchesPreparedFilters(node, preparedFilters)) continue;

				const explicitHeight = (state.rowHeights as Record<string, number>)[node.id];
				const vr: VisualRow<TData> = {
					kind: 'data',
					id: toDataVisualRowId(node.id),
					rowId: node.id,
					node,
					depth: 0,
					height: explicitHeight !== undefined ? explicitHeight : state.defaultRowHeight,
					selectable: true,
					editable: true,
				};

				if (sortComparator) {
					let lo = 0,
						hi = mutable.length;
					while (lo < hi) {
						const mid = (lo + hi) >>> 1;
						const midVR = mutable[mid];
						if (midVR?.kind !== 'data') {
							lo = mid + 1;
							continue;
						}
						if (sortComparator(node, midVR.node) <= 0) hi = mid;
						else lo = mid + 1;
					}
					mutable.splice(lo, 0, vr);
				} else {
					mutable.push(vr);
				}
			}
		}

		// Rebuild all index maps from the updated visual array
		this.visualRows = mutable;
		this.visualRowIdToIndex = new Map();
		this.rowIdToVisualIndex = new Map();
		this.rowIdToVisualRowId = new Map();
		this.dataRowCount = 0;
		for (let i = 0; i < this.visualRows.length; i++) {
			const vr = this.visualRows[i];
			this.visualRowIdToIndex.set(vr.id, i);
			if (vr.kind === 'data') {
				this.rowIdToVisualIndex.set(vr.rowId, i);
				this.rowIdToVisualRowId.set(vr.rowId, vr.id);
				this.dataRowCount++;
			}
		}
		return true;
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

		// Classify the mutation impact using the dependency registry — covers sort, filter,
		// group, tree-parent, and formula dependencies in one pass over all changed fields.
		const allChangedFields = new Set<string>();
		for (const [, fields] of result.changedFieldsByRow) {
			for (const field of fields) allChangedFields.add(field);
		}
		const impact = this.classifyFieldMutation(allChangedFields);

		// sort-key: attempt incremental relocation within the sorted array. Falls back to full
		// rebuild for grouped/tree/paginated grids or when relocateSortedRows returns false.
		// filter-key: test membership for each changed node on flat grids. If no row enters
		// or exits the filter, the visual array is unchanged — skip the pipeline rebuild.
		let needsFullRefresh = impact === 'group-key' || impact === 'tree-parent';
		let didSortRelocation = false;
		if (!needsFullRefresh && impact === 'sort-key') {
			didSortRelocation = this.relocateSortedRows(result.changedNodes);
			needsFullRefresh = !didSortRelocation;
		}
		if (!needsFullRefresh && impact === 'filter-key') {
			needsFullRefresh = this.filterMembershipChanged(result.changedNodes);
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

			// Sort relocation changed the visual order — bump version so geometry and renderer
			// refresh with the new row positions. Value-only updates don't need this since
			// the visual array is unchanged and each cell's notifyBulkCellChange is sufficient.
			if (didSortRelocation) {
				this.runtime.bumpGlobalVersion();
			}

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
			// Attempt incremental insert/remove for flat grids within the threshold; fall
			// back to full rebuild for grouped/tree/paginated grids or large transactions.
			const wasIncremental = this.tryIncrementalTransaction(result.added, result.removed);
			if (wasIncremental) {
				this.runtime.bumpGlobalVersion();
			} else {
				this.refresh('bulk');
			}
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

	public getAllDataNodes = (): RowNode<TData>[] => this.dataStore.getAllNodes();

	public getRowOrder = (): string[] => this.dataStore.getSourceOrder();

	public setRowOrder = (rowIds: string[]): void => {
		this.dataStore.setRowOrder(rowIds);
		this.refresh('row-order');
	};

	public getSelectableDataRowIds = (scope: RowSelectionScope = 'page'): string[] => {
		if (scope === 'all') {
			return this.dataStore.getAllNodes().map((node) => node.id);
		}
		if (scope === 'filtered') {
			const state = this.runtime.getState();
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
			});
			return result.visualRows.flatMap((row) => (row.kind === 'data' ? [row.rowId] : []));
		}
		const ids: string[] = [];
		for (const row of this.visualRows) {
			if (row?.kind === 'data') ids.push(row.rowId);
		}
		return ids;
	};

	public setCellValue = (rowId: string, colField: string, value: unknown): boolean => {
		const node = this.getRowNodeById(rowId);
		if (!node) return false;

		const col = this.runtime.getColumnDef(colField);
		const oldValue = this.runtime.getCellValue(rowId, colField);
		const updatedRow = { ...node.data };
		if (col?.valueSetter) {
			// Sync path: call valueSetter with params. Async setters are handled by commitEdit.
			const result = col.valueSetter({ value, oldValue, row: updatedRow, colField, abort: () => {} });
			if (result === false || (result instanceof Promise && false)) return false;
			// For sync-returning false, bail out. Async setters proceed optimistically here.
			if (!(result instanceof Promise) && !result) return false;
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.setData(updatedRow);

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
