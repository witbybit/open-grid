import type { GridQueryModel } from './query/GridQueryModel.js';
import type { InternalGridState } from './state/GridState.js';

function freezeCopy<T extends object>(value: T): Readonly<T> {
	return Object.freeze({ ...value });
}

function cloneValue<T>(value: T): T {
	if (Array.isArray(value)) {
		return Object.freeze(value.map((entry) => cloneValue(entry))) as T;
	}
	if (value instanceof Date) {
		return new Date(value.getTime()) as T;
	}
	if (value && typeof value === 'object') {
		const clone: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			clone[key] = cloneValue(entry);
		}
		return Object.freeze(clone) as T;
	}
	return value;
}

function cloneSortModel(state: Pick<InternalGridState<unknown>, 'sortModel'>): InternalGridState<unknown>['sortModel'] {
	return state.sortModel ? (Object.freeze(state.sortModel.map((entry) => freezeCopy(entry))) as typeof state.sortModel) : null;
}

function cloneQueryModel(queryModel: GridQueryModel | null): GridQueryModel | null {
	return queryModel ? (cloneValue(queryModel) as GridQueryModel) : null;
}

export function createAsyncRowModelQuerySnapshot<TRowData>(
	state: Pick<InternalGridState<TRowData>, 'sortModel' | 'filterModel' | 'quickFilterModel' | 'queryModel'>
): Pick<InternalGridState<TRowData>, 'sortModel' | 'filterModel' | 'quickFilterModel' | 'queryModel'> {
	return {
		sortModel: cloneSortModel(state as Pick<InternalGridState<unknown>, 'sortModel'>) as InternalGridState<TRowData>['sortModel'],
		filterModel: state.filterModel ? (cloneValue(state.filterModel) as InternalGridState<TRowData>['filterModel']) : null,
		quickFilterModel: state.quickFilterModel ? (cloneValue(state.quickFilterModel) as InternalGridState<TRowData>['quickFilterModel']) : null,
		queryModel: cloneQueryModel(state.queryModel ?? null) as InternalGridState<TRowData>['queryModel'],
	};
}
