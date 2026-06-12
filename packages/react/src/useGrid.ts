import { createClientGrid, createServerGrid, type GridApi } from '@open-grid/core';
import { useEffect, useInsertionEffect, useMemo, useRef } from 'react';

import type {
	ClientGridLifecycleOptions,
	ServerGridLifecycleOptions,
	ClientGridInitialOptions,
	ClientGridLiveOptions,
	ServerGridInitialOptions,
	ServerGridLiveOptions,
} from './types.js';
import { resolveColumnTypes } from './resolveColumnTypes.js';
import { compileStyleRules } from './styleRules.js';

function createClientInitialState<TRowData>(initial: ClientGridInitialOptions<TRowData>) {
	return {
		rowOverscanPx: initial.rowOverscanPx,
		overscanAdaptive: initial.overscanAdaptive,
		colBuffer: initial.colBuffer,
		runtimeLimits: initial.runtimeLimits,
		...initial.initialState,
	};
}

function createServerInitialState<TRowData>(initial: ServerGridInitialOptions<TRowData>) {
	return {
		rowOverscanPx: initial.rowOverscanPx,
		overscanAdaptive: initial.overscanAdaptive,
		colBuffer: initial.colBuffer,
		runtimeLimits: initial.runtimeLimits,
		...initial.initialState,
	};
}

export function useClientGrid<TRowData>(options: ClientGridLifecycleOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options.initial);
	const lastColumnsRef = useRef(options.live.columns);

	const api = useMemo(() => {
		const initial = initialOptionsRef.current;
		const live = options.live;
		return createClientGrid({
			rows: live.rows,
			columns: resolveColumnTypes(live.columns, live.columnTypes),
			getRowId: initial.getRowId,
			persistence: initial.persistence,
			rowSelection: initial.rowSelection,
			initialState: createClientInitialState(initial),
		});
	}, []);

	useEffect(() => {
		if (options.live.columns === lastColumnsRef.current) return;
		lastColumnsRef.current = options.live.columns;
		api.setColumns(resolveColumnTypes(options.live.columns, options.live.columnTypes));
	}, [api, options.live.columns, options.live.columnTypes]);

	useEffect(() => {
		api.setRows(options.live.rows);
	}, [api, options.live.rows]);

	useEffect(() => {
		if (!options.live.styleRules || options.live.styleRules.length === 0) {
			api.setStyleSlots(undefined);
			return;
		}
		api.setStyleSlots(compileStyleRules(options.live.styleRules));
	}, [api, options.live.styleRules]);

	useInsertionEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return api;
}

export function useServerGrid<TRowData>(options: ServerGridLifecycleOptions<TRowData>): GridApi<TRowData> {
	const initialOptionsRef = useRef(options.initial);
	const lastServerColumnsRef = useRef(options.live.columns);
	const didMountServerOptionsRef = useRef(false);

	const api = useMemo(() => {
		const initial = initialOptionsRef.current;
		const live = options.live;
		return createServerGrid({
			datasource: live.datasource,
			columns: resolveColumnTypes(live.columns, live.columnTypes),
			blockSize: live.blockSize,
			getRowId: initial.getRowId,
			persistence: initial.persistence,
			initialState: createServerInitialState(initial),
		});
	}, []);

	useEffect(() => {
		if (options.live.columns === lastServerColumnsRef.current) return;
		lastServerColumnsRef.current = options.live.columns;
		api.setColumns(resolveColumnTypes(options.live.columns, options.live.columnTypes));
	}, [api, options.live.columns, options.live.columnTypes]);

	useEffect(() => {
		if (!didMountServerOptionsRef.current) {
			didMountServerOptionsRef.current = true;
			return;
		}
		api.setServerDatasource(options.live.datasource, options.live.blockSize);
	}, [api, options.live.datasource, options.live.blockSize]);

	useEffect(() => {
		if (!options.live.styleRules || options.live.styleRules.length === 0) {
			api.setStyleSlots(undefined);
			return;
		}
		api.setStyleSlots(compileStyleRules(options.live.styleRules));
	}, [api, options.live.styleRules]);

	useInsertionEffect(() => {
		return () => {
			api.destroy();
		};
	}, [api]);

	return api;
}
