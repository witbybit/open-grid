import { createContext } from 'react';
import type { GridApi } from '@open-grid/core';
import type { ReactNode } from 'react';

export const GridApiContext = createContext<GridApi<unknown> | null>(null);

export interface GridApiProviderProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	children: ReactNode;
}

export function GridApiProvider<TRowData = unknown>({ api, children }: GridApiProviderProps<TRowData>) {
	return <GridApiContext.Provider value={api as unknown as GridApi<unknown>}>{children}</GridApiContext.Provider>;
}
