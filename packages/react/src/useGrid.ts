import { useEffect, useInsertionEffect, useMemo, useRef } from 'react';
import { createClientGrid, createServerGrid, type GridApi } from '@open-grid/core';

import type { ClientGridOptions, ServerGridOptions } from './types.js';

declare const process: { env: { NODE_ENV: string } } | undefined;
const DEV = typeof process === 'undefined' || process.env.NODE_ENV !== 'production';

function warnInitialOnlyChanged(hookName: string, optName: string): void {
	if (DEV) {
		console.warn(
			`[open-grid] ${hookName}: \`${optName}\` changed after mount but it is an initial-only option. ` +
				`The new value will be ignored. Set it once before the first render.`
		);
	}
}

export function useClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options);
	// Track the last columns reference we synced to the grid.
	// Initialised to the initial columns so the first mount (and any Strict-Mode
	// double-invoke) skips setColumns — the grid was already seeded by createClientGrid.
	// A genuine columns change produces a new reference that differs from lastColumnsRef,
	// which then triggers setColumns and updates the ref.
	const lastColumnsRef = useRef(initialOptionsRef.current.columns);

	const api = useMemo(() => {
		const { rows, columns, getRowId, rowOverscanPx, colBuffer, runtimeLimits, initialState, overscanAdaptive, persistence, rowSelection } =
			initialOptionsRef.current;
		return createClientGrid({
			rows,
			columns,
			getRowId,
			persistence,
			rowSelection,
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
		if (options.columns === lastColumnsRef.current) return;
		lastColumnsRef.current = options.columns;
		api.setColumns(options.columns);
	}, [api, options.columns]);

	useEffect(() => {
		api.setRows(options.rows);
	}, [api, options.rows]);

	const initialGetRowId = initialOptionsRef.current.getRowId;
	const initialPersistence = initialOptionsRef.current.persistence;
	const initialInitialState = initialOptionsRef.current.initialState;

	useEffect(() => {
		if (options.getRowId !== initialGetRowId) warnInitialOnlyChanged('useClientGrid', 'getRowId');
	}, [options.getRowId, initialGetRowId]);

	useEffect(() => {
		if (options.persistence !== initialPersistence) warnInitialOnlyChanged('useClientGrid', 'persistence');
	}, [options.persistence, initialPersistence]);

	useEffect(() => {
		if (options.initialState !== initialInitialState) warnInitialOnlyChanged('useClientGrid', 'initialState');
	}, [options.initialState, initialInitialState]);

	useInsertionEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return api;
}

export function useServerGrid<TRowData>(options: ServerGridOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options);
	const lastServerColumnsRef = useRef(initialOptionsRef.current.columns);
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
		if (options.columns === lastServerColumnsRef.current) return;
		lastServerColumnsRef.current = options.columns;
		api.setColumns(options.columns);
	}, [api, options.columns]);

	useEffect(() => {
		if (!didMountServerOptionsRef.current) {
			didMountServerOptionsRef.current = true;
			return;
		}
		api.setServerDatasource(options.datasource, options.blockSize);
	}, [api, options.datasource, options.blockSize]);

	const serverInitialGetRowId = initialOptionsRef.current.getRowId;
	const serverInitialPersistence = initialOptionsRef.current.persistence;
	const serverInitialInitialState = initialOptionsRef.current.initialState;

	useEffect(() => {
		if (options.getRowId !== serverInitialGetRowId) warnInitialOnlyChanged('useServerGrid', 'getRowId');
	}, [options.getRowId, serverInitialGetRowId]);

	useEffect(() => {
		if (options.persistence !== serverInitialPersistence) warnInitialOnlyChanged('useServerGrid', 'persistence');
	}, [options.persistence, serverInitialPersistence]);

	useEffect(() => {
		if (options.initialState !== serverInitialInitialState) warnInitialOnlyChanged('useServerGrid', 'initialState');
	}, [options.initialState, serverInitialInitialState]);

	useInsertionEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return api;
}
