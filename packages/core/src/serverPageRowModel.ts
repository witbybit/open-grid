import { type ColumnDef, setValueByPath } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { ServerPageRowModelRuntime } from './engine/runtimePorts.js';
import type {
	DataRowCountModel,
	RowModel,
	RowRefreshReason,
	RowModelRefreshResult,
	RowModelWriteResult,
	SelectableDataRowModel,
	ServerPageControllableRowModel,
	AnyModelCellWritable,
	CapableRowModel,
	RowModelCapabilities,
	RowCountKind,
	RowLoadState,
	RowModelRequestToken,
	RowModelQueryState,
	RowRangeLoadState,
} from './rowModel.js';
import type { RowSelectionScope } from './api/GridApi.js';
import { RowNode } from './rowNode.js';
import { toDataVisualRowId, toFailedVisualRowId, toLoadingVisualRowId } from './rows/visualRowIds.js';
import type { VisualRow } from './visualRow.js';
import { createAsyncRowModelQuerySnapshot } from './asyncRowModelQuerySnapshot.js';
import { createServerPageScopeId } from './asyncRowModelRequestIdentity.js';

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error.length > 0) return error;
	return 'Unknown server page load failure';
}

function validateServerPageResponse<TRowData>(
	response: ServerGetPageResult<TRowData>,
	options: { page: number; pageSize: number; getRowId: (row: TRowData) => string }
): void {
	if (response.rows.length > options.pageSize) {
		throw new Error(`Server datasource returned ${response.rows.length} rows for page size ${options.pageSize}`);
	}
	if (response.totalRowCount < 0) {
		throw new Error(`Server datasource returned negative totalRowCount ${response.totalRowCount}`);
	}
	const pageStart = options.page * options.pageSize;
	const minimumReachableCount = pageStart + response.rows.length;
	if (response.totalRowCount < minimumReachableCount) {
		throw new Error(
			`Server datasource returned totalRowCount ${response.totalRowCount}, which is smaller than the loaded page range ending at ${minimumReachableCount - 1}`
		);
	}
	if (response.rows.length < options.pageSize && response.totalRowCount > minimumReachableCount) {
		throw new Error(
			`Server datasource returned ${response.rows.length} rows for page ${options.page} with page size ${options.pageSize}, but totalRowCount ${response.totalRowCount} still requires rows within that page`
		);
	}
	const seenRowIds = new Set<string>();
	for (const row of response.rows) {
		const rowId = options.getRowId(row);
		if (seenRowIds.has(rowId)) {
			throw new Error(`Server datasource returned duplicate row id "${rowId}" within one page`);
		}
		seenRowIds.add(rowId);
	}
}

export interface ServerGetPageParams {
	readonly page: number;
	readonly pageSize: number;
	readonly sortModel: unknown;
	readonly filterModel: unknown;
	/** QuickFilterModel | null — a single search string to match across multiple columns server-side. */
	readonly quickFilterModel: unknown;
	readonly queryModel: unknown;
}

export interface ServerGetPageResult<TRowData> {
	readonly rows: readonly TRowData[];
	readonly totalRowCount: number;
}

export interface ServerDatasource<TRowData = unknown> {
	getPage(params: ServerGetPageParams, context: { signal?: AbortSignal }): Promise<ServerGetPageResult<TRowData>>;
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
		AnyModelCellWritable<TData>,
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
	private datasourceGeneration = 0;
	private queryVersion = 0;
	private nextRequestId = 1;
	private activePageRequestId = 0;
	private activeAbortController: AbortController | null = null;

	private currentPage: number;
	private pageSize: number;
	private pageCount = 1;
	private totalRowCount = 0;
	private loading = false;
	private error: string | null = null;
	private hasResolvedPage = false;

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
				this.invalidateQueryAndResetPage();
			}),
			this.runtime.addEventListener(GridEventName.filterChanged, () => {
				this.invalidateQueryAndResetPage();
			}),
			this.runtime.addEventListener(GridEventName.quickFilterChanged, () => {
				this.invalidateQueryAndResetPage();
			}),
			this.runtime.addEventListener(GridEventName.queryModelChanged, () => {
				this.invalidateQueryAndResetPage();
			})
		);

		this.fetchPage({ preserveVisibleRows: false });
	}

	public getCapabilities(): RowModelCapabilities {
		return SERVER_PAGE_CAPABILITIES;
	}

	public setDatasource(datasource: ServerDatasource<TData>): void {
		this.datasource = datasource;
		this.bumpDatasourceGeneration();
		this.currentPage = 0;
		this.fetchPage({ preserveVisibleRows: false });
	}

	public goToPage(page: number): void {
		const clamped = Math.max(0, Math.min(page, Math.max(0, this.pageCount - 1)));
		if (clamped === this.currentPage && !this.loading) return;
		this.currentPage = clamped;
		this.fetchPage({ preserveVisibleRows: false });
	}

	public setPageSize(pageSize: number): void {
		this.pageSize = Math.max(1, pageSize);
		this.currentPage = 0;
		this.fetchPage({ preserveVisibleRows: false });
	}

	public reloadPage(_reason?: string): void {
		this.fetchPage({ preserveVisibleRows: true });
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
		this.bumpDatasourceGeneration();
		this.abortActivePageRequest();
		this.unsubscribers.forEach((u) => u());
		this.unsubscribers = [];
	}

	public getVisualRow = (rowIndex: number): VisualRow<TData> | null => {
		const row = this.visualRows[rowIndex];
		if (row) return row;
		const state = this.getRowLoadState(rowIndex);
		if (state.kind === 'failed') {
			return {
				kind: 'failed',
				id: toFailedVisualRowId(rowIndex),
				rowIndex,
				error: state.error,
				retryable: state.retryable,
				editable: false,
			};
		}
		if (state.kind === 'loading') {
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

	public getKnownRowCount = (): number | null => {
		return this.getRowCountKind() === 'known' ? this.getVisualRowCount() : null;
	};

	public getEstimatedRowCount = (): number => {
		return this.getVisualRowCount();
	};

	public getRowCountKind = (): RowCountKind => {
		if (this.loading && this.visualRows.length === 0) return 'estimated';
		if (this.error && this.visualRows.length === 0) return 'estimated';
		return this.hasResolvedPage ? 'known' : 'unknown';
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

	public getRowLoadState = (index: number): RowLoadState => {
		if (index < 0) return { kind: 'missing' };
		const row = this.visualRows[index];
		if (row?.kind === 'data') return { kind: 'loaded', rowId: row.rowId };
		if (this.loading && this.visualRows.length === 0 && index < this.pageSize) {
			return { kind: 'loading', reason: 'server-page' };
		}
		if (this.error && this.visualRows.length === 0 && index < this.pageSize) {
			return { kind: 'failed', error: this.error, retryable: true };
		}
		return { kind: 'missing' };
	};

	public isRowLoaded = (index: number): boolean => {
		return this.getRowLoadState(index).kind === 'loaded';
	};

	public isRowLoading = (index: number): boolean => {
		return this.getRowLoadState(index).kind === 'loading';
	};

	public isRowFailed = (index: number): boolean => {
		return this.getRowLoadState(index).kind === 'failed';
	};

	public isRangeLoaded = (startRow: number, endRow: number): boolean => {
		if (startRow > endRow) return true;
		for (let index = startRow; index <= endRow; index++) {
			if (!this.isRowLoaded(index)) return false;
		}
		return true;
	};

	public getRangeLoadState = (startRow: number, endRow: number): RowRangeLoadState => {
		const state: RowRangeLoadState = { loaded: 0, loading: 0, failed: 0, placeholder: 0, missing: 0 };
		if (startRow > endRow) return state;
		for (let index = startRow; index <= endRow; index++) {
			const rowState = this.getRowLoadState(index);
			state[rowState.kind]++;
		}
		return state;
	};

	public ensureRange = (startRow: number, endRow: number, reason?: string): void => {
		if (startRow > endRow) return;
		const shouldRetry = this.isRetryReason(reason);
		const rangeState = this.getRangeLoadState(startRow, endRow);
		const representedRows = rangeState.loaded + rangeState.loading + rangeState.failed + rangeState.placeholder;
		const requestedRows = endRow - startRow + 1;
		const rangeIsAlreadyRepresented = representedRows === requestedRows && rangeState.missing === 0;

		if (this.loading && !shouldRetry) return;
		if (rangeIsAlreadyRepresented && !shouldRetry) return;
		if (!shouldRetry && rangeState.missing === 0) return;

		this.reloadPage(reason);
	};

	public getSelectableDataRowIds = (scope: RowSelectionScope = 'loaded'): string[] => {
		if (scope === 'all' || scope === 'filtered') return [];
		// Server-page rows only know the active page. Treat `loaded` as the current page window.
		return this.activeNodes.map((n) => n.id);
	};

	public writeCellValueStructurally = (
		rowId: string,
		colField: string,
		value: unknown,
		options?: { bypassValueSetter?: boolean }
	): RowModelWriteResult<TData> => {
		const node = this.nodeMap.get(rowId);
		if (!node) return { visualChange: 'none' };

		const col = this.runtime.getColumnDef(colField);
		const oldValue = this.runtime.getCellValue(rowId, colField);
		const updatedRow = { ...node.data };

		if (!options?.bypassValueSetter && col?.valueSetter) {
			const result = col.valueSetter({ value, oldValue, row: updatedRow, colField, abort: () => {} });
			if (!(result instanceof Promise) && !result) return { visualChange: 'none' };
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.setData(updatedRow);

		const state = this.runtime.getState();
		const affectsServerOrder =
			(state.sortModel?.some((s) => s.colId === colField) ?? false) || (state.filterModel != null && colField in state.filterModel);
		if (affectsServerOrder) {
			this.reloadPage('row-write-server-refresh');
		}

		const changedFieldsByRow = new Map<string, Set<string>>();
		changedFieldsByRow.set(rowId, new Set([colField]));
		return { updatedNodes: [node], changedFieldsByRow, visualChange: 'none' };
	};

	private clearActivePageRows(): void {
		this.activeNodes = [];
		this.visualRows = [];
		this.nodeMap.clear();
		this.visualRowIdToIndex.clear();
		this.rowIdToVisualIndex.clear();
	}

	private fetchPage = async (options?: { preserveVisibleRows?: boolean }): Promise<void> => {
		if (this.disposed) return;
		this.abortActivePageRequest();

		const page = this.currentPage;
		const pageSize = this.pageSize;
		const preserveVisibleRows = options?.preserveVisibleRows ?? false;
		const requestToken = this.createPageRequestToken(page, pageSize);
		const abortController = new AbortController();
		this.activeAbortController = abortController;

		this.loading = true;
		this.error = null;
		if (!preserveVisibleRows) {
			this.clearActivePageRows();
		}
		this.runtime.setLoadingState(true);
		this.runtime.setServerPageState({
			page,
			pageSize,
			pageCount: this.pageCount,
			totalRowCount: this.totalRowCount,
			loading: true,
			error: null,
		});
		this.runtime.publishServerSideState(this.getMirroredServerSideState({ loading: true, error: null }));
		this.runtime.dispatchServerPageLoadingStarted({ page, pageSize });

		const state = this.runtime.getState();
		const querySnapshot = createAsyncRowModelQuerySnapshot(state);

		try {
			const response = await this.datasource.getPage({
				page,
				pageSize,
				sortModel: querySnapshot.sortModel,
				filterModel: querySnapshot.filterModel,
				quickFilterModel: querySnapshot.quickFilterModel,
				queryModel: querySnapshot.queryModel,
			}, { signal: abortController.signal });

			if (!this.isRequestTokenCurrent(requestToken)) return;
			validateServerPageResponse(response, {
				page,
				pageSize,
				getRowId: (row) => this.runtime.getRowId(row as TData),
			});
			const previousRowCount = this.getVisualRowCount();
			const previousNodesById = new Map(this.nodeMap);

			this.loading = false;
			this.error = null;

			// Replace active rows atomically
			this.clearActivePageRows();

			response.rows.forEach((row, idx) => {
				const typedRow = row as TData;
				const id = this.runtime.getRowId(typedRow);
				const existing = previousNodesById.get(id);
				const node = existing ?? new RowNode<TData>(id, typedRow);
				if (existing) {
					existing.setData(typedRow);
				}
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
			this.hasResolvedPage = true;
			// Clamp currentPage if it's now out of range (e.g. after pageSize change)
			this.currentPage = Math.min(this.currentPage, this.pageCount - 1);
			this.publishPageRefresh(previousRowCount, 'rows:server-page-loaded');

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
			this.runtime.publishServerSideState(this.getMirroredServerSideState({ loading: false, error: null }));
		} catch (error) {
			if (!this.isRequestTokenCurrent(requestToken)) return;
			const previousRowCount = this.getVisualRowCount();

			this.loading = false;
			this.error = toErrorMessage(error);
			this.publishPageRefresh(previousRowCount, 'rows:server-page-load-failed');
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
			this.runtime.publishServerSideState(this.getMirroredServerSideState({ loading: false, error: this.error }));
		} finally {
			if (this.activeAbortController === abortController) {
				this.activeAbortController = null;
			}
		}
	};

	private getMirroredServerSideState(input: { loading: boolean; error: string | null }): NonNullable<import('./state/GridState.js').GridUIState['serverSide']> {
		return {
			loading: input.loading,
			error: input.error,
			storeStates: [],
		};
	}

	public refresh(_reason?: RowRefreshReason): RowModelRefreshResult {
		this.fetchPage({ preserveVisibleRows: true });
		return { changed: true };
	}

	private getQueryState(): RowModelQueryState {
		return {
			datasourceGeneration: this.datasourceGeneration,
			queryVersion: this.queryVersion,
		};
	}

	private createPageRequestToken(page: number, pageSize: number): RowModelRequestToken {
		const queryState = this.getQueryState();
		const requestId = this.nextRequestId++;
		this.activePageRequestId = requestId;
		return {
			kind: 'server-page',
			datasourceGeneration: queryState.datasourceGeneration,
			queryVersion: queryState.queryVersion,
			requestId,
			scopeId: createServerPageScopeId(),
			page,
			pageSize,
		};
	}

	private isRequestTokenCurrent(token: RowModelRequestToken): boolean {
		if (this.disposed) return false;
		if (token.kind !== 'server-page') return false;
		return (
			token.datasourceGeneration === this.datasourceGeneration &&
			token.queryVersion === this.queryVersion &&
			token.scopeId === createServerPageScopeId() &&
			token.requestId === this.activePageRequestId &&
			token.page === this.currentPage &&
			token.pageSize === this.pageSize
		);
	}

	private bumpDatasourceGeneration(): void {
		this.datasourceGeneration++;
	}

	private invalidateQueryAndResetPage(): void {
		this.queryVersion++;
		this.currentPage = 0;
		this.fetchPage({ preserveVisibleRows: false });
	}

	private publishPageRefresh(
		previousRowCount: number,
		requestRenderReason: 'rows:server-page-loaded' | 'rows:server-page-load-failed'
	): void {
		const nextRowCount = this.getVisualRowCount();
		const changedEndIndex = Math.max(previousRowCount, nextRowCount, 1) - 1;
		this.runtime.applyRefreshInvalidation(
			{
				changed: true,
				reason: 'refresh',
				previousRowCount,
				nextRowCount,
				changedStartIndex: 0,
				changedEndIndex,
			},
			{
				invalidationReason: 'viewport',
				requestRenderReason,
			}
		);
	}

	private isRetryReason(reason?: string): boolean {
		return reason === 'row-node-retry-load' || reason === 'retry' || reason === 'force-reload';
	}

	private abortActivePageRequest(): void {
		if (!this.activeAbortController) return;
		this.activeAbortController.abort();
		this.activeAbortController = null;
	}
}
