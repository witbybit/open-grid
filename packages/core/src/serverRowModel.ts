import { GridStore, ColumnDef, RowModel, RowNode, getValueByPath, setValueByPath } from './store.js';

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
	private loadingBlocks: Record<number, boolean> = {};
	private unsubscribers: Array<() => void> = [];

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

	public dispose(): void {
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	public getRow = (rowIndex: number): TData | null => {
		const node = this.activeNodes[rowIndex];
		return node ? node.data : null;
	};

	public getRowNode = (rowIndex: number): RowNode<TData> | null => {
		return this.activeNodes[rowIndex] ?? null;
	};

	public loadVisibleBlocks = (visibleRowIndices: number[]): void => {
		const visibleBlocks = new Set<number>();
		visibleRowIndices.forEach((idx) => {
			visibleBlocks.add(Math.floor(idx / this.blockSize));
		});

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

	public setCellValue = (rowId: string, colField: string, value: unknown): void => {
		const node = this.getRowNodeById(rowId);
		if (!node) return;

		const col = this.store.getColumnDef(colField);
		const updatedRow = { ...node.data };
		if (col?.valueSetter) {
			col.valueSetter(updatedRow, value);
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.data = updatedRow;
		node.clearValueCache();
	};

	private fetchBlock = async (blockIndex: number): Promise<void> => {
		// Prevent duplicate calls
		if (this.loadingBlocks[blockIndex]) return;

		this.loadingBlocks[blockIndex] = true;

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

			// If parameters changed since the request was initiated, discard this result
			const curr = this.store.getState();
			const currentSignature = JSON.stringify({ sortModel: curr.sortModel, filterModel: curr.filterModel });

			delete this.loadingBlocks[blockIndex];

			if (currentSignature !== requestSignature) {
				return;
			}

			// Fill with sparse nulls up to startRow if array is not large enough
			while (this.activeNodes.length < startRow) {
				this.activeNodes.push(null);
			}

			// Patch loaded rows into the array and index map
			let currentTop =
				startRow > 0 && this.activeNodes[startRow - 1]
					? this.activeNodes[startRow - 1]!.rowTop + this.activeNodes[startRow - 1]!.rowHeight
					: startRow * curr.defaultRowHeight;

			response.rows.forEach((row, idx) => {
				const globalIdx = startRow + idx;
				const typedRow = row as TData;
				if (typedRow) {
					const id = this.store.getRowId(typedRow);
					let node = this.nodeMap.get(id);
					if (node) {
						node.data = typedRow;
						node.clearValueCache();
					} else {
						node = new RowNode<TData>(id, typedRow);
					}

					node.rowIndex = globalIdx;
					const explicitHeight = curr.rowHeights[node.id];
					node.rowHeight = explicitHeight !== undefined ? explicitHeight : curr.defaultRowHeight;
					node.rowTop = currentTop;
					currentTop += node.rowHeight;

					this.activeNodes[globalIdx] = node;
					this.nodeMap.set(id, node);
					this.rowIdMap.set(id, globalIdx);
				} else {
					this.activeNodes[globalIdx] = null;
				}
			});

			// If total count returned, ensure array size matches
			if (typeof response.totalCount === 'number') {
				while (this.activeNodes.length < response.totalCount) {
					this.activeNodes.push(null);
				}
			}

			// We need to re-layout from the start row onwards to adjust all subsequent heights/tops if they are loaded
			let layoutTop = 0;
			this.activeNodes.forEach((node, index) => {
				if (node) {
					node.rowIndex = index;
					node.rowTop = layoutTop;
					layoutTop += node.rowHeight;
				} else {
					layoutTop += curr.defaultRowHeight;
				}
			});

			this.store.setState({
				dataVersion: curr.dataVersion + 1,
			});
		} catch (error) {
			console.error(`GridEngine: Failed to fetch row block ${blockIndex}`, error);
			delete this.loadingBlocks[blockIndex];
		}
	};

	public purgeCache = (): void => {
		this.loadingBlocks = {};
		this.activeNodes = [];
		this.nodeMap.clear();
		this.rowIdMap.clear();
		this.store.setState({
			dataVersion: this.store.getState().dataVersion + 1,
		});
		this.fetchBlock(0);
	};
}
