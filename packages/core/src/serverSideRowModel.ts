import type { AggregationDef, FilterModel, QuickFilterModel, SortModel } from './rowModel.js';
import type { GridQueryModel } from './query/GridQueryModel.js';

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

export interface ServerSideGetRowsResult<TRowData> {
	readonly rows: readonly TRowData[];
	readonly rowCount?: number;
	readonly lastRow?: number;
	readonly hasMore?: boolean;
	readonly aggregateData?: Readonly<Record<string, unknown>>;
	readonly groupMetadata?: readonly ServerSideGroupMetadata[];
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
	readonly rowCountState:
		| { readonly kind: 'unknown' }
		| { readonly kind: 'estimated'; readonly count: number }
		| { readonly kind: 'known'; readonly count: number };
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
