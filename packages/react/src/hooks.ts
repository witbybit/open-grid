import type { GridApi } from '@open-grid/core';
import { useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import { GridApiContext } from './gridContext.js';

export function useGridApi<TRow = unknown>(): GridApi<TRow> {
	const context = useContext(GridApiContext);

	if (!context) {
		throw new Error('useGridApi must be used within a GridApiProvider');
	}

	return context as unknown as GridApi<TRow>;
}

export function useGridSelector<TRow = unknown, T = unknown>(selector: (api: GridApi<TRow>) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
	const api = useGridApi<TRow>();

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

		const value = selectorRef.current(api as GridApi<TRow>);

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
 * Targeted selector for a specific slice of grid state.
 * Currently delegates to useGridSelector; will be refined when domain-specific
 * subscriptions are wired into GridApi.
 */
export function useGridKeySelector<TRow = unknown, T = unknown>(selector: (api: GridApi<TRow>) => T, isEqual?: (a: T, b: T) => boolean): T {
	return useGridSelector<TRow, T>(selector, isEqual);
}
