import { useEffect, useInsertionEffect, useMemo, useRef } from 'react';
import { createClientGrid, createServerGrid, type GridApi } from '@open-grid/core';

import type { ClientGridOptions, ServerGridOptions } from './types.js';

export function useClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options);

	const api = useMemo(() => {
		const { rows, columns, getRowId, rowOverscanPx, colBuffer, runtimeLimits, initialState, overscanAdaptive } = initialOptionsRef.current;
		return createClientGrid({
			rows,
			columns,
			getRowId,
			initialState: {
				rowOverscanPx,
				overscanAdaptive,
				colBuffer,
				runtimeLimits,
				...initialState,
			},
		});
	}, []);

	useEffect(() => {
		api.setColumns(options.columns);
	}, [api, options.columns]);

	useEffect(() => {
		api.setRows(options.rows);
	}, [api, options.rows]);

	useInsertionEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return api;
}

export function useServerGrid<TRowData>(options: ServerGridOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options);
	const didMountServerOptionsRef = useRef(false);

	const api = useMemo(() => {
		const { datasource, columns, blockSize, getRowId, rowOverscanPx, colBuffer, overscanAdaptive, runtimeLimits, initialState } =
			initialOptionsRef.current;
		return createServerGrid({
			datasource,
			columns,
			blockSize,
			getRowId,
			initialState: {
				rowOverscanPx,
				overscanAdaptive,
				colBuffer,
				runtimeLimits,
				...initialState,
			},
		});
	}, []);

	useEffect(() => {
		api.setColumns(options.columns);
	}, [api, options.columns]);

	useEffect(() => {
		if (!didMountServerOptionsRef.current) {
			didMountServerOptionsRef.current = true;
			return;
		}
		api.setServerDatasource(options.datasource, options.blockSize);
	}, [api, options.datasource, options.blockSize]);

	useInsertionEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return api;
}
