import { useEffect, useInsertionEffect, useMemo, useRef } from 'react';
import { createClientGrid, createServerGrid, type GridApi } from '@open-grid/core';

import type { ClientGridOptions, ServerGridOptions } from './types.js';

export function useClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options);
	// Skip the first mount — columns are already set at grid-creation time (with persisted state applied).
	// Only propagate when options.columns actually changes after the initial render.
	const didMountColumnsRef = useRef(false);

	const api = useMemo(() => {
		const { rows, columns, getRowId, rowOverscanPx, colBuffer, runtimeLimits, initialState, overscanAdaptive, persistence } =
			initialOptionsRef.current;
		return createClientGrid({
			rows,
			columns,
			getRowId,
			persistence,
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
		if (!didMountColumnsRef.current) {
			didMountColumnsRef.current = true;
			return;
		}
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
	const didMountColumnsRef = useRef(false);
	const didMountServerOptionsRef = useRef(false);

	const api = useMemo(() => {
		const { datasource, columns, blockSize, getRowId, rowOverscanPx, colBuffer, overscanAdaptive, runtimeLimits, initialState, persistence } =
			initialOptionsRef.current;
		return createServerGrid({
			datasource,
			columns,
			blockSize,
			getRowId,
			persistence,
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
		if (!didMountColumnsRef.current) {
			didMountColumnsRef.current = true;
			return;
		}
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
