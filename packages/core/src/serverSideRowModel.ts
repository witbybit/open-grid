import type { AggregationDef, FilterModel, QuickFilterModel, SortModel } from './rowModel.js';
import type { GridQueryModel } from './query/GridQueryModel.js';
import { normalizeServerSideRoute } from './serverSideRoute.js';

/**
 * Canonical immutable store route identity for the real server-side row model.
 * The empty route represents the root store.
 */
export type ServerSideRoute = readonly string[];

export interface ServerSideRowGroupColumn {
	readonly colId: string;
	readonly field?: string;
}

export interface ServerSideValueColumn {
	readonly colId: string;
	readonly field?: string;
	readonly aggFunc?: AggregationDef<unknown>['aggFunc'];
}

export interface ServerSideGroupMetadata {
	readonly rowId: string;
	readonly route: ServerSideRoute;
	readonly groupKey: string;
	readonly expandable: boolean;
}

export interface ServerSideGetRowsRequest {
	readonly startRow: number;
	readonly endRow: number;
	readonly route: ServerSideRoute;
	readonly groupKeys: readonly string[];
	readonly rowGroupColumns: readonly ServerSideRowGroupColumn[];
	readonly valueColumns: readonly ServerSideValueColumn[];
	readonly sortModel: SortModel | null;
	readonly filterModel: FilterModel | null;
	readonly quickFilterModel: QuickFilterModel | null;
	readonly queryModel: GridQueryModel | null;
}

export interface CreateServerSideGetRowsRequestInput {
	readonly startRow: number;
	readonly endRow: number;
	readonly route?: ServerSideRoute | null;
	readonly groupKeys?: readonly string[] | null;
	readonly rowGroupColumns?: readonly ServerSideRowGroupColumn[] | null;
	readonly valueColumns?: readonly ServerSideValueColumn[] | null;
	readonly sortModel?: SortModel | null;
	readonly filterModel?: FilterModel | null;
	readonly quickFilterModel?: QuickFilterModel | null;
	readonly queryModel?: GridQueryModel | null;
}

function freezeColumnMetadata<TColumn extends object>(columns?: readonly TColumn[] | null): readonly TColumn[] {
	return Object.freeze((columns ?? []).map((column) => Object.freeze({ ...column }) as TColumn));
}

function freezeStrings(values?: readonly string[] | null): readonly string[] {
	return values && values.length > 0 ? Object.freeze([...values]) : Object.freeze([]);
}

export function createServerSideGetRowsRequest(input: CreateServerSideGetRowsRequestInput): ServerSideGetRowsRequest {
	if (!Number.isInteger(input.startRow) || input.startRow < 0) {
		throw new Error(`Invalid server-side request startRow: ${input.startRow}`);
	}
	if (!Number.isInteger(input.endRow) || input.endRow < input.startRow) {
		throw new Error(`Invalid server-side request endRow: ${input.endRow}`);
	}

	const route = normalizeServerSideRoute(input.route);
	const groupKeys = freezeStrings(input.groupKeys ?? route);

	return Object.freeze({
		startRow: input.startRow,
		endRow: input.endRow,
		route,
		groupKeys,
		rowGroupColumns: freezeColumnMetadata(input.rowGroupColumns),
		valueColumns: freezeColumnMetadata(input.valueColumns),
		sortModel: input.sortModel ?? null,
		filterModel: input.filterModel ?? null,
		quickFilterModel: input.quickFilterModel ?? null,
		queryModel: input.queryModel ?? null,
	});
}

export interface ServerSideGetRowsResult<TRowData> {
	readonly rows: readonly TRowData[];
	readonly rowCount?: number;
	readonly lastRow?: number;
	readonly hasMore?: boolean;
	readonly aggregateData?: Readonly<Record<string, unknown>>;
	readonly groupMetadata?: readonly ServerSideGroupMetadata[];
}

export type ServerSideRowCountState =
	| { readonly kind: 'unknown' }
	| { readonly kind: 'estimated'; readonly count: number }
	| { readonly kind: 'known'; readonly count: number };

export interface ResolveServerSideRowCountStateInput {
	readonly startRow: number;
	readonly endRow: number;
	readonly returnedRowCount: number;
	readonly rowCount?: number;
	readonly lastRow?: number;
	readonly hasMore?: boolean;
}

function assertNonNegativeInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`Server-side datasource returned invalid ${label} ${value}`);
	}
}

export function resolveServerSideRowCountState(input: ResolveServerSideRowCountStateInput): ServerSideRowCountState {
	if (!Number.isInteger(input.startRow) || input.startRow < 0) {
		throw new Error(`Invalid server-side request startRow: ${input.startRow}`);
	}
	if (!Number.isInteger(input.endRow) || input.endRow < input.startRow) {
		throw new Error(`Invalid server-side request endRow: ${input.endRow}`);
	}
	if (!Number.isInteger(input.returnedRowCount) || input.returnedRowCount < 0) {
		throw new Error(`Server-side datasource returned invalid row count ${input.returnedRowCount}`);
	}

	const requestedRowCount = input.endRow - input.startRow;
	if (input.returnedRowCount > requestedRowCount) {
		throw new Error(
			`Server-side datasource returned ${input.returnedRowCount} rows for requested range ${input.startRow}-${input.endRow - 1}`
		);
	}

	const minimumReachableCount = input.startRow + input.returnedRowCount;

	if (typeof input.rowCount === 'number') {
		assertNonNegativeInteger(input.rowCount, 'rowCount');
		if (input.rowCount < minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned rowCount ${input.rowCount}, which is smaller than the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (typeof input.lastRow === 'number') {
		assertNonNegativeInteger(input.lastRow, 'lastRow');
		if (input.lastRow < minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned lastRow ${input.lastRow}, which is smaller than the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (
		typeof input.rowCount === 'number' &&
		typeof input.lastRow === 'number' &&
		input.rowCount !== input.lastRow
	) {
		throw new Error(
			`Server-side datasource returned conflicting rowCount ${input.rowCount} and lastRow ${input.lastRow}`
		);
	}

	if (input.hasMore === false) {
		if (typeof input.rowCount === 'number' && input.rowCount !== minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned hasMore false but rowCount ${input.rowCount} does not match the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
		if (typeof input.lastRow === 'number' && input.lastRow !== minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned hasMore false but lastRow ${input.lastRow} does not match the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
		return Object.freeze({ kind: 'known', count: minimumReachableCount });
	}

	if (input.hasMore === true) {
		if (typeof input.rowCount === 'number' && input.rowCount <= minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned hasMore true but rowCount ${input.rowCount} leaves no rows beyond the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
		if (typeof input.lastRow === 'number' && input.lastRow <= minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned hasMore true but lastRow ${input.lastRow} leaves no rows beyond the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}

	if (input.returnedRowCount < requestedRowCount) {
		if (typeof input.rowCount === 'number' && input.rowCount > minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned ${input.returnedRowCount} rows for range ${input.startRow}-${input.endRow - 1} but rowCount ${input.rowCount} still requires rows within that range`
			);
		}
		if (typeof input.lastRow === 'number' && input.lastRow > minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned ${input.returnedRowCount} rows for range ${input.startRow}-${input.endRow - 1} but lastRow ${input.lastRow} still requires rows within that range`
			);
		}
		if (input.hasMore === true) {
			throw new Error(
				`Server-side datasource returned ${input.returnedRowCount} rows for range ${input.startRow}-${input.endRow - 1} but hasMore true still requires rows within that range`
			);
		}
		return Object.freeze({ kind: 'known', count: minimumReachableCount });
	}

	if (typeof input.rowCount === 'number') return Object.freeze({ kind: 'known', count: input.rowCount });
	if (typeof input.lastRow === 'number') return Object.freeze({ kind: 'known', count: input.lastRow });
	if (input.hasMore === true) return Object.freeze({ kind: 'estimated', count: minimumReachableCount + 1 });
	if (minimumReachableCount > 0) return Object.freeze({ kind: 'estimated', count: minimumReachableCount });
	return Object.freeze({ kind: 'unknown' });
}

export interface ServerSideDatasource<TRowData = unknown> {
	getRows(
		request: ServerSideGetRowsRequest,
		context: {
			signal?: AbortSignal;
		}
	): Promise<ServerSideGetRowsResult<TRowData>>;
}

export type ServerSideBlockState =
	| 'absent'
	| 'queued'
	| 'loadingInitial'
	| 'loaded'
	| 'refreshing'
	| 'failedInitial'
	| 'failedRefresh'
	| 'stale';

export interface ServerSideRefreshOptions {
	readonly route?: ServerSideRoute;
	readonly purge?: boolean;
}

export interface ServerSideStoreSnapshot {
	readonly storeId: string;
	readonly route: ServerSideRoute;
	readonly level: number;
	readonly rowCountState: ServerSideRowCountState;
	readonly blockCount: number;
	readonly loadingBlockCount: number;
	readonly failedBlockCount: number;
	readonly childStoreCount: number;
}

export interface ServerSideBlockSnapshot {
	readonly storeId: string;
	readonly blockIndex: number;
	readonly startRow: number;
	readonly endRow: number;
	readonly state: ServerSideBlockState;
	readonly committedRowCount: number;
	readonly requestId?: number;
	readonly queryGeneration: number;
	readonly lastAccessedAt: number;
	readonly error?: string;
}

export interface ServerSideRowModelOptions<TRowData = unknown> {
	readonly datasource: ServerSideDatasource<TRowData>;
	readonly blockSize?: number;
	readonly maxBlocksInCache?: number;
	readonly maxConcurrentRequests?: number;
	readonly prefetchBlockCount?: number;
}
