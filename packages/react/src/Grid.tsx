import { createClientGrid, createServerGrid } from '@open-grid/core';
import { useEffect, useMemo, useRef, useInsertionEffect, type PropsWithChildren } from 'react';
import { GridProvider } from './gridContext.js';
import { GridView, type GridViewProps } from './GridView.js';
import { resolveColumnTypes } from './resolveColumnTypes.js';
import { compileStyleRules } from './styleRules.js';
import type { ColumnDef, GridState, GridPersistenceAdapter, GridDatasource } from './types.js';
import type { GridReadyEvent, StyleRule, ColumnTypeDefinition } from './types.js';

type GridShellProps<TRowData> = Omit<GridViewProps<TRowData>, 'api'>;
const DEFAULT_PAGE_SIZE = 100;

/**
 * Pagination is owned by core (the page-window slicing lives in the row pipeline — Plan
 * 041 — and the pagination bar is core chrome — Plan 039). This prop only forwards config;
 * the adapter never slices rows or renders pagination UI itself.
 */
export interface GridPaginationConfig {
	pageSize?: number;
	initialPage?: number;
}

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
	/** Enable the core pagination bar (and, in client mode, page-window row slicing). */
	pagination?: boolean | GridPaginationConfig;
	/** Show the core status bar (row + selection counts). */
	showStatusBar?: boolean;
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

function normalizePagination(pagination: boolean | GridPaginationConfig | undefined): { pageSize: number; initialPage: number } | null {
	if (!pagination) return null;
	const config = pagination === true ? {} : pagination;
	return { pageSize: config.pageSize ?? DEFAULT_PAGE_SIZE, initialPage: config.initialPage ?? 0 };
}

function createInitialState<TRowData>(
	base: GridCommonProps<TRowData>,
	extras: { detailRowHeight?: number; pagination: { pageSize: number; initialPage: number } | null; showStatusBar?: boolean }
) {
	const { initialState, rowOverscanPx, colBuffer, overscanAdaptive, runtimeLimits } = base;
	const merged: Partial<GridState<TRowData>> = {
		rowOverscanPx,
		overscanAdaptive,
		colBuffer,
		runtimeLimits,
		...initialState,
	};
	if (extras.detailRowHeight != null) merged.detailRowHeight = extras.detailRowHeight;
	// Pagination + status bar are core concerns; the adapter just seeds the config.
	if (extras.pagination) merged.pagination = { pageSize: extras.pagination.pageSize, page: extras.pagination.initialPage };
	if (extras.showStatusBar) merged.showStatusBar = true;
	return merged;
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
		showStatusBar,
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
			{ detailRowHeight, pagination: paginationConfig, showStatusBar }
		);
		if (mode === 'client') {
			return createClientGrid({
				rows: rows as TRowData[],
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
			pagination: paginationConfig ? { pageSize: paginationConfig.pageSize, initialPage: paginationConfig.initialPage } : undefined,
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
		api.setRows(rows as TRowData[]);
	}, [api, mode, rows]);

	useEffect(() => {
		if (mode !== 'server') return;
		if (!didMountServerRef.current) {
			didMountServerRef.current = true;
			return;
		}
		api.setServerDatasource(datasource as GridDatasource<TRowData>, blockSize);
	}, [api, mode, datasource, blockSize]);

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
				{children ? <div className='shrink-0'>{children}</div> : null}
			</div>
		</GridProvider>
	);
}
