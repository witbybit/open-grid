import { createContext, useContext, useEffect, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { GridApi } from '@open-grid/core/next';

// The context holds an API for an unknown row type; consumers re-narrow via the generic hook.
// `any` (not `unknown`) is required because GridApi<TRow> is invariant in TRow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GridApiContext = createContext<GridApi<any> | null>(null);

export interface GridApiProviderProps<TRow> {
	readonly api: GridApi<TRow>;
	readonly children: ReactNode;
}

/**
 * Provides the public {@link GridApi} to descendants (ARCHITECTURE.md "React adapter exposes
 * GridApi, not GridStore"). The only thing the React tree shares is the public API.
 */
export function GridApiProvider<TRow>({ api, children }: GridApiProviderProps<TRow>) {
	return <GridApiContext.Provider value={api}>{children}</GridApiContext.Provider>;
}

/** Read the grid API from context. Throws when used outside a {@link GridApiProvider}. */
export function useGridApi<TRow>(): GridApi<TRow> {
	const api = useContext(GridApiContext);
	if (!api) {
		throw new Error('useGridApi must be used within a GridApiProvider');
	}
	return api as GridApi<TRow>;
}

/**
 * Subscribe to kernel events and project a value out of the API. Re-renders the consumer whenever
 * the kernel publishes (a commit). The renderer consumes the API only — it never recomputes
 * business state (R12).
 */
export function useGridSelector<TRow, T>(selector: (api: GridApi<TRow>) => T): T {
	const api = useGridApi<TRow>();
	const [, force] = useReducer((n: number) => n + 1, 0);
	useEffect(() => api.subscribe(() => force()), [api]);
	return selector(api);
}
