import { GridApi, GridNavigationHandle, GridNavigationOptions, GridStateSnapshot, registerGridNavigation } from '@open-grid/core';
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GridApiContext } from './gridContext.js';

export function useGridApi<TRowData = unknown>(): GridApi<TRowData> {
	const context = useContext(GridApiContext);

	if (!context) {
		throw new Error('useGridApi must be used within a GridProvider');
	}

	return context as unknown as GridApi<TRowData>;
}

/**
 * Custom selector hook utilizing useSyncExternalStore for targeted re-renders.
 */
export function useGridSelector<T, TRowData = unknown>(
	selector: (state: GridStateSnapshot<TRowData>) => T,
	isEqual?: (left: T, right: T) => boolean
): T {
	return useGridSelectorWithEquality(selector, isEqual);
}

function useGridSelectorWithEquality<T, TRowData = unknown>(
	selector: (state: GridStateSnapshot<TRowData>) => T,
	isEqual: (left: T, right: T) => boolean = Object.is
): T {
	const api = useGridApi<TRowData>();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const isEqualRef = useRef(isEqual);
	isEqualRef.current = isEqual;

	const updateGenRef = useRef(0);
	const cacheRef = useRef<{ gen: number; value: T }>({ gen: -1, value: undefined as T });

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return api.subscribe(() => {
				updateGenRef.current++;
				onStoreChange();
			});
		},
		[api]
	);

	const getSnapshot = useCallback(() => {
		const currentGen = updateGenRef.current;
		const cache = cacheRef.current;

		if (cache.gen === currentGen) {
			return cache.value;
		}

		const snapshot = api.getStateSnapshot();
		const value = selectorRef.current(snapshot);

		if (cache.gen !== -1 && isEqualRef.current(cache.value, value)) {
			cacheRef.current = { gen: currentGen, value: cache.value };
			return cache.value;
		}

		cacheRef.current = { gen: currentGen, value };
		return value;
	}, [api]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Targeted selector for individual keys to achieve optimal performance.
 * The `key` must be a valid key of GridStateSnapshot so the component only re-renders
 * when that specific slice changes.
 */
export function useGridKeySelector<T, TRowData = unknown>(
	key: keyof GridStateSnapshot<TRowData>,
	selector: (state: GridStateSnapshot<TRowData>) => T,
	isEqual?: (left: T, right: T) => boolean
): T {
	return useGridKeySelectorWithEquality(key, selector, isEqual);
}

function useGridKeySelectorWithEquality<T, TRowData = unknown>(
	key: keyof GridStateSnapshot<TRowData>,
	selector: (state: GridStateSnapshot<TRowData>) => T,
	isEqual: (left: T, right: T) => boolean = Object.is
): T {
	const api = useGridApi<TRowData>();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const cacheRef = useRef<T | undefined>(undefined);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return api.subscribeToSnapshotSelector(
				[key],
				(snapshot) => selectorRef.current(snapshot),
				(value) => {
					cacheRef.current = value;
					onStoreChange();
				},
				isEqual
			);
		},
		[api, isEqual, key]
	);

	const getSnapshot = useCallback(() => {
		if (cacheRef.current !== undefined) {
			return cacheRef.current;
		}
		const value = selectorRef.current(api.getStateSnapshot());
		cacheRef.current = value;
		return value;
	}, [api]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Controller integration hook mapping standard interaction event handlers.
 */
export function useGridNavigationController<TRowData = unknown>(options: GridNavigationOptions = {}, enabled = true) {
	const api = useGridApi<TRowData>();
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const [controller, setController] = useState<GridNavigationHandle | null>(null);

	useEffect(() => {
		if (!enabled) {
			setController(null);
			return;
		}
		const nav = registerGridNavigation<TRowData>(api, {
			onCellValueChanged: (rowId, colField, val) => optionsRef.current.onCellValueChanged?.(rowId, colField, val),
			get editTrigger() {
				return optionsRef.current.editTrigger;
			},
			get arrowKeyNavigationEdit() {
				return optionsRef.current.arrowKeyNavigationEdit;
			},
		});
		setController(nav);

		return () => {
			nav.dispose();
			setController(null);
		};
	}, [api, enabled]);

	return controller;
}
