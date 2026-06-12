import { createClientGrid, createServerGrid, type ClientGridOptions, type GridApi, type ServerGridOptions } from '@open-grid/core';
import { useEffect, useMemo, useRef } from 'react';

export function useOwnedClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options);
	const lastRowsRef = useRef(options.rows);
	const lastColumnsRef = useRef(options.columns);
	const api = useMemo(() => {
		const initial = initialOptionsRef.current;
		return createClientGrid({
			rows: options.rows,
			columns: options.columns,
			getRowId: initial.getRowId,
			persistence: initial.persistence,
			rowSelection: initial.rowSelection,
			initialState: initial.initialState,
		});
	}, []);

	useEffect(() => {
		if (options.columns !== lastColumnsRef.current) {
			lastColumnsRef.current = options.columns;
			api.setColumns(options.columns);
		}
	}, [api, options.columns]);

	useEffect(() => {
		if (options.rows !== lastRowsRef.current) {
			lastRowsRef.current = options.rows;
			api.setRows(options.rows);
		}
	}, [api, options.rows]);

	useEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return api;
}

export function useOwnedServerGrid<TRowData>(options: ServerGridOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options);
	const lastColumnsRef = useRef(options.columns);
	const lastDatasourceRef = useRef(options.datasource);
	const api = useMemo(() => {
		const initial = initialOptionsRef.current;
		return createServerGrid({
			datasource: options.datasource,
			columns: options.columns,
			blockSize: options.blockSize,
			getRowId: initial.getRowId,
			persistence: initial.persistence,
			initialState: initial.initialState,
		});
	}, []);

	useEffect(() => {
		if (options.columns !== lastColumnsRef.current) {
			lastColumnsRef.current = options.columns;
			api.setColumns(options.columns);
		}
	}, [api, options.columns]);

	useEffect(() => {
		if (options.datasource !== lastDatasourceRef.current || options.blockSize !== initialOptionsRef.current.blockSize) {
			lastDatasourceRef.current = options.datasource;
			api.setServerDatasource(options.datasource, options.blockSize);
		}
	}, [api, options.datasource, options.blockSize]);

	useEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return api;
}
