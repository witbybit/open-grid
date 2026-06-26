import { createClientGrid, createInfiniteGrid, createServerPageGrid, createLocalStorageAdapter } from '@open-grid/core';
import { useEffect, useMemo, useRef, useInsertionEffect, type PropsWithChildren } from 'react';
import { GridProvider } from './gridContext.js';
import { GridView, type GridViewProps } from './GridView.js';
import { resolveColumnTypes } from './resolveColumnTypes.js';
import type {
	ColumnDef,
	GridInitialState,
	GridPersistenceAdapter,
	GridWorkspaceAdapter,
	RowSelectionMode,
	RowSelectionOptions,
	InfiniteDatasource,
	ServerDatasource,
	ServerPaginationOptions,
} from './types.js';
import type { GridReadyEvent, StyleRule, ColumnTypeDefinition } from './types.js';
import type { GridCapabilitiesConfig } from '@open-grid/core';

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
	initialState?: Partial<GridInitialState<TRowData>>;
	persistence?: string | GridPersistenceAdapter;
	workspace?: GridWorkspaceAdapter;
	rowOverscanPx?: number;
	colBuffer?: number;
	overscanAdaptive?: boolean;
	runtimeLimits?: GridInitialState<TRowData>['runtimeLimits'];
	columnTypes?: Record<string, ColumnTypeDefinition<TRowData>>;
	styleRules?: StyleRule<TRowData>[];
	/** Unified Data Integrity pipeline — validation, quality, diff, live stream, conflict resolution. */
	dataIntegrity?: import('@open-grid/core').GridDataIntegrityConfig<TRowData>;
	/** Grid-level capability rules. Control which actions are allowed per cell, column, or row. */
	capabilities?: GridCapabilitiesConfig<TRowData>;
	detailRowHeight?: number;
	/** Enable the core pagination bar (and, in client mode, page-window row slicing). */
	pagination?: boolean | GridPaginationConfig;
	rowSelection?: RowSelectionMode | RowSelectionOptions;
	/** Show the core status bar (row + selection counts). */
	showStatusBar?: boolean;
	/** Show the filter chip bar above the header when filters are active. */
	showFilterChipBar?: boolean;
	/** Show the floating filter row — always-visible inline filter inputs below column headers. */
	showFloatingFilters?: boolean;
	/** Row drag mode: 'managed' (grid auto-reorders) or 'unmanaged' (host applies order). */
	rowDragMode?: 'managed' | 'unmanaged';
	onGridReady?: (event: GridReadyEvent<TRowData>) => void;
}

export interface GridClientProps<TRowData = unknown> extends GridCommonProps<TRowData> {
	rowModelType?: 'client';
	rows: TRowData[];
}

/** Block/range (infinite scroll) row model — datasource receives startRow/endRow. */
export interface GridInfiniteProps<TRowData = unknown> extends GridCommonProps<TRowData> {
	rowModelType: 'infinite';
	datasource: InfiniteDatasource<TRowData>;
	blockSize?: number;
}

/** Explicit page-based server row model — datasource receives page/pageSize. */
export interface GridServerPageProps<TRowData = unknown> extends GridCommonProps<TRowData> {
	rowModelType: 'server';
	datasource: ServerDatasource<TRowData>;
	pagination?: ServerPaginationOptions;
}

export type GridProps<TRowData = unknown> = GridClientProps<TRowData> | GridInfiniteProps<TRowData> | GridServerPageProps<TRowData>;
export type GridRootProps<TRowData = unknown> = PropsWithChildren<GridProps<TRowData>>;

function normalizePagination(pagination: boolean | GridPaginationConfig | undefined): { pageSize: number; initialPage: number } | null {
	if (!pagination) return null;
	const config = pagination === true ? {} : pagination;
	return { pageSize: config.pageSize ?? DEFAULT_PAGE_SIZE, initialPage: config.initialPage ?? 0 };
}

function createInitialState<TRowData>(
	base: GridCommonProps<TRowData>,
	extras: {
		detailRowHeight?: number;
		pagination: { pageSize: number; initialPage: number } | null;
		showStatusBar?: boolean;
		showFilterChipBar?: boolean;
		showFloatingFilters?: boolean;
		rowDragMode?: 'managed' | 'unmanaged';
	}
) {
	const { initialState, rowOverscanPx, colBuffer, overscanAdaptive, runtimeLimits } = base;
	const merged: Partial<GridInitialState<TRowData>> = {
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
	if (extras.showFilterChipBar) merged.showFilterChipBar = true;
	if (extras.showFloatingFilters) merged.showFloatingFilters = true;
	if (extras.rowDragMode) merged.rowDragMode = extras.rowDragMode;
	return merged;
}

function warnInitialOnlyGridProp(propName: string): void {
	console.warn(
		`[open-grid/react] Prop "${propName}" is initial-only on <Grid /> after mount. ` +
			'Changing it does not reconfigure the existing grid instance. Remount the grid if you need the new value to take effect.'
	);
}

export function Grid<TRowData = unknown>(props: GridRootProps<TRowData>) {
	const {
		rowModelType,
		onGridReady,
		detailRowHeight,
		columns,
		columnTypes,
		styleRules,
		dataIntegrity,
		capabilities,
		getRowId,
		initialState,
		persistence,
		workspace,
		rowOverscanPx,
		colBuffer,
		overscanAdaptive,
		runtimeLimits,
		pagination,
		showStatusBar,
		showFilterChipBar,
		showFloatingFilters,
		rows,
		datasource,
		blockSize,
		rowSelection,
		rowDragMode,
		children,
		...viewProps
	} = props as GridRootProps<TRowData> &
		GridShellProps<TRowData> & {
			rowModelType?: 'client' | 'infinite' | 'server';
			rows?: TRowData[];
			datasource?: InfiniteDatasource<TRowData> | ServerDatasource<TRowData>;
			blockSize?: number;
			rowSelection?: RowSelectionMode | RowSelectionOptions;
			rowDragMode?: 'managed' | 'unmanaged';
			serverPagination?: ServerPaginationOptions;
		};
	const readyFiredRef = useRef(false);
	const lastColumnsRef = useRef(columns);
	const lastColumnTypesRef = useRef(columnTypes);
	const didMountServerRef = useRef(false);
	const warnedInitialOnlyPropsRef = useRef(new Set<string>());
	const paginationConfig = useMemo(() => normalizePagination(pagination), [pagination]);
	const initialOnlyPropsRef = useRef({
		rowModelType,
		getRowId,
		initialState,
		persistence,
		workspace,
		rowOverscanPx,
		overscanAdaptive,
		runtimeLimits,
		dataIntegrity,
		capabilities,
		detailRowHeight,
		pagination,
		rowSelection,
		showStatusBar,
		rowDragMode,
		blockSize,
	});

	const api = useMemo(() => {
		// Normalize string persistence key to a GridPersistenceAdapter so core always receives the adapter type.
		const resolvedPersistence = typeof persistence === 'string' ? createLocalStorageAdapter(persistence) : persistence;
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
			{ detailRowHeight, pagination: paginationConfig, showStatusBar, showFilterChipBar, showFloatingFilters, rowDragMode }
		);

		if (rowModelType === 'infinite') {
			return createInfiniteGrid({
				datasource: datasource as InfiniteDatasource<TRowData>,
				columns: resolveColumnTypes(columns, columnTypes),
				blockSize,
				getRowId,
				persistence: resolvedPersistence,
				workspace,
				rowSelection,
				dataIntegrity,
				capabilities,
				initialState: initial,
			});
		}

		if (rowModelType === 'server') {
			const serverPagePagination = (props as GridServerPageProps<TRowData>).pagination;
			return createServerPageGrid({
				datasource: datasource as ServerDatasource<TRowData>,
				columns: resolveColumnTypes(columns, columnTypes),
				getRowId,
				persistence: resolvedPersistence,
				workspace,
				rowSelection,
				dataIntegrity,
				capabilities,
				initialState: initial,
				pagination: serverPagePagination ?? { pageSize: paginationConfig?.pageSize ?? 100 },
			});
		}

		// Default: client row model
		return createClientGrid({
			rows: rows as TRowData[],
			columns: resolveColumnTypes(columns, columnTypes),
			getRowId,
			persistence: resolvedPersistence,
			workspace,
			rowSelection,
			dataIntegrity,
			capabilities,
			initialState: initial,
		});
		// The grid instance is intentionally created once; live changes are handled by the dedicated hooks below.
	}, []);

	useEffect(() => {
		api.setStyleRules(styleRules && styleRules.length > 0 ? styleRules : undefined);
	}, [api, styleRules]);

	useEffect(() => {
		api.setShowFloatingFilters(!!showFloatingFilters);
	}, [api, showFloatingFilters]);

	useEffect(() => {
		api.setShowFilterChipBar(!!showFilterChipBar);
	}, [api, showFilterChipBar]);

	useEffect(() => {
		if (rowModelType !== 'client' && rowModelType !== undefined) return;
		api.setRows(rows as TRowData[]);
	}, [api, rowModelType, rows]);

	useEffect(() => {
		if (rowModelType !== 'infinite') return;
		if (!didMountServerRef.current) {
			didMountServerRef.current = true;
			return;
		}
		api.setInfiniteDatasource(datasource as InfiniteDatasource<TRowData>, blockSize);
	}, [api, rowModelType, datasource, blockSize]);

	useEffect(() => {
		if (rowModelType !== 'server') return;
		if (!didMountServerRef.current) {
			didMountServerRef.current = true;
			return;
		}
		api.setServerPageDatasource(datasource as ServerDatasource<TRowData>);
	}, [api, rowModelType, datasource]);

	useEffect(() => {
		if (columns === lastColumnsRef.current && columnTypes === lastColumnTypesRef.current) return;
		lastColumnsRef.current = columns;
		lastColumnTypesRef.current = columnTypes;
		api.setColumns(resolveColumnTypes(columns, columnTypes));
	}, [api, columns, columnTypes]);

	useEffect(() => {
		if (readyFiredRef.current) return;
		readyFiredRef.current = true;
		const resolvedRowModelType = rowModelType ?? 'client';
		onGridReady?.({ api, rowModelType: resolvedRowModelType });
	}, [api, rowModelType, onGridReady]);

	useEffect(() => {
		const initialOnlyProps = initialOnlyPropsRef.current;
		const checks: Array<[string, unknown, unknown]> = [
			['rowModelType', initialOnlyProps.rowModelType, rowModelType],
			['getRowId', initialOnlyProps.getRowId, getRowId],
			['initialState', initialOnlyProps.initialState, initialState],
			['persistence', initialOnlyProps.persistence, persistence],
			['workspace', initialOnlyProps.workspace, workspace],
			['rowOverscanPx', initialOnlyProps.rowOverscanPx, rowOverscanPx],
			['overscanAdaptive', initialOnlyProps.overscanAdaptive, overscanAdaptive],
			['runtimeLimits', initialOnlyProps.runtimeLimits, runtimeLimits],
			['dataIntegrity', initialOnlyProps.dataIntegrity, dataIntegrity],
			['capabilities', initialOnlyProps.capabilities, capabilities],
			['detailRowHeight', initialOnlyProps.detailRowHeight, detailRowHeight],
			['pagination', initialOnlyProps.pagination, pagination],
			['rowSelection', initialOnlyProps.rowSelection, rowSelection],
			['showStatusBar', initialOnlyProps.showStatusBar, showStatusBar],
			['rowDragMode', initialOnlyProps.rowDragMode, rowDragMode],
			['blockSize', initialOnlyProps.blockSize, blockSize],
		];

		for (const [propName, initialValue, currentValue] of checks) {
			if (Object.is(initialValue, currentValue)) continue;
			if (warnedInitialOnlyPropsRef.current.has(propName)) continue;
			warnedInitialOnlyPropsRef.current.add(propName);
			warnInitialOnlyGridProp(propName);
		}
	}, [
		rowModelType,
		getRowId,
		initialState,
		persistence,
		workspace,
		rowOverscanPx,
		overscanAdaptive,
		runtimeLimits,
		dataIntegrity,
		capabilities,
		detailRowHeight,
		pagination,
		rowSelection,
		showStatusBar,
		rowDragMode,
		blockSize,
	]);

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
