import { GridProvider } from './gridContext.js';
import { GridView, type GridViewProps } from './GridView.js';
import { useClientGrid } from './useGrid.js';
import type { ClientGridOptions } from './types.js';

export type ClientGridProps<TRowData = unknown> = Omit<GridViewProps<TRowData>, 'api'> &
	ClientGridOptions<TRowData> & {
		detailRowHeight?: number;
	};

export function ClientGrid<TRowData = unknown>({
	rows,
	columns,
	columnTypes,
	styleRules,
	getRowId,
	initialState,
	persistence,
	rowOverscanPx,
	colBuffer,
	overscanAdaptive,
	runtimeLimits,
	detailRowHeight,
	...viewProps
}: ClientGridProps<TRowData>) {
	const mergedInitialState = detailRowHeight != null ? { detailRowHeight, ...initialState } : initialState;
	const api = useClientGrid<TRowData>({
		initial: {
			getRowId,
			initialState: mergedInitialState,
			persistence,
			rowOverscanPx,
			colBuffer,
			overscanAdaptive,
			runtimeLimits,
		},
		live: {
			rows,
			columns,
			columnTypes,
			styleRules,
		},
	});

	return (
		<GridProvider api={api}>
			<GridView<TRowData> {...viewProps} api={api} />
		</GridProvider>
	);
}
