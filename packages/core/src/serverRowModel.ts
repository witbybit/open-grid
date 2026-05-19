import { GridStore } from './store.js';

export interface GetRowsParams {
	startRow: number;
	endRow: number;
	sortModel: any;
	filterModel: any;
}

export interface IGridDatasource {
	getRows(params: GetRowsParams): Promise<{ rows: any[]; totalCount?: number }>;
}

export interface ServerRowModelOptions {
	blockSize?: number;
	datasource: IGridDatasource;
}

export class ServerRowModelController {
	private store: GridStore;
	private datasource: IGridDatasource;
	private blockSize: number;
	private unsubscribers: Array<() => void> = [];

	constructor(store: GridStore, options: ServerRowModelOptions) {
		this.store = store;
		this.datasource = options.datasource;
		this.blockSize = options.blockSize ?? 100;

		// Set model type in store
		this.store.setState({ rowModelType: 'server' });
		this.unsubscribers.push(
			this.store.addEventListener('sortChanged', () => this.purgeCache()),
			this.store.addEventListener('filterChanged', () => this.purgeCache())
		);
	}

	public dispose(): void {
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	/**
	 * Safe access to get a row by its index. Triggers fetching if within missing blocks.
	 */
	public getRow = (rowIndex: number): { data: any | null; isLoading: boolean } => {
		const blockIndex = Math.floor(rowIndex / this.blockSize);
		const state = this.store.getState();

		const block = state.loadedBlocks[blockIndex];
		const isFetching = state.loadingBlocks[blockIndex];

		if (!block && !isFetching) {
			// Trigger lazy load asynchronously
			this.fetchBlock(blockIndex);
		}

		if (isFetching) {
			return { data: null, isLoading: true };
		}

		if (block) {
			const internalIndex = rowIndex % this.blockSize;
			const rowData = block[internalIndex];
			return { data: rowData ?? null, isLoading: false };
		}

		return { data: null, isLoading: true };
	};

	/**
	 * Trigger fetch of a given block index using the datasource.
	 */
	private fetchBlock = async (blockIndex: number): Promise<void> => {
		const state = this.store.getState();

		// Prevent duplicate calls
		if (state.loadingBlocks[blockIndex]) return;

		// Set loading state
		this.store.setState((curr) => ({
			loadingBlocks: { ...curr.loadingBlocks, [blockIndex]: true },
		}));

		const startRow = blockIndex * this.blockSize;
		const endRow = startRow + this.blockSize;

		try {
			const response = await this.datasource.getRows({
				startRow,
				endRow,
				sortModel: state.sortModel,
				filterModel: state.filterModel,
			});

			this.store.setState((curr) => {
				const nextLoading = { ...curr.loadingBlocks };
				delete nextLoading[blockIndex];

				const updates: Partial<typeof curr> = {
					loadedBlocks: {
						...curr.loadedBlocks,
						[blockIndex]: response.rows,
					},
					loadingBlocks: nextLoading,
				};

				// If total count returned, update overall grid bounds
				if (typeof response.totalCount === 'number') {
					updates.rowCount = response.totalCount;
				}

				return updates;
			});
		} catch (error) {
			console.error(`GridEngine: Failed to fetch row block ${blockIndex}`, error);

			// Clear loading state
			this.store.setState((curr) => {
				const nextLoading = { ...curr.loadingBlocks };
				delete nextLoading[blockIndex];
				return { loadingBlocks: nextLoading };
			});
		}
	};

	/**
	 * Reset block cache and trigger fresh data loading.
	 */
	public purgeCache = (): void => {
		this.store.setState({
			loadedBlocks: {},
			loadingBlocks: {},
		});
	};
}
