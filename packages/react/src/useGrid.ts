import { useEffect, useMemo } from 'react';
import { ClientRowModelController, ServerRowModelController, GridStore, type GridApi } from '@open-grid/core';

import type { ClientGridOptions, ServerGridOptions } from './types';
import { createGridApiFacade } from './gridApiFacade';

export interface ReactGridInstance<TRowData> {
	store: GridStore<TRowData>;
	api: GridApi<TRowData>;
}

function buildColumnWidths<TRowData>(columns: Array<{ field: string; width?: number }>) {
	return columns.reduce<Record<string, number>>((acc, col) => {
		if (col.width != null) acc[col.field] = col.width;
		return acc;
	}, {});
}

export function useClientGrid<TRowData>(options: ClientGridOptions<TRowData>): ReactGridInstance<TRowData> {
	const { rows, columns, getRowId, initialState } = options;

	const store = useMemo(() => {
		return new GridStore<TRowData>({
			rowHeights: {},
			columnWidths: buildColumnWidths(columns),
			columns,
			getRowId,
			...initialState,
		});
	}, [columns, getRowId, initialState]);

	const api = useMemo(() => createGridApiFacade(store), [store]);

	useEffect(() => {
		const controller = new ClientRowModelController<TRowData>(store, {
			rows,
			columns,
		});

		return () => {
			controller.dispose?.();
		};
	}, [store, rows, columns]);

	useEffect(() => {
		store.setState({ columns });
	}, [store, columns]);

	return { store, api };
}

export function useServerGrid<TRowData>(options: ServerGridOptions<TRowData>): ReactGridInstance<TRowData> {
	const { datasource, columns, blockSize = 100, getRowId, initialState } = options;

	const store = useMemo(() => {
		return new GridStore<TRowData>({
			rowHeights: {},
			columnWidths: buildColumnWidths(columns),
			columns,
			getRowId,
			...initialState,
		});
	}, [columns, getRowId, initialState]);

	const api = useMemo(() => createGridApiFacade(store), [store]);

	useEffect(() => {
		const controller = new ServerRowModelController<TRowData>(store, {
			datasource,
			blockSize,
			columns,
			getRowId,
		});

		return () => {
			controller.dispose?.();
		};
	}, [store, datasource, blockSize, columns, getRowId]);

	useEffect(() => {
		store.setState({ columns });
	}, [store, columns]);

	return { store, api };
}
