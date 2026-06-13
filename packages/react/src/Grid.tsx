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

	// Client-side pagination: slice rows in React before passing to the grid.
	const [clientPage, setClientPage] = useState(paginationConfig?.initialPage ?? 0);
	const clientTotalRows = rows?.length ?? 0;
	const clientPageCount = paginationConfig && mode === 'client' ? Math.max(1, Math.ceil(clientTotalRows / pageSize)) : 1;
	const clampedClientPage = Math.max(0, Math.min(clientPage, clientPageCount - 1));

	const pagedClientRows = useMemo(() => {
		if (mode !== 'client' || !paginationConfig) return rows as TRowData[] | undefined;
		const sourceRows = rows as TRowData[] | undefined;
		if (!sourceRows) return sourceRows;
		return sourceRows.slice(clampedClientPage * pageSize, (clampedClientPage + 1) * pageSize);
	}, [mode, paginationConfig, rows, clampedClientPage, pageSize]);

	useEffect(() => {
		if (mode !== 'client' || !paginationConfig) return;
		setClientPage((prev) => Math.max(0, Math.min(prev, clientPageCount - 1)));
	}, [paginationConfig, clientPageCount, mode]);

	// Server-side pagination: owned by core. React only reads serverPagination state.
	const [serverPaginationState, setServerPaginationState] = useState(() =>
		mode === 'server' ? (null as { page: number; pageCount: number; totalRows: number; pageSize: number } | null) : null
	);

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
			datasource: datasource as GridDatasource<TRowData>,
			columns: resolveColumnTypes(columns, columnTypes),
			blockSize,
			getRowId,
			persistence,
			initialState: initial,
			pagination: paginationConfig ? { pageSize, initialPage: paginationConfig.initialPage } : undefined,
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
		api.setServerDatasource(datasource as GridDatasource<TRowData>, blockSize);
	}, [api, mode, datasource, blockSize]);

	// Subscribe to server pagination state changes so the UI updates without React state cascades.
	useEffect(() => {
		if (mode !== 'server' || !paginationConfig) return;
		const initial = api.getState().serverPagination;
		if (initial) setServerPaginationState(initial);
		return api.subscribeToKey('serverPagination', () => {
			const next = api.getState().serverPagination;
			if (next) setServerPaginationState(next);
		});
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

	// Resolve which pagination props to pass to the UI component.
	const activePaginationPage = mode === 'server' ? (serverPaginationState?.page ?? 0) : clampedClientPage;
	const activePaginationCount = mode === 'server' ? (serverPaginationState?.pageCount ?? 1) : clientPageCount;
	const activePaginationTotalRows = mode === 'server' ? (serverPaginationState?.totalRows ?? 0) : clientTotalRows;
	const activePaginationPageSize = mode === 'server' ? (serverPaginationState?.pageSize ?? pageSize) : pageSize;

	return (
		<GridProvider api={api}>
			<div className='flex h-full w-full flex-col'>
				<div className='min-h-0 flex-1'>
					<GridView<TRowData> {...viewProps} api={api} />
				</div>
				{paginationConfig ? (
					<div className='shrink-0'>
						<GridPagination
							page={activePaginationPage}
							pageCount={activePaginationCount}
							onPageChange={mode === 'server' ? (n) => api.goToPage(n) : setClientPage}
							totalRows={activePaginationTotalRows}
							pageSize={activePaginationPageSize}
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
