import { type ColumnDef, setValueByPath } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { ServerPageRowModelRuntime } from './engine/runtimePorts.js';
import type {
	CellValueWritableRowModel,
	DataRowCountModel,
	RowModel,
	RowRefreshReason,
	RowModelRefreshResult,
	SelectableDataRowModel,
	ServerPageControllableRowModel,
	CapableRowModel,
	RowModelCapabilities,
} from './rowModel.js';
import type { RowSelectionScope } from './api/GridApi.js';
import { RowNode } from './rowNode.js';
import { toDataVisualRowId, toLoadingVisualRowId } from './rows/visualRowIds.js';
import type { VisualRow } from './visualRow.js';

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error.length > 0) return error;
	return 'Unknown server page load failure';
}

export interface ServerGetPageParams {
	readonly page: number;
	readonly pageSize: number;
	readonly sortModel: unknown;
	readonly filterModel: unknown;
	readonly queryModel: unknown;
}

export interface ServerGetPageResult<TRowData> {
	readonly rows: readonly TRowData[];
	readonly totalRowCount: number;
}

export interface ServerDatasource<TRowData = unknown> {
	getPage(params: ServerGetPageParams): Promise<{ rows: TRowData[]; totalRowCount: number }>;
}

export interface ServerPaginationOptions {
	pageSize: number;
	initialPage?: number;
}

export interface ServerPageState {
	readonly page: number;
	readonly pageSize: number;
	readonly pageCount: number;
	readonly totalRowCount: number;
	readonly loading: boolean;
	readonly error: string | null;
}

export interface ServerPageRowModelOptions<TData = unknown> {
	datasource: ServerDatasource<TData>;
	columns: Array<ColumnDef<TData>>;
	getRowId?: (row: TData) => string;
	pagination: ServerPaginationOptions;
}

const SERVER_PAGE_CAPABILITIES: RowModelCapabilities = {
	fullDataset: false,
	loadedDataset: false,
	pagedDataset: true,
	clientMutation: false,
	loadedRowMutation: false,
	pageRowMutation: true,
	transactions: false,
	rowOrder: false,
	blockLoading: false,
	serverPagination: true,
	clientSort: false,
	clientFilter: false,
	serverSort: true,
	serverFilter: true,
	clientGrouping: false,
	clientTree: false,
	aggregation: false,
	masterDetail: false,
	allRowSelection: false,
	loadedRowSelection: false,
	pageRowSelection: true,
};

export class ServerPageRowModelController<TData = unknown>
	implements
		RowModel<TData>,
		DataRowCountModel,
		SelectableDataRowModel,
		ServerPageControllableRowModel<TData>,
		CellValueWritableRowModel<TData>,
		CapableRowModel
{
	private readonly runtime: ServerPageRowModelRuntime<TData>;
	private datasource: ServerDatasource<TData>;
	private activeNodes: Array<RowNode<TData>> = [];
	private visualRows: Array<VisualRow<TData>> = [];
	private nodeMap = new Map<string, RowNode<TData>>();
	private visualRowIdToIndex = new Map<string, number>();
	private rowIdToVisualIndex = new Map<string, number>();
	private unsubscribers: Array<() => void> = [];
	private disposed = false;
	private requestGeneration = 0;

	private currentPage: number;
	private pageSize: number;
	private pageCount = 1;
	private totalRowCount = 0;
	private loading = false;
	private error: string | null = null;

	constructor(runtime: ServerPageRowModelRuntime<TData>, options: ServerPageRowModelOptions<TData>) {
		this.runtime = runtime;
		this.datasource = options.datasource;
		this.pageSize = options.pagination.pageSize;
		this.currentPage = options.pagination.initialPage ?? 0;

		this.runtime.initializeModel({
			columns: options.columns,
			getRowId: options.getRowId,
		});

		this.runtime.registerRowModel(this);

		this.unsubscribers.push(
			this.runtime.addEventListener(GridEventName.sortChanged, () => {
				this.currentPage = 0;
				this.fetchPage();
			}),
			this.runtime.addEventListener(GridEventName.filterChanged, () => {
				this.currentPage = 0;
				this.fetchPage();
			})
		);

		this.fetchPage();
	}

	public getCapabilities(): RowModelCapabilities {
		return SERVER_PAGE_CAPABILITIES;
	}

	public setDatasource(datasource: ServerDatasource<TData>): void {
		this.datasource = datasource;
		this.currentPage = 0;
		this.fetchPage();
	}

	public goToPage(page: number): void {
		const clamped = Math.max(0, Math.min(page, Math.max(0, this.pageCount - 1)));
		if (clamped === this.currentPage && !this.loading) return;
		this.currentPage = clamped;
		this.fetchPage();
	}

	public setPageSize(pageSize: number): void {
		this.pageSize = Math.max(1, pageSize);
		this.currentPage = 0;
		this.fetchPage();
	}

	public reloadPage(_reason?: string): void {
		this.fetchPage();
	}

	public getPageState(): ServerPageState {
		return {
			page: this.currentPage,
			pageSize: this.pageSize,
			pageCount: this.pageCount,
			totalRowCount: this.totalRowCount,
			loading: this.loading,
			error: this.error,
		};
	}

	public dispose(): void {
		this.disposed = true;
		this.requestGeneration++;
		this.unsubscribers.forEach((u) => u());
		this.unsubscribers = [];
	}

	public getVisualRow = (rowIndex: number): VisualRow<TData> | null => {
		const row = this.visualRows[rowIndex];
		if (row) return row;
		if (this.loading && rowIndex >= 0 && rowIndex < this.pageSize) {
			return {
				kind: 'loading',
				id: toLoadingVisualRowId(rowIndex),
				rowIndex,
				editable: false,
			};
		}
		return null;
	};

	public getRowNodeById = (rowId: string): RowNode<TData> | null => {
		return this.nodeMap.get(rowId) ?? null;
	};

	public getVisualRowCount = (): number => {
		if (this.loading && this.visualRows.length === 0) return this.pageSize;
		return this.visualRows.length;
	};

	public getDataRowCount = (): number => {
		return this.visualRows.length;
	};

	public getVisualIndexById = (visualRowId: string): number => {
		const idx = this.visualRowIdToIndex.get(visualRowId);
		return idx !== undefined ? idx : -1;
	};

	public getVisualIndexByRowId = (rowId: string): number => {
		const idx = this.rowIdToVisualIndex.get(rowId);
		return idx !== undefined ? idx : -1;
	};

	public getRawRowById = (rowId: string): TData | null => {
		return this.nodeMap.get(rowId)?.data ?? null;
	};

	public getSelectableDataRowIds = (_scope: RowSelectionScope = 'loaded'): string[] => {
		return this.activeNodes.map((n) => n.id);
	};

	public setCellValue = (rowId: string, colField: string, value: unknown): boolean => {
		const node = this.getRowNodeById(rowId);
		if (!node) return false;

		const col = this.runtime.getColumnDef(colField);
		const oldValue = this.runtime.getCellValue(rowId, colField);
		const updatedRow = { ...node.data };
		if (col?.valueSetter) {
			const result = col.valueSetter({ value, oldValue, row: updatedRow, colField, abort: () => {} });
			if (!(result instanceof Promise) && !result) return false;
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.setData(updatedRow);
		return true;
	};

	private fetchPage = async (): Promise<void> => {
		if (this.disposed) return;

		this.requestGeneration++;
		const generation = this.requestGeneration;
		const page = this.currentPage;
		const pageSize = this.pageSize;

		this.loading = true;
		this.error = null;
		this.runtime.setLoadingState(true);
		this.runtime.setServerPageState({
			page,
			pageSize,
			pageCount: this.pageCount,
			totalRowCount: this.totalRowCount,
			loading: true,
			error: null,
		});
		this.runtime.dispatchServerPageLoadingStarted({ page, pageSize });

		const state = this.runtime.getState();

		try {
			const response = await this.datasource.getPage({
				page,
				pageSize,
				sortModel: state.sortModel,
				filterModel: state.filterModel,
				queryModel: state.queryModel,
			});

			if (this.disposed || generation !== this.requestGeneration) return;

			this.loading = false;
			this.error = null;

			// Replace active rows atomically
			this.activeNodes = [];
			this.visualRows = [];
			this.nodeMap.clear();
			this.visualRowIdToIndex.clear();
			this.rowIdToVisualIndex.clear();

			response.rows.forEach((row, idx) => {
				const typedRow = row as TData;
				const id = this.runtime.getRowId(typedRow);
				const node = new RowNode<TData>(id, typedRow);
				this.activeNodes[idx] = node;
				this.visualRows[idx] = {
					kind: 'data',
					id: toDataVisualRowId(node.id),
					rowId: node.id,
					node,
					depth: 0,
				};
				this.nodeMap.set(id, node);
				this.visualRowIdToIndex.set(toDataVisualRowId(id), idx);
				this.rowIdToVisualIndex.set(id, idx);
			});

			this.totalRowCount = response.totalRowCount;
			this.pageCount = Math.max(1, Math.ceil(response.totalRowCount / pageSize));
			// Clamp currentPage if it's now out of range (e.g. after pageSize change)
			this.currentPage = Math.min(this.currentPage, this.pageCount - 1);

			this.runtime.clearFormulas();
			this.runtime.setLoadingState(false);

			this.runtime.dispatchServerPageLoaded({
				page: this.currentPage,
				pageSize,
				pageCount: this.pageCount,
				totalRowCount: this.totalRowCount,
			});

			this.runtime.setServerPageState({
				page: this.currentPage,
				pageSize,
				pageCount: this.pageCount,
				totalRowCount: this.totalRowCount,
				loading: false,
				error: null,
			});
		} catch (error) {
			if (this.disposed || generation !== this.requestGeneration) return;

			this.loading = false;
			this.error = toErrorMessage(error);
			this.runtime.setLoadingState(false);
			this.runtime.dispatchServerPageLoadFailed({
				page,
				pageSize,
				message: this.error,
			});
			this.runtime.setServerPageState({
				page: this.currentPage,
				pageSize,
				pageCount: this.pageCount,
				totalRowCount: this.totalRowCount,
				loading: false,
				error: this.error,
			});
		}
	};

	public refresh(_reason?: RowRefreshReason): RowModelRefreshResult {
		this.fetchPage();
		return { changed: true };
	}
}
