import { useEffect, useMemo, useRef, useState } from 'react';
import { ClientRowModelController, ServerRowModelController, GridStore, type GridApi } from '@open-grid/core';

import type { ClientGridOptions, ServerGridOptions } from './types.js';
import { createGridApiFacade } from './gridApiFacade.js';

export interface GridInstance<TRowData> {
	store: GridStore<TRowData>;
	api: GridApi<TRowData>;
}

function buildColumnWidths<TRowData>(columns: Array<{ field: string; width?: number }>) {
	return columns.reduce<Record<string, number>>((acc, col) => {
		if (col.width != null) acc[col.field] = col.width;
		return acc;
	}, {});
}

export function useClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridInstance<TRowData> {
	const { rows, columns, getRowId, initialState } = options;

	const initialConfigRef = useRef({ columns, getRowId, initialState });
	const [store] = useState(() => {
		const initialConfig = initialConfigRef.current;
		return new GridStore<TRowData>({
			rowHeights: {},
			columnWidths: buildColumnWidths(initialConfig.columns),
			columns: initialConfig.columns,
			getRowId: initialConfig.getRowId,
			...initialConfig.initialState,
		});
	});

	const api = useMemo(() => createGridApiFacade(store), [store]);
	const controllerRef = useRef<ClientRowModelController<TRowData> | null>(null);
	const didMountRowsRef = useRef(false);

	useEffect(() => {
		const controller = new ClientRowModelController<TRowData>(store, {
			rows,
			columns,
		});
		controllerRef.current = controller;

		return () => {
			controllerRef.current = null;
			controller.dispose?.();
		};
	}, [store]);

	useEffect(() => {
		store.setState({ columns });
	}, [store, columns]);

	useEffect(() => {
		if (!didMountRowsRef.current) {
			didMountRowsRef.current = true;
			return;
		}
		controllerRef.current?.setRows(rows);
	}, [rows]);

	return { store, api };
}

export function useServerGrid<TRowData>(options: ServerGridOptions<TRowData>): GridInstance<TRowData> {
	const { datasource, columns, blockSize = 100, getRowId, initialState } = options;

	const initialConfigRef = useRef({ columns, getRowId, initialState });
	const [store] = useState(() => {
		const initialConfig = initialConfigRef.current;
		return new GridStore<TRowData>({
			rowHeights: {},
			columnWidths: buildColumnWidths(initialConfig.columns),
			columns: initialConfig.columns,
			getRowId: initialConfig.getRowId,
			...initialConfig.initialState,
		});
	});

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
	}, [store, datasource, blockSize, getRowId]);

	useEffect(() => {
		store.setState({ columns });
	}, [store, columns]);

	return { store, api };
}
