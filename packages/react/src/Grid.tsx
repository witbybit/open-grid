import { createClientGrid, createServerGrid } from '@open-grid/core';
import { useEffect, useInsertionEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import { GridProvider } from './gridContext.js';
import { GridView, type GridViewProps } from './GridView.js';
import { resolveColumnTypes } from './resolveColumnTypes.js';
import { compileStyleRules } from './styleRules.js';
import type { ColumnDef, GridState, GridPersistenceAdapter, GridDatasource } from './types.js';
import type { GridReadyEvent, StyleRule, ColumnTypeDefinition } from './types.js';

type GridShellProps<TRowData> = Omit<GridViewProps<TRowData>, 'api'>;

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
	onGridReady?: (event: GridReadyEvent<TRowData>) => void;
}

export interface GridClientProps<TRowData = unknown> extends GridCommonProps<TRowData> {
	mode: 'client';
	rows: TRowData[];
	rowSelection?: 'single' | 'multiple';
}

export interface GridServerProps<TRowData = unknown> extends GridCommonProps<TRowData> {
	mode: 'server';
	datasource: GridDatasource;
	blockSize?: number;
}

export type GridProps<TRowData = unknown> = GridClientProps<TRowData> | GridServerProps<TRowData>;
export type GridRootProps<TRowData = unknown> = PropsWithChildren<GridProps<TRowData>>;

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
		rows,
		datasource,
		blockSize,
		rowSelection,
		children,
		...viewProps
	} = props as GridRootProps<TRowData> &
		GridShellProps<TRowData> & {
			rows?: TRowData[];
			datasource?: GridDatasource;
			blockSize?: number;
			rowSelection?: 'single' | 'multiple';
		};
	const readyFiredRef = useRef(false);
	const lastColumnsRef = useRef(columns);
	const lastColumnTypesRef = useRef(columnTypes);
	const didMountServerRef = useRef(false);

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
				rows: rows as TRowData[],
				columns: resolveColumnTypes(columns, columnTypes),
				getRowId,
				persistence,
				rowSelection,
				initialState: initial,
			});
		}

		return createServerGrid({
			datasource: datasource as GridDatasource,
			columns: resolveColumnTypes(columns, columnTypes),
			blockSize,
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
		api.setRows(rows as TRowData[]);
	}, [api, mode, rows]);

	useEffect(() => {
		if (mode !== 'server') return;
		if (!didMountServerRef.current) {
			didMountServerRef.current = true;
			return;
		}
		api.setServerDatasource(datasource as GridDatasource, blockSize);
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
