import { GridApi, GridNavigationHandle, GridNavigationOptions, GridState, registerGridNavigation } from '@open-grid/core';
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GridApiContext } from './OpenGrid';

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
export function useGridSelector<T, TRowData = unknown>(selector: (state: GridState<TRowData>) => T, isEqual?: (left: T, right: T) => boolean): T {
	return useGridSelectorWithEquality(selector, isEqual);
}

function useGridSelectorWithEquality<T, TRowData = unknown>(
	selector: (state: GridState<TRowData>) => T,
	isEqual: (left: T, right: T) => boolean = Object.is
): T {
	const api = useGridApi<TRowData>();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const isEqualRef = useRef(isEqual);
	isEqualRef.current = isEqual;
	const snapshotRef = useRef<{ hasValue: boolean; value: T }>({ hasValue: false, value: undefined as T });

	const getSnapshot = useCallback(() => {
		const next = selectorRef.current(api.getState());
		const previous = snapshotRef.current;
		if (previous.hasValue && isEqualRef.current(previous.value, next)) {
			return previous.value;
		}
		snapshotRef.current = { hasValue: true, value: next };
		return next;
	}, [api]);

	return useSyncExternalStore(api.subscribe, getSnapshot, getSnapshot);
}

/**
 * Targeted selector for individual keys to achieve optimal performance.
 * The `key` must be a valid key of GridState — this drives fine-grained subscriptions
 * so the component only re-renders when that specific slice changes.
 */
export function useGridKeySelector<T, TRowData = unknown>(
	key: keyof GridState<TRowData>,
	selector: (state: GridState<TRowData>) => T,
	isEqual?: (left: T, right: T) => boolean
): T {
	return useGridKeySelectorWithEquality(key, selector, isEqual);
}

function useGridKeySelectorWithEquality<T, TRowData = unknown>(
	key: keyof GridState<TRowData>,
	selector: (state: GridState<TRowData>) => T,
	isEqual: (left: T, right: T) => boolean = Object.is
): T {
	const api = useGridApi<TRowData>();

	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const isEqualRef = useRef(isEqual);
	isEqualRef.current = isEqual;
	const snapshotRef = useRef<{ hasValue: boolean; value: T }>({ hasValue: false, value: undefined as T });

	const subscribe = useCallback((onStoreChange: () => void) => api.subscribeToKey(key, onStoreChange), [api, key]);

	const getSnapshot = useCallback(() => {
		const next = selectorRef.current(api.getState());
		const previous = snapshotRef.current;
		if (previous.hasValue && isEqualRef.current(previous.value, next)) {
			return previous.value;
		}
		snapshotRef.current = { hasValue: true, value: next };
		return next;
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
