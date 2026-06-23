import { type ColumnDef, setValueByPath } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { InfiniteRowModelRuntime } from './engine/runtimePorts.js';
import type {
	CellValueWritableRowModel,
	DataRowCountModel,
	RowModel,
	RowRefreshReason,
	RowModelRefreshResult,
	SelectableDataRowModel,
	InfiniteControllableRowModel,
	VisibleBlockLoadCapableRowModel,
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
	return 'Unknown infinite block load failure';
}

export interface InfiniteGetRowsParams {
	readonly startRow: number;
	readonly endRow: number;
	readonly sortModel: unknown;
	readonly filterModel: unknown;
	readonly queryModel: unknown;
}

export interface InfiniteDatasource<TRowData = unknown> {
	getRows(params: InfiniteGetRowsParams): Promise<{ rows: TRowData[]; totalCount?: number }>;
}

export interface InfiniteRowModelOptions<TData = unknown> {
	blockSize?: number;
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

export class InfiniteRowModelController<TData = unknown>
	implements
		RowModel<TData>,
		DataRowCountModel,
		SelectableDataRowModel,
		InfiniteControllableRowModel<TData>,
		CellValueWritableRowModel<TData>,
		VisibleBlockLoadCapableRowModel,
		CapableRowModel
{
	private readonly runtime: InfiniteRowModelRuntime<TData>;
	private datasource: InfiniteDatasource<TData>;
	private blockSize: number;
	private activeNodes: Array<RowNode<TData> | null> = [];
	private visualRows: Array<VisualRow<TData> | null> = [];
	private nodeMap = new Map<string, RowNode<TData>>();
	private visualRowIdToIndex = new Map<string, number>();
	private rowIdToVisualIndex = new Map<string, number>();
	private loadingBlocks: Record<number, boolean> = {};
	private loadingBlockCount = 0;
	private unsubscribers: Array<() => void> = [];
	private disposed = false;
	private requestGeneration = 0;
	private pendingVisibleLoad: { startRow: number; endRow: number } | null = null;

	constructor(runtime: InfiniteRowModelRuntime<TData>, options: InfiniteRowModelOptions<TData>) {
		this.runtime = runtime;
		this.datasource = options.datasource;
		this.blockSize = options.blockSize ?? 100;

		this.runtime.initializeModel({
			columns: options.columns,
			getRowId: options.getRowId,
		});

		this.runtime.registerRowModel(this);

		this.unsubscribers.push(
			this.runtime.addEventListener(GridEventName.sortChanged, () => this.purgeCache()),
			this.runtime.addEventListener(GridEventName.filterChanged, () => this.purgeCache())
		);

		this.fetchBlock(0);
	}

	public setDatasource(datasource: InfiniteDatasource<TData>, blockSize: number = this.blockSize): void {
		this.datasource = datasource;
		this.blockSize = blockSize;
		this.purgeCache();
	}

	public dispose(): void {
		this.disposed = true;
		this.requestGeneration++;
		this.loadingBlocks = {};
		this.loadingBlockCount = 0;
		this.pendingVisibleLoad = null;
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	public getCapabilities(): RowModelCapabilities {
		return INFINITE_CAPABILITIES;
	}

	public getVisualRow = (rowIndex: number): VisualRow<TData> | null => {
		const row = this.visualRows[rowIndex];
		if (row) return row;
		if (rowIndex >= 0 && rowIndex < this.getVisualRowCount()) {
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
		const maxRow = Math.min(Math.max(0, effectiveEnd), Math.max(0, this.getVisualRowCount() - 1));
		if (minRow > maxRow) return;

		const visibleBlocks = new Set<number>();
		const minBlock = Math.floor(minRow / this.blockSize);
		const maxBlock = Math.floor(maxRow / this.blockSize);
		for (let blockIdx = minBlock; blockIdx <= maxBlock; blockIdx++) {
			visibleBlocks.add(blockIdx);
		}

		const velocity = this.runtime.getScrollVelocity();
		const vy = velocity.vy;
		const totalBlocks = Math.ceil(this.getVisualRowCount() / this.blockSize);

		if (vy > 0.1) {
			const ahead1 = maxBlock + 1;
			const ahead2 = maxBlock + 2;
			if (ahead1 < totalBlocks) visibleBlocks.add(ahead1);
			if (ahead2 < totalBlocks) visibleBlocks.add(ahead2);
		} else if (vy < -0.1) {
			const ahead1 = minBlock - 1;
			const ahead2 = minBlock - 2;
			if (ahead1 >= 0) visibleBlocks.add(ahead1);
			if (ahead2 >= 0) visibleBlocks.add(ahead2);
		}

		visibleBlocks.forEach((blockIdx) => {
			const blockStartRow = blockIdx * this.blockSize;
			const isAlreadyLoaded = this.activeNodes[blockStartRow] !== undefined && this.activeNodes[blockStartRow] !== null;
			if (!isAlreadyLoaded && !this.loadingBlocks[blockIdx]) {
				this.fetchBlock(blockIdx);
			}
		});
	};

	public getRowNodeById = (rowId: string): RowNode<TData> | null => {
		return this.nodeMap.get(rowId) ?? null;
	};

	public getVisualRowCount = (): number => {
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
		const ids: string[] = [];
		for (const node of this.activeNodes) {
			if (node) ids.push(node.id);
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
			const result = col.valueSetter({ value, oldValue, row: updatedRow, colField, abort: () => {} });
			if (!(result instanceof Promise) && !result) return false;
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.setData(updatedRow);

		const state = this.runtime.getState();
		let needsPurge = false;
		if (state.sortModel && state.sortModel.some((s) => s.colId === colField)) {
			needsPurge = true;
		} else if (state.filterModel && state.filterModel[colField] !== undefined) {
			needsPurge = true;
		}

		if (needsPurge) this.purgeCache();
		return true;
	};

	private fetchBlock = async (blockIndex: number): Promise<void> => {
		if (this.disposed) return;
		if (this.loadingBlocks[blockIndex]) return;

		this.loadingBlocks[blockIndex] = true;
		this.loadingBlockCount++;
		const generation = this.requestGeneration;
		const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

		if (blockIndex === 0) this.runtime.setLoadingState(true);

		const startRow = blockIndex * this.blockSize;
		const endRow = startRow + this.blockSize;

		const state = this.runtime.getState();

		try {
			const response = await this.datasource.getRows({
				startRow,
				endRow,
				sortModel: state.sortModel,
				filterModel: state.filterModel,
				queryModel: state.queryModel,
			});

			if (this.disposed || generation !== this.requestGeneration) return;

			delete this.loadingBlocks[blockIndex];

			if (this.activeNodes.length < startRow) this.activeNodes.length = startRow;
			if (this.visualRows.length < startRow) this.visualRows.length = startRow;

			// Clear stale row IDs for this block range before inserting new rows.
			this.clearBlockRange(startRow, startRow + this.blockSize);

			response.rows.forEach((row, idx) => {
				const localIdx = startRow + idx;
				const typedRow = row as TData;
				if (typedRow) {
					const id = this.runtime.getRowId(typedRow);
					let node = this.nodeMap.get(id);
					if (node) {
						node.setData(typedRow);
					} else {
						node = new RowNode<TData>(id, typedRow);
					}
					this.activeNodes[localIdx] = node;
					this.visualRows[localIdx] = {
						kind: 'data',
						id: toDataVisualRowId(node.id),
						rowId: node.id,
						node,
						depth: 0,
					};
					this.nodeMap.set(id, node);
					this.visualRowIdToIndex.set(toDataVisualRowId(id), localIdx);
					this.rowIdToVisualIndex.set(id, localIdx);
				} else {
					this.activeNodes[localIdx] = null;
					this.visualRows[localIdx] = null;
				}
			});

			if (typeof response.totalCount === 'number') {
				if (this.activeNodes.length < response.totalCount) this.activeNodes.length = response.totalCount;
				if (this.visualRows.length < response.totalCount) this.visualRows.length = response.totalCount;
			}

			this.runtime.clearFormulas();
			this.loadingBlockCount = Math.max(0, this.loadingBlockCount - 1);
			this.runtime.setLoadingState(this.loadingBlockCount > 0);

			const requestFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			this.runtime.dispatchInfiniteBlockLoaded({
				blockIndex,
				loadedBlockStart: startRow,
				loadedBlockEnd: startRow + response.rows.length - 1,
				totalRecords: response.totalCount ?? this.activeNodes.length,
				durationMs: requestFinishedAt - requestStartedAt,
			});
		} catch (error) {
			if (this.disposed || generation !== this.requestGeneration) return;
			this.runtime.dispatchInfiniteBlockLoadFailed({
				blockIndex,
				startRow,
				endRow: endRow - 1,
				message: toErrorMessage(error),
			});
			this.runtime.reportBlockLoadFailure(blockIndex, error);
			delete this.loadingBlocks[blockIndex];
			this.loadingBlockCount = Math.max(0, this.loadingBlockCount - 1);
			this.runtime.setLoadingState(this.loadingBlockCount > 0);
		}
	};

	private clearBlockRange(startRow: number, endRow: number): void {
		for (let i = startRow; i < endRow; i++) {
			const existingVisual = this.visualRows[i];
			if (existingVisual?.kind === 'data') {
				const existingNode = this.activeNodes[i];
				if (existingNode) {
					// Only remove from maps if no other slot references this row ID.
					const mappedIndex = this.rowIdToVisualIndex.get(existingNode.id);
					if (mappedIndex === i) {
						this.nodeMap.delete(existingNode.id);
						this.rowIdToVisualIndex.delete(existingNode.id);
					}
					const mappedVisualIndex = this.visualRowIdToIndex.get(existingVisual.id);
					if (mappedVisualIndex === i) {
						this.visualRowIdToIndex.delete(existingVisual.id);
					}
				}
			}
			this.visualRows[i] = null;
			this.activeNodes[i] = null;
		}
	}

	public purgeCache = (): void => {
		if (this.disposed) return;
		this.requestGeneration++;
		this.loadingBlocks = {};
		this.loadingBlockCount = 0;
		this.activeNodes = [];
		this.visualRows = [];
		this.nodeMap.clear();
		this.visualRowIdToIndex.clear();
		this.rowIdToVisualIndex.clear();
		this.pendingVisibleLoad = null;
		this.runtime.clearFormulas();
		this.runtime.setLoadingState(true);
		this.fetchBlock(0);
	};

	public refresh(_reason?: RowRefreshReason): RowModelRefreshResult {
		this.purgeCache();
		return { changed: true };
	}
}
