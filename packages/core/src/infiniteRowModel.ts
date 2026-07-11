import { type ColumnDef, setValueByPath } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { InfiniteRowModelRuntime } from './engine/runtimePorts.js';
import type {
	DataRowCountModel,
	RowModel,
	RowRefreshReason,
	RowModelRefreshResult,
	RowModelWriteResult,
	SelectableDataRowModel,
	InfiniteControllableRowModel,
	AnyModelCellWritable,
	VisibleBlockLoadCapableRowModel,
	CapableRowModel,
	RowModelCapabilities,
	RowCountKind,
	RowLoadState,
	RowRangeLoadState,
	RowModelRequestToken,
	RowModelQueryState,
} from './rowModel.js';
import type { RowSelectionScope } from './api/GridApi.js';
import { RowNode } from './rowNode.js';
import { toDataVisualRowId, toFailedVisualRowId, toLoadingVisualRowId } from './rows/visualRowIds.js';
import type { VisualRow } from './visualRow.js';

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error.length > 0) return error;
	return 'Unknown infinite block load failure';
}

function validateInfiniteBlockResponse<TRowData>(
	rows: readonly TRowData[],
	blockSize: number,
	getRowId: (row: TRowData) => string,
	options?: { totalCount?: number; lastRow?: number; hasMore?: boolean; blockStartRow?: number }
): void {
	if (rows.length > blockSize) {
		throw new Error(`Infinite datasource returned ${rows.length} rows for block size ${blockSize}`);
	}

	if (typeof options?.totalCount === 'number') {
		if (options.totalCount < 0) {
			throw new Error(`Infinite datasource returned negative totalCount ${options.totalCount}`);
		}
		const blockStartRow = options.blockStartRow ?? 0;
		const minimumReachableCount = blockStartRow + rows.length;
		if (options.totalCount < minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned totalCount ${options.totalCount}, which is smaller than the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (typeof options?.lastRow === 'number') {
		if (options.lastRow < 0) {
			throw new Error(`Infinite datasource returned negative lastRow ${options.lastRow}`);
		}
		const blockStartRow = options.blockStartRow ?? 0;
		const minimumReachableCount = blockStartRow + rows.length;
		if (options.lastRow < minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned lastRow ${options.lastRow}, which is smaller than the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (
		typeof options?.totalCount === 'number' &&
		typeof options?.lastRow === 'number' &&
		options.totalCount !== options.lastRow
	) {
		throw new Error(
			`Infinite datasource returned conflicting totalCount ${options.totalCount} and lastRow ${options.lastRow}`
		);
	}

	const seenRowIds = new Set<string>();
	for (const row of rows) {
		const rowId = getRowId(row);
		if (seenRowIds.has(rowId)) {
			throw new Error(`Infinite datasource returned duplicate row id "${rowId}" within one block`);
		}
		seenRowIds.add(rowId);
	}
}

function resolveInfiniteTerminalCount(options: {
	totalCount?: number;
	lastRow?: number;
	hasMore?: boolean;
	blockStartRow: number;
	returnedRowCount: number;
}): number | undefined {
	if (typeof options.totalCount === 'number') return options.totalCount;
	if (typeof options.lastRow === 'number') return options.lastRow;
	if (options.hasMore === false) return options.blockStartRow + options.returnedRowCount;
	return undefined;
}

export interface InfiniteGetRowsParams {
	readonly startRow: number;
	readonly endRow: number;
	readonly sortModel: unknown;
	readonly filterModel: unknown;
	/** QuickFilterModel | null — a single search string to match across multiple columns server-side. */
	readonly quickFilterModel: unknown;
	readonly queryModel: unknown;
}

export interface InfiniteDatasource<TRowData = unknown> {
	getRows(params: InfiniteGetRowsParams): Promise<{ rows: TRowData[]; totalCount?: number; lastRow?: number; hasMore?: boolean }>;
}

export interface InfiniteRowModelOptions<TData = unknown> {
	blockSize?: number;
	maxBlocksInCache?: number;
	datasource: InfiniteDatasource<TData>;
	columns: Array<ColumnDef<TData>>;
	getRowId?: (row: TData) => string;
}

const INFINITE_CAPABILITIES: RowModelCapabilities = {
	fullDataset: false,
	loadedDataset: true,
	pagedDataset: false,
	clientMutation: false,
	loadedRowMutation: true,
	pageRowMutation: false,
	transactions: false,
	rowOrder: false,
	blockLoading: true,
	serverPagination: false,
	clientSort: false,
	clientFilter: false,
	serverSort: true,
	serverFilter: true,
	clientGrouping: false,
	clientTree: false,
	aggregation: false,
	masterDetail: false,
	allRowSelection: false,
	loadedRowSelection: true,
	pageRowSelection: false,
};

type InfiniteBlockStatus = 'empty' | 'loading' | 'loaded' | 'failed' | 'stale';

class InfiniteBlock<TData = unknown> {
	public readonly blockIndex: number;
	public readonly startRow: number;
	public readonly endRow: number;
	public status: InfiniteBlockStatus = 'empty';
	public rows: Array<RowNode<TData> | null>;
	public error: string | null = null;
	public requestId = 0;
	public queryVersion = 0;
	public loadedAt: number | null = null;
	public lastAccessedAt: number;

	constructor(blockIndex: number, blockSize: number) {
		this.blockIndex = blockIndex;
		this.startRow = blockIndex * blockSize;
		this.endRow = this.startRow + blockSize - 1;
		this.rows = Array.from({ length: blockSize }, () => null);
		this.lastAccessedAt = InfiniteBlockCache.now();
	}
}

class InfiniteBlockCache<TData = unknown> {
	private readonly blocks = new Map<number, InfiniteBlock<TData>>();
	private knownRowCount: number | null = null;
	private estimatedRowCount = 0;

	public static now(): number {
		return typeof performance !== 'undefined' ? performance.now() : Date.now();
	}

	public reset(): void {
		this.blocks.clear();
		this.knownRowCount = null;
		this.estimatedRowCount = 0;
	}

	public getBlock(blockIndex: number): InfiniteBlock<TData> | null {
		const block = this.blocks.get(blockIndex) ?? null;
		if (block) block.lastAccessedAt = InfiniteBlockCache.now();
		return block;
	}

	public getBlockForRow(rowIndex: number, blockSize: number): InfiniteBlock<TData> | null {
		if (rowIndex < 0) return null;
		return this.getBlock(Math.floor(rowIndex / blockSize));
	}

	public beginLoad(blockIndex: number, blockSize: number, requestId: number, queryVersion: number): InfiniteBlock<TData> {
		const block = this.ensureBlock(blockIndex, blockSize);
		const hasCommittedRows = this.hasCommittedRows(block);
		if (block.status === 'loaded' || block.status === 'failed') {
			block.status = 'stale';
		}
		block.status = 'loading';
		block.error = null;
		block.requestId = requestId;
		block.queryVersion = queryVersion;
		block.loadedAt = null;
		if (!hasCommittedRows) {
			block.rows = Array.from({ length: block.rows.length }, () => null);
		}
		block.lastAccessedAt = InfiniteBlockCache.now();
		return block;
	}

	public markLoaded(
		blockIndex: number,
		blockSize: number,
		requestId: number,
		queryVersion: number,
		rows: Array<RowNode<TData> | null>,
		returnedRowCount: number,
		totalCount?: number,
		options?: { canInferTerminalFromShortBlock?: boolean }
	): InfiniteBlock<TData> {
		const block = this.ensureBlock(blockIndex, blockSize);
		block.status = 'loaded';
		block.error = null;
		block.requestId = requestId;
		block.queryVersion = queryVersion;
		block.rows = rows;
		block.loadedAt = InfiniteBlockCache.now();
		block.lastAccessedAt = block.loadedAt;
		if (typeof totalCount === 'number') {
			this.knownRowCount = Math.max(0, totalCount);
			this.estimatedRowCount = Math.max(this.estimatedRowCount, this.knownRowCount);
			this.trimCommittedRowsToKnownCount();
		} else if (returnedRowCount < blockSize && options?.canInferTerminalFromShortBlock !== false) {
			this.knownRowCount = Math.max(0, block.startRow + returnedRowCount);
			this.estimatedRowCount = Math.max(this.estimatedRowCount, this.knownRowCount);
			this.trimCommittedRowsToKnownCount();
		} else {
			const provisionalReachableCount = block.startRow + returnedRowCount + blockSize;
			this.estimatedRowCount = Math.max(this.estimatedRowCount, provisionalReachableCount);
		}
		return block;
	}

	public markFailed(blockIndex: number, blockSize: number, requestId: number, queryVersion: number, error: string): InfiniteBlock<TData> {
		const block = this.ensureBlock(blockIndex, blockSize);
		const hasCommittedRows = this.hasCommittedRows(block);
		block.status = 'failed';
		block.error = error;
		block.requestId = requestId;
		block.queryVersion = queryVersion;
		if (!hasCommittedRows) {
			block.rows = Array.from({ length: block.rows.length }, () => null);
		}
		block.loadedAt = null;
		block.lastAccessedAt = InfiniteBlockCache.now();
		return block;
	}

	public isBlockLoaded(blockIndex: number): boolean {
		return this.blocks.get(blockIndex)?.status === 'loaded';
	}

	public isBlockLoading(blockIndex: number): boolean {
		return this.blocks.get(blockIndex)?.status === 'loading';
	}

	public getLoadingBlockCount(): number {
		let count = 0;
		for (const block of this.blocks.values()) {
			if (block.status === 'loading') count++;
		}
		return count;
	}

	public evictOverflow(maxBlocksInCache: number, protectedBlockIndexes: ReadonlySet<number>): boolean {
		if (maxBlocksInCache < 1 || this.blocks.size <= maxBlocksInCache) return false;

		let changed = false;
		const candidates = Array.from(this.blocks.values())
			.filter((block) => block.status !== 'loading' && !protectedBlockIndexes.has(block.blockIndex))
			.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);

		for (const candidate of candidates) {
			if (this.blocks.size <= maxBlocksInCache) break;
			changed = this.blocks.delete(candidate.blockIndex) || changed;
		}

		return changed;
	}

	public getKnownRowCount(): number | null {
		return this.knownRowCount;
	}

	public getEstimatedRowCount(): number {
		return this.knownRowCount ?? this.estimatedRowCount;
	}

	public getRowCountKind(): RowCountKind {
		if (this.knownRowCount !== null) return 'known';
		return this.estimatedRowCount > 0 ? 'estimated' : 'unknown';
	}

	public getVisualRowCount(): number {
		return this.knownRowCount ?? this.estimatedRowCount;
	}

	public getSelectableRowNodes(): RowNode<TData>[] {
		const nodes: RowNode<TData>[] = [];
		const orderedBlocks = Array.from(this.blocks.values()).sort((a, b) => a.blockIndex - b.blockIndex);
		for (const block of orderedBlocks) {
			if (!this.hasCommittedRows(block)) continue;
			for (const node of block.rows) {
				if (node) nodes.push(node);
			}
		}
		return nodes;
	}

	public getCommittedRow(index: number, blockSize: number): RowNode<TData> | null {
		const block = this.getBlockForRow(index, blockSize);
		if (!block) return null;
		return block.rows[index - block.startRow] ?? null;
	}

	public resolveRowLoadState(index: number, blockSize: number): RowLoadState {
		if (index < 0) return { kind: 'missing' };
		const block = this.getBlockForRow(index, blockSize);
		if (!block) {
			return index < this.getVisualRowCount() ? { kind: 'loading', reason: 'infinite-block' } : { kind: 'missing' };
		}
		const localIndex = index - block.startRow;
		switch (block.status) {
			case 'loading':
			case 'stale':
			case 'empty':
				return index < this.getVisualRowCount() ? { kind: 'loading', reason: 'infinite-block' } : { kind: 'missing' };
			case 'failed':
				return { kind: 'failed', error: block.error ?? 'Unknown infinite block load failure', retryable: true };
			case 'loaded':
				return block.rows[localIndex] ? { kind: 'loaded', rowId: block.rows[localIndex]!.id } : { kind: 'missing' };
		}
	}

	private hasCommittedRows(block: InfiniteBlock<TData>): boolean {
		return block.rows.some((node) => node !== null);
	}

	private trimCommittedRowsToKnownCount(): void {
		if (this.knownRowCount === null) return;

		for (const [blockIndex, block] of this.blocks.entries()) {
			if (block.startRow >= this.knownRowCount) {
				this.blocks.delete(blockIndex);
				continue;
			}
			if (block.endRow < this.knownRowCount) continue;
			const firstOutOfRangeIndex = Math.max(0, this.knownRowCount - block.startRow);
			for (let localIndex = firstOutOfRangeIndex; localIndex < block.rows.length; localIndex++) {
				block.rows[localIndex] = null;
			}
		}
	}

	private ensureBlock(blockIndex: number, blockSize: number): InfiniteBlock<TData> {
		const existing = this.blocks.get(blockIndex);
		if (existing) return existing;
		const created = new InfiniteBlock<TData>(blockIndex, blockSize);
		this.blocks.set(blockIndex, created);
		return created;
	}
}

export class InfiniteRowModelController<TData = unknown>
	implements
		RowModel<TData>,
		DataRowCountModel,
		SelectableDataRowModel,
		InfiniteControllableRowModel<TData>,
		AnyModelCellWritable<TData>,
		VisibleBlockLoadCapableRowModel,
		CapableRowModel
{
	private readonly runtime: InfiniteRowModelRuntime<TData>;
	private datasource: InfiniteDatasource<TData>;
	private blockSize: number;
	private readonly maxBlocksInCache: number | null;
	private nodeMap = new Map<string, RowNode<TData>>();
	private visualRowIdToIndex = new Map<string, number>();
	private rowIdToVisualIndex = new Map<string, number>();
	private readonly blockCache = new InfiniteBlockCache<TData>();
	private unsubscribers: Array<() => void> = [];
	private disposed = false;
	private datasourceGeneration = 0;
	private queryVersion = 0;
	private nextRequestId = 1;
	private pendingVisibleLoad: { startRow: number; endRow: number } | null = null;
	private latestVisibleBlocks = new Set<number>();

	constructor(runtime: InfiniteRowModelRuntime<TData>, options: InfiniteRowModelOptions<TData>) {
		this.runtime = runtime;
		this.datasource = options.datasource;
		this.blockSize = options.blockSize ?? 100;
		this.maxBlocksInCache = options.maxBlocksInCache ?? null;

		this.runtime.initializeModel({
			columns: options.columns,
			getRowId: options.getRowId,
		});

		this.runtime.registerRowModel(this);

		this.unsubscribers.push(
			this.runtime.addEventListener(GridEventName.sortChanged, () => this.invalidateQueryCache()),
			this.runtime.addEventListener(GridEventName.filterChanged, () => this.invalidateQueryCache()),
			this.runtime.addEventListener(GridEventName.quickFilterChanged, () => this.invalidateQueryCache()),
			this.runtime.addEventListener(GridEventName.queryModelChanged, () => this.invalidateQueryCache())
		);

		this.fetchBlock(0);
	}

	public setDatasource(datasource: InfiniteDatasource<TData>, blockSize: number = this.blockSize): void {
		this.datasource = datasource;
		this.blockSize = blockSize;
		this.bumpDatasourceGeneration();
		this.resetCacheAndRefetch();
	}

	public dispose(): void {
		this.disposed = true;
		this.bumpDatasourceGeneration();
		this.blockCache.reset();
		this.pendingVisibleLoad = null;
		this.latestVisibleBlocks.clear();
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	public getCapabilities(): RowModelCapabilities {
		return INFINITE_CAPABILITIES;
	}

	public getVisualRow = (rowIndex: number): VisualRow<TData> | null => {
		const committedNode = this.blockCache.getCommittedRow(rowIndex, this.blockSize);
		if (committedNode) {
			return {
				kind: 'data',
				id: toDataVisualRowId(committedNode.id),
				rowId: committedNode.id,
				node: committedNode,
				depth: 0,
			};
		}
		const state = this.getRowLoadState(rowIndex);
		if (state.kind === 'loaded') {
			const block = this.blockCache.getBlockForRow(rowIndex, this.blockSize);
			const node = block?.rows[rowIndex - (block?.startRow ?? 0)] ?? null;
			if (!node) return null;
			return {
				kind: 'data',
				id: toDataVisualRowId(node.id),
				rowId: node.id,
				node,
				depth: 0,
			};
		}
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

	public loadVisibleBlocks = (startRow: number, endRow: number): void => {
		this.loadBlockRange(startRow, endRow, false);
	};

	private loadBlockRange(startRow: number, endRow: number, forceReload: boolean): void {
		if (startRow > endRow) return;

		if (this.runtime.isScrollingFast()) {
			this.pendingVisibleLoad = { startRow, endRow };
			return;
		}

		// Flush any pending range accumulated during fast scroll.
		const effectiveStart = this.pendingVisibleLoad ? Math.min(startRow, this.pendingVisibleLoad.startRow) : startRow;
		const effectiveEnd = this.pendingVisibleLoad ? Math.max(endRow, this.pendingVisibleLoad.endRow) : endRow;
		this.pendingVisibleLoad = null;

		const minRow = Math.max(0, effectiveStart);
		const maxRepresentedRow = this.getVisualRowCount() > 0 ? Math.max(0, this.getVisualRowCount() - 1) : Math.max(0, effectiveEnd);
		const maxRow = Math.min(Math.max(0, effectiveEnd), maxRepresentedRow);
		if (minRow > maxRow) return;

		const visibleBlocks = new Set<number>();
		const minBlock = Math.floor(minRow / this.blockSize);
		const maxBlock = Math.floor(maxRow / this.blockSize);
		for (let blockIdx = minBlock; blockIdx <= maxBlock; blockIdx++) {
			visibleBlocks.add(blockIdx);
		}
		this.latestVisibleBlocks = new Set(visibleBlocks);

		const velocity = this.runtime.getScrollVelocity();
		const vy = velocity.vy;
		const totalBlocks = Math.ceil(this.getVisualRowCount() / this.blockSize);
		const requestedBlocks = new Set(visibleBlocks);

		if (vy > 0.1) {
			const ahead1 = maxBlock + 1;
			const ahead2 = maxBlock + 2;
			if (ahead1 < totalBlocks) requestedBlocks.add(ahead1);
			if (ahead2 < totalBlocks) requestedBlocks.add(ahead2);
		} else if (vy < -0.1) {
			const ahead1 = minBlock - 1;
			const ahead2 = minBlock - 2;
			if (ahead1 >= 0) requestedBlocks.add(ahead1);
			if (ahead2 >= 0) requestedBlocks.add(ahead2);
		}

		requestedBlocks.forEach((blockIdx) => {
			if (!forceReload && (this.blockCache.isBlockLoaded(blockIdx) || this.blockCache.isBlockLoading(blockIdx))) {
				return;
			}
			this.fetchBlock(blockIdx);
		});
	}

	public getRowNodeById = (rowId: string): RowNode<TData> | null => {
		return this.nodeMap.get(rowId) ?? null;
	};

	public getVisualRowCount = (): number => {
		return this.blockCache.getVisualRowCount();
	};

	public getKnownRowCount = (): number | null => {
		return this.blockCache.getKnownRowCount();
	};

	public getEstimatedRowCount = (): number => {
		return this.blockCache.getEstimatedRowCount();
	};

	public getRowCountKind = (): RowCountKind => {
		return this.blockCache.getRowCountKind();
	};

	public getDataRowCount = (): number => {
		return this.blockCache.getVisualRowCount();
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
		return this.blockCache.resolveRowLoadState(index, this.blockSize);
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
		this.loadBlockRange(startRow, endRow, this.isRetryReason(reason));
	};

	public getSelectableDataRowIds = (scope: RowSelectionScope = 'loaded'): string[] => {
		if (scope === 'all' || scope === 'filtered') return [];
		// Infinite rows have no page concept. Treat `page` as the currently loaded cache window.
		return this.blockCache.getSelectableRowNodes().map((node) => node.id);
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

		// Purge server cache if the edited field is part of server sort or filter —
		// the loaded blocks reflect a sort/filter order that is now stale.
		const state = this.runtime.getState();
		const affectsServerOrder =
			(state.sortModel?.some((s) => s.colId === colField) ?? false) || (state.filterModel != null && colField in state.filterModel);
		if (affectsServerOrder) this.purgeCache();

		const changedFieldsByRow = new Map<string, Set<string>>();
		changedFieldsByRow.set(rowId, new Set([colField]));
		return { updatedNodes: [node], changedFieldsByRow, visualChange: 'none' };
	};

	private fetchBlock = async (blockIndex: number): Promise<void> => {
		if (this.disposed) return;
		const requestId = this.nextRequestId++;
		const queryState = this.getQueryState();
		const block = this.blockCache.beginLoad(blockIndex, this.blockSize, requestId, queryState.queryVersion);
		const requestStartedAt = InfiniteBlockCache.now();
		const previousRowCount = this.blockCache.getVisualRowCount();

		if (blockIndex === 0) this.runtime.setLoadingState(true);

		const startRow = block.startRow;
		const endRow = block.endRow + 1;
		const requestToken = this.createBlockRequestToken(blockIndex, startRow, endRow, requestId);

		const state = this.runtime.getState();

		try {
			const response = await this.datasource.getRows({
				startRow,
				endRow,
				sortModel: state.sortModel,
				filterModel: state.filterModel,
				quickFilterModel: state.quickFilterModel,
				queryModel: state.queryModel,
			});

			if (!this.isRequestTokenCurrent(requestToken)) return;
			validateInfiniteBlockResponse(response.rows, this.blockSize, (row) => this.runtime.getRowId(row as TData), {
				totalCount: response.totalCount,
				lastRow: response.lastRow,
				hasMore: response.hasMore,
				blockStartRow: startRow,
			});
			this.validateInfiniteBlockPlacement(response.rows, block.startRow, block.endRow);
			const terminalCount = resolveInfiniteTerminalCount({
				totalCount: response.totalCount,
				lastRow: response.lastRow,
				hasMore: response.hasMore,
				blockStartRow: startRow,
				returnedRowCount: response.rows.length,
			});
			const canInferTerminalFromShortBlock = response.hasMore !== true;

			const blockRows = Array.from({ length: this.blockSize }, () => null as RowNode<TData> | null);
			response.rows.forEach((row, idx) => {
				const typedRow = row as TData;
				if (!typedRow) return;
				const id = this.runtime.getRowId(typedRow);
				const existing = this.nodeMap.get(id);
				if (existing) {
					existing.setData(typedRow);
					blockRows[idx] = existing;
					return;
				}
				blockRows[idx] = new RowNode<TData>(id, typedRow);
			});

			this.blockCache.markLoaded(
				blockIndex,
				this.blockSize,
				requestToken.requestId,
				requestToken.queryVersion,
				blockRows,
				response.rows.length,
				terminalCount,
				{ canInferTerminalFromShortBlock }
			);
			this.evictOverflowBlocks();
			this.rebuildBlockDerivedIndexes();
			this.publishBlockRefresh(block, previousRowCount, 'rows:infinite-block-loaded');

			this.runtime.clearFormulas();
			this.runtime.setLoadingState(this.blockCache.getLoadingBlockCount() > 0);

			const requestFinishedAt = InfiniteBlockCache.now();
			this.runtime.dispatchInfiniteBlockLoaded({
				blockIndex,
				loadedBlockStart: startRow,
				loadedBlockEnd: startRow + response.rows.length - 1,
				totalRecords: terminalCount ?? this.blockCache.getVisualRowCount(),
				durationMs: requestFinishedAt - requestStartedAt,
			});
		} catch (error) {
			if (!this.isRequestTokenCurrent(requestToken)) return;
			const message = toErrorMessage(error);
			this.blockCache.markFailed(blockIndex, this.blockSize, requestToken.requestId, requestToken.queryVersion, message);
			this.evictOverflowBlocks();
			this.rebuildBlockDerivedIndexes();
			this.publishBlockRefresh(block, previousRowCount, 'rows:infinite-block-load-failed');
			this.runtime.dispatchInfiniteBlockLoadFailed({
				blockIndex,
				startRow,
				endRow: endRow - 1,
				message,
			});
			this.runtime.reportBlockLoadFailure(blockIndex, error);
			this.runtime.setLoadingState(this.blockCache.getLoadingBlockCount() > 0);
		}
	};

	public purgeCache = (): void => {
		this.invalidateQueryCache();
	};

	public refresh(_reason?: RowRefreshReason): RowModelRefreshResult {
		this.purgeCache();
		return { changed: true };
	}

	private getQueryState(): RowModelQueryState {
		return {
			datasourceGeneration: this.datasourceGeneration,
			queryVersion: this.queryVersion,
		};
	}

	private createBlockRequestToken(blockIndex: number, startRow: number, endRow: number, requestId: number): RowModelRequestToken {
		const queryState = this.getQueryState();
		return {
			kind: 'infinite-block',
			datasourceGeneration: queryState.datasourceGeneration,
			queryVersion: queryState.queryVersion,
			requestId,
			blockIndex,
			startRow,
			endRow,
		};
	}

	private isRequestTokenCurrent(token: RowModelRequestToken): boolean {
		if (this.disposed) return false;
		if (token.kind !== 'infinite-block') return false;
		const block = this.blockCache.getBlock(token.blockIndex ?? -1);
		if (!block) return false;
		return (
			token.datasourceGeneration === this.datasourceGeneration &&
			token.queryVersion === this.queryVersion &&
			token.requestId === block.requestId &&
			token.queryVersion === block.queryVersion
		);
	}

	private bumpDatasourceGeneration(): void {
		this.datasourceGeneration++;
	}

	private invalidateQueryCache(): void {
		this.queryVersion++;
		this.resetCacheAndRefetch();
	}

	private resetCacheAndRefetch(): void {
		if (this.disposed) return;
		this.blockCache.reset();
		this.nodeMap.clear();
		this.visualRowIdToIndex.clear();
		this.rowIdToVisualIndex.clear();
		this.pendingVisibleLoad = null;
		this.latestVisibleBlocks.clear();
		this.runtime.clearFormulas();
		this.runtime.setLoadingState(true);
		this.fetchBlock(0);
	}

	private evictOverflowBlocks(): void {
		if (this.maxBlocksInCache === null) return;
		this.blockCache.evictOverflow(this.maxBlocksInCache, this.latestVisibleBlocks);
	}

	private rebuildBlockDerivedIndexes(): void {
		this.nodeMap.clear();
		this.visualRowIdToIndex.clear();
		this.rowIdToVisualIndex.clear();
		for (const node of this.blockCache.getSelectableRowNodes()) {
			const visualIndex = this.findVisualIndexForRowId(node.id);
			if (visualIndex < 0) continue;
			this.nodeMap.set(node.id, node);
			this.rowIdToVisualIndex.set(node.id, visualIndex);
			this.visualRowIdToIndex.set(toDataVisualRowId(node.id), visualIndex);
		}
	}

	private findVisualIndexForRowId(rowId: string): number {
		const rowCount = this.blockCache.getVisualRowCount();
		for (let index = 0; index < rowCount; index++) {
			const block = this.blockCache.getBlockForRow(index, this.blockSize);
			if (!block) continue;
			const node = block.rows[index - block.startRow];
			if (node?.id === rowId) return index;
		}
		return -1;
	}

	private isRetryReason(reason?: string): boolean {
		return reason === 'row-node-retry-load' || reason === 'retry' || reason === 'force-reload';
	}

	private validateInfiniteBlockPlacement(rows: readonly TData[], blockStartRow: number, blockEndRow: number): void {
		rows.forEach((row, index) => {
			const rowId = this.runtime.getRowId(row);
			const existingVisualIndex = this.rowIdToVisualIndex.get(rowId);
			const nextVisualIndex = blockStartRow + index;
			if (
				existingVisualIndex !== undefined &&
				existingVisualIndex !== nextVisualIndex &&
				(existingVisualIndex < blockStartRow || existingVisualIndex > blockEndRow)
			) {
				throw new Error(
					`Infinite datasource returned row id "${rowId}" for visual index ${nextVisualIndex}, but that row id is already committed at visual index ${existingVisualIndex}`
				);
			}
		});
	}

	private publishBlockRefresh(
		block: InfiniteBlock<TData>,
		previousRowCount: number,
		requestRenderReason: 'rows:infinite-block-loaded' | 'rows:infinite-block-load-failed'
	): void {
		const nextRowCount = this.blockCache.getVisualRowCount();
		const maxVisibleIndex = nextRowCount > 0 ? nextRowCount - 1 : block.endRow;
		this.runtime.applyRefreshInvalidation(
			{
				changed: true,
				reason: 'refresh',
				previousRowCount,
				nextRowCount,
				changedStartIndex: block.startRow,
				changedEndIndex: Math.max(block.startRow, Math.min(block.endRow, maxVisibleIndex)),
			},
			{
				invalidationReason: 'viewport',
				requestRenderReason,
			}
		);
	}
}
