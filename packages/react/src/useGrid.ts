import { useEffect, useInsertionEffect, useMemo, useRef } from 'react';
import { createClientGrid, createServerGrid, type GridApi } from '@open-grid/core';

import type { ClientGridOptions, ServerGridOptions } from './types.js';

export function useClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options);

	const api = useMemo(() => {
		return createClientGrid(initialOptionsRef.current);
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
		return createServerGrid(initialOptionsRef.current);
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
