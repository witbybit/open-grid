import { createClientGrid, createServerGrid, GridEventName } from '@open-grid/core';
import { useEffect, useInsertionEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { GridProvider } from './gridContext.js';
import { GridView, type GridViewProps } from './GridView.js';
import { GridPagination } from './pagination.js';
import { resolveColumnTypes } from './resolveColumnTypes.js';
import { compileStyleRules } from './styleRules.js';
import type { ColumnDef, GridState, GridPersistenceAdapter, GridDatasource } from './types.js';
import type { GridReadyEvent, StyleRule, ColumnTypeDefinition, GridPaginationOptions } from './types.js';

type GridShellProps<TRowData> = Omit<GridViewProps<TRowData>, 'api'>;
const DEFAULT_PAGE_SIZE = 100;

interface GridCommonProps<TRowData> extends GridShellProps<TRowData> {
	columns: ColumnDef<TRowData>[];
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridState<TRowData>>;
	persistence?: GridPersistenceAdapter;
	rowOverscanPx?: number;
	colBuffer?: number;
	overscanAdaptive?: boolean;
	runtimeLimits?: GridState<TRowData>['runtimeLimits'];
	columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
	styleRules?: StyleRule<TRowData>[];
	detailRowHeight?: number;
	pagination?: boolean | GridPaginationOptions;
	onGridReady?: (event: GridReadyEvent<TRowData>) => void;
}

export interface GridClientProps<TRowData = unknown> extends GridCommonProps<TRowData> {
	mode: 'client';
	rows: TRowData[];
	rowSelection?: 'single' | 'multiple';
}

export interface GridServerProps<TRowData = unknown> extends GridCommonProps<TRowData> {
	mode: 'server';
	datasource: GridDatasource<TRowData>;
	blockSize?: number;
}

export type GridProps<TRowData = unknown> = GridClientProps<TRowData> | GridServerProps<TRowData>;
export type GridRootProps<TRowData = unknown> = PropsWithChildren<GridProps<TRowData>>;

function normalizePagination(pagination: boolean | GridPaginationOptions | undefined): GridPaginationOptions | null {
	if (!pagination) return null;
	return pagination === true ? {} : pagination;
}

function createInitialState<TRowData>(base: GridCommonProps<TRowData>, detailRowHeight?: number) {
	const { initialState, rowOverscanPx, colBuffer, overscanAdaptive, runtimeLimits } = base;
	const merged = {
		rowOverscanPx,
		overscanAdaptive,
		colBuffer,
		runtimeLimits,
		...initialState,
	};
	return detailRowHeight != null ? { detailRowHeight, ...merged } : merged;
}

export function Grid<TRowData = unknown>(props: GridRootProps<TRowData>) {
	const {
		mode,
		onGridReady,
		detailRowHeight,
		columns,
		columnTypes,
		styleRules,
		getRowId,
		initialState,
		persistence,
		rowOverscanPx,
		colBuffer,
		overscanAdaptive,
		runtimeLimits,
		pagination,
		rows,
		datasource,
		blockSize,
		rowSelection,
		children,
		...viewProps
	} = props as GridRootProps<TRowData> &
		GridShellProps<TRowData> & {
			rows?: TRowData[];
			datasource?: GridDatasource<TRowData>;
			blockSize?: number;
			rowSelection?: 'single' | 'multiple';
		};
	const readyFiredRef = useRef(false);
	const lastColumnsRef = useRef(columns);
	const lastColumnTypesRef = useRef(columnTypes);
	const didMountServerRef = useRef(false);
	const paginationConfig = useMemo(() => normalizePagination(pagination), [pagination]);
	const pageSize = paginationConfig?.pageSize ?? DEFAULT_PAGE_SIZE;
	const [page, setPage] = useState(paginationConfig?.initialPage ?? 0);
	const [serverTotalRows, setServerTotalRows] = useState(0);
	const clientTotalRows = rows?.length ?? 0;
	const totalRows = mode === 'client' ? clientTotalRows : serverTotalRows;
	const pageCount = paginationConfig ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1;
	const clampedPage = Math.max(0, Math.min(page, pageCount - 1));

	const pagedClientRows = useMemo(() => {
		if (mode !== 'client' || !paginationConfig) return rows as TRowData[] | undefined;
		const sourceRows = rows as TRowData[] | undefined;
		if (!sourceRows) return sourceRows;
		return sourceRows.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);
	}, [mode, paginationConfig, rows, clampedPage, pageSize]);

	const pagedServerDatasource = useMemo(() => {
		if (mode !== 'server' || !paginationConfig || !datasource) return datasource as GridDatasource<TRowData> | undefined;
		const pageOffset = clampedPage * pageSize;
		return {
			getRows: async (params) => {
				const localStart = Math.max(0, params.startRow);
				const localEndExclusive = Math.max(localStart, Math.min(pageSize, params.endRow));
				const response = await datasource.getRows({
					...params,
					startRow: pageOffset + localStart,
					endRow: pageOffset + localEndExclusive,
				});
				if (typeof response.totalCount === 'number') {
					setServerTotalRows(response.totalCount);
					return {
						rows: response.rows,
						totalCount: Math.min(pageSize, Math.max(0, response.totalCount - pageOffset)),
					};
				}
				setServerTotalRows((prev) => Math.max(prev, pageOffset + response.rows.length));
				return {
					rows: response.rows,
					totalCount: response.rows.length,
				};
			},
		} satisfies GridDatasource<TRowData>;
	}, [mode, paginationConfig, datasource, clampedPage, pageSize]);

	const effectiveServerBlockSize = mode === 'server' && paginationConfig ? Math.max(1, Math.min(blockSize ?? pageSize, pageSize)) : blockSize;

	useEffect(() => {
		if (!paginationConfig) return;
		setPage((prev) => Math.max(0, Math.min(prev, pageCount - 1)));
	}, [paginationConfig, pageCount]);

	const api = useMemo(() => {
		const initial = createInitialState(
			{
				columns,
				getRowId,
				initialState,
				persistence,
				rowOverscanPx,
				colBuffer,
				overscanAdaptive,
				runtimeLimits,
				columnTypes,
				styleRules,
			},
			detailRowHeight
		);
		if (mode === 'client') {
			return createClientGrid({
				rows: (pagedClientRows ?? rows) as TRowData[],
				columns: resolveColumnTypes(columns, columnTypes),
				getRowId,
				persistence,
				rowSelection,
				initialState: initial,
			});
		}

		return createServerGrid({
			datasource: (pagedServerDatasource ?? datasource) as GridDatasource<TRowData>,
			columns: resolveColumnTypes(columns, columnTypes),
			blockSize: effectiveServerBlockSize,
			getRowId,
			persistence,
			initialState: initial,
		});
		// The grid instance is intentionally created once; live changes are handled by the dedicated hooks below.
	}, []);

	useEffect(() => {
		if (!styleRules || styleRules.length === 0) {
			api.setStyleSlots(undefined);
			return;
		}
		api.setStyleSlots(compileStyleRules(styleRules));
	}, [api, styleRules]);

	useEffect(() => {
		if (mode !== 'client') return;
		api.setRows((pagedClientRows ?? rows) as TRowData[]);
	}, [api, mode, rows, pagedClientRows]);

	useEffect(() => {
		if (mode !== 'server') return;
		if (!didMountServerRef.current) {
			didMountServerRef.current = true;
			return;
		}
		api.setServerDatasource((pagedServerDatasource ?? datasource) as GridDatasource<TRowData>, effectiveServerBlockSize);
	}, [api, mode, datasource, pagedServerDatasource, effectiveServerBlockSize]);

	useEffect(() => {
		if (mode !== 'server' || !paginationConfig) return;
		const unsubscribe = api.addEventListener(GridEventName.serverBlockLoaded, (event) => {
			setServerTotalRows((prev) => Math.max(prev, event.payload.totalRecords));
		});
		return unsubscribe;
	}, [api, mode, paginationConfig]);

	useEffect(() => {
		if (columns === lastColumnsRef.current && columnTypes === lastColumnTypesRef.current) return;
		lastColumnsRef.current = columns;
		lastColumnTypesRef.current = columnTypes;
		api.setColumns(resolveColumnTypes(columns, columnTypes));
	}, [api, columns, columnTypes]);

	useEffect(() => {
		if (readyFiredRef.current) return;
		readyFiredRef.current = true;
		onGridReady?.({ api, mode });
	}, [api, mode, onGridReady]);

	useInsertionEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return (
		<GridProvider api={api}>
			<div className='flex h-full w-full flex-col'>
				<div className='min-h-0 flex-1'>
					<GridView<TRowData> {...viewProps} api={api} />
				</div>
				{paginationConfig ? (
					<div className='shrink-0'>
						<GridPagination
							page={clampedPage}
							pageCount={pageCount}
							onPageChange={setPage}
							totalRows={totalRows}
							pageSize={pageSize}
							className={paginationConfig.className}
							style={paginationConfig.style}
							maxPageButtons={paginationConfig.maxPageButtons}
							renderPrevButton={paginationConfig.renderPrevButton}
							renderNextButton={paginationConfig.renderNextButton}
							renderPageInfo={paginationConfig.renderPageInfo}
						/>
					</div>
				) : null}
				{children ? <div className='shrink-0'>{children}</div> : null}
			</div>
		</GridProvider>
	);
}
