import { GridStore, ColumnDef, RowModel, RowNode, setValueByPath } from './store.js';

export interface GetRowsParams {
	startRow: number;
	endRow: number;
	sortModel: unknown;
	filterModel: unknown;
}

export interface IGridDatasource {
	getRows(params: GetRowsParams): Promise<{ rows: unknown[]; totalCount?: number }>;
}

export interface ServerRowModelOptions<TData = unknown> {
	blockSize?: number;
	datasource: IGridDatasource;
	columns: Array<ColumnDef<TData>>;
	getRowId?: (row: TData) => string;
}

export class ServerRowModelController<TData = unknown> implements RowModel<TData> {
	private store: GridStore<TData>;
	private datasource: IGridDatasource;
	private blockSize: number;
	private activeNodes: Array<RowNode<TData> | null> = [];
	private nodeMap = new Map<string, RowNode<TData>>();
	private rowIdMap = new Map<string, number>();
	private loadingNodeMap = new Map<number, RowNode<TData>>();
	private loadingBlocks: Record<number, boolean> = {};
	private loadingBlockCount = 0;
	private unsubscribers: Array<() => void> = [];
	private disposed = false;
	private requestGeneration = 0;

	constructor(store: GridStore<TData>, options: ServerRowModelOptions<TData>) {
		this.store = store;
		this.datasource = options.datasource;
		this.blockSize = options.blockSize ?? 100;

		// Set base columns and config in store
		this.store.setState({
			columns: options.columns,
			getRowId: options.getRowId,
		});

		this.store.registerRowModel(this);

		this.unsubscribers.push(
			this.store.addEventListener('sortChanged', () => this.purgeCache()),
			this.store.addEventListener('filterChanged', () => this.purgeCache())
		);

		// Trigger initial fetch of block 0 to obtain totalCount and sparse placeholders
		this.fetchBlock(0);
	}

	public setDatasource(datasource: IGridDatasource, blockSize: number = this.blockSize): void {
		this.datasource = datasource;
		this.blockSize = blockSize;
		this.purgeCache();
	}

	public dispose(): void {
		this.disposed = true;
		this.requestGeneration++;
		this.loadingBlocks = {};
		this.loadingBlockCount = 0;
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	public getRow = (rowIndex: number): TData | null => {
		const node = this.activeNodes[rowIndex];
		return node ? node.data : null;
	};

	public getRowNode = (rowIndex: number): RowNode<TData> | null => {
		const node = this.activeNodes[rowIndex];
		if (node) {
			return node;
		}
		// Synthesize a stable loading RowNode to display shimmers for unloaded blocks
		if (rowIndex >= 0 && rowIndex < this.getRowCount()) {
			let loadingNode = this.loadingNodeMap.get(rowIndex);
			if (!loadingNode) {
				loadingNode = new RowNode<TData>(`__loading_${rowIndex}`, null as TData);
				this.loadingNodeMap.set(rowIndex, loadingNode);
			}
			return loadingNode;
		}
		return null;
	};

	public loadVisibleBlocks = (startRow: number, endRow: number): void => {
		if (startRow > endRow) return;

		const minRow = Math.max(0, startRow);
		const maxRow = Math.min(Math.max(0, endRow), Math.max(0, this.getRowCount() - 1));
		if (minRow > maxRow) return;

		const visibleBlocks = new Set<number>();
		const minBlock = Math.floor(minRow / this.blockSize);
		const maxBlock = Math.floor(maxRow / this.blockSize);
		for (let blockIdx = minBlock; blockIdx <= maxBlock; blockIdx++) {
			visibleBlocks.add(blockIdx);
		}

		// Dynamic predictive pre-fetching based on scrolling velocity
		const velocity = this.store.engine.viewport.getVelocity();
		const vy = velocity.vy; // px/ms
		const totalBlocks = Math.ceil(this.getRowCount() / this.blockSize);

		if (vy > 0.1) {
			// Scrolling down: proactively pre-fetch next 1 or 2 blocks
			const ahead1 = maxBlock + 1;
			const ahead2 = maxBlock + 2;
			if (ahead1 < totalBlocks) visibleBlocks.add(ahead1);
			if (ahead2 < totalBlocks) visibleBlocks.add(ahead2);
		} else if (vy < -0.1) {
			// Scrolling up: proactively pre-fetch previous 1 or 2 blocks
			const ahead1 = minBlock - 1;
			const ahead2 = minBlock - 2;
			if (ahead1 >= 0) visibleBlocks.add(ahead1);
			if (ahead2 >= 0) visibleBlocks.add(ahead2);
		}

		visibleBlocks.forEach((blockIdx) => {
			const startRow = blockIdx * this.blockSize;
			const isAlreadyLoaded = this.activeNodes[startRow] !== undefined && this.activeNodes[startRow] !== null;

			if (!isAlreadyLoaded && !this.loadingBlocks[blockIdx]) {
				this.fetchBlock(blockIdx);
			}
		});
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
		return true;
	};

	private fetchBlock = async (blockIndex: number): Promise<void> => {
		if (this.disposed) return;
		// Prevent duplicate calls
		if (this.loadingBlocks[blockIndex]) return;

		this.loadingBlocks[blockIndex] = true;
		this.loadingBlockCount++;
		const generation = this.requestGeneration;
		const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

		// Set initial mount loading state and schedule immediate repaint only if fetching block 0
		if (blockIndex === 0) {
			this.store.setState((s) => ({
				loading: true,
				dataVersion: s.dataVersion + 1,
			}));
		}

		const startRow = blockIndex * this.blockSize;
		const endRow = startRow + this.blockSize;

		const state = this.store.getState();
		const requestSortModel = state.sortModel;
		const requestFilterModel = state.filterModel;
		const requestSignature = JSON.stringify({ sortModel: requestSortModel, filterModel: requestFilterModel });

		try {
			const response = await this.datasource.getRows({
				startRow,
				endRow,
				sortModel: requestSortModel,
				filterModel: requestFilterModel,
			});

			if (this.disposed || generation !== this.requestGeneration) {
				return;
			}

			// If parameters changed since the request was initiated, discard this result
			const curr = this.store.getState();
			const currentSignature = JSON.stringify({ sortModel: curr.sortModel, filterModel: curr.filterModel });

			delete this.loadingBlocks[blockIndex];

			if (currentSignature !== requestSignature) {
				this.loadingBlockCount = Math.max(0, this.loadingBlockCount - 1);
				const hasActiveFetches = this.loadingBlockCount > 0;
				this.store.setState({
					loading: hasActiveFetches,
				});
				return;
			}

			// Grow sparsely without pushing one placeholder per missing row.
			if (this.activeNodes.length < startRow) {
				this.activeNodes.length = startRow;
			}

			// Patch loaded rows into the array and index map
			response.rows.forEach((row, idx) => {
				const globalIdx = startRow + idx;
				const typedRow = row as TData;
				if (typedRow) {
					const id = this.store.getRowId(typedRow);
					let node = this.nodeMap.get(id);
					if (node) {
						node.setData(typedRow);
					} else {
						node = new RowNode<TData>(id, typedRow);
					}

					this.activeNodes[globalIdx] = node;
					this.nodeMap.set(id, node);
					this.rowIdMap.set(id, globalIdx);
				} else {
					this.activeNodes[globalIdx] = null;
				}
			});

			// If total count returned, ensure array size matches
			if (typeof response.totalCount === 'number') {
				if (this.activeNodes.length < response.totalCount) {
					this.activeNodes.length = response.totalCount;
				}
			}

			this.store.engine.clearFormulas();

			// Layout geometry will be updated by GridEngine using GeometryModel
			this.loadingBlockCount = Math.max(0, this.loadingBlockCount - 1);
			const hasActiveFetches = this.loadingBlockCount > 0;
			this.store.setState({
				loading: hasActiveFetches,
				dataVersion: curr.dataVersion + 1,
			});

			const requestFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			this.store.dispatchEvent('serverBlockLoaded', {
				blockIndex,
				loadedBlockStart: startRow,
				loadedBlockEnd: startRow + response.rows.length - 1,
				totalRecords: response.totalCount ?? this.activeNodes.length,
				durationMs: requestFinishedAt - requestStartedAt,
			});
		} catch (error) {
			if (this.disposed || generation !== this.requestGeneration) {
				return;
			}
			console.error(`GridEngine: Failed to fetch row block ${blockIndex}`, error);
			delete this.loadingBlocks[blockIndex];
			this.loadingBlockCount = Math.max(0, this.loadingBlockCount - 1);
			const hasActiveFetches = this.loadingBlockCount > 0;
			this.store.setState({
				loading: hasActiveFetches,
				dataVersion: this.store.getState().dataVersion + 1,
			});
		}
	};

	public purgeCache = (): void => {
		if (this.disposed) return;
		this.requestGeneration++;
		this.loadingBlocks = {};
		this.loadingBlockCount = 0;
		this.activeNodes = [];
		this.nodeMap.clear();
		this.rowIdMap.clear();
		this.loadingNodeMap.clear();
		this.store.engine.clearFormulas();
		this.store.setState({
			loading: true,
			dataVersion: this.store.getState().dataVersion + 1,
		});
		this.fetchBlock(0);
	};
}
