import { GridProvider } from './gridContext.js';
import { GridView, type GridViewProps } from './GridView.js';
import { useServerGrid } from './useGrid.js';
import type { ServerGridOptions } from './types.js';

export type ServerGridProps<TRowData = unknown> = Omit<GridViewProps<TRowData>, 'api'> & ServerGridOptions<TRowData> & {};

export function ServerGrid<TRowData = unknown>({
	datasource,
	columns,
	columnTypes,
	styleRules,
	blockSize,
	getRowId,
	initialState,
	persistence,
	rowOverscanPx,
	colBuffer,
	overscanAdaptive,
	runtimeLimits,
	...viewProps
}: ServerGridProps<TRowData>) {
	const api = useServerGrid<TRowData>({
		initial: {
			getRowId,
			initialState,
			persistence,
			rowOverscanPx,
			colBuffer,
			overscanAdaptive,
			runtimeLimits,
		},
		live: {
			datasource,
			columns,
			blockSize,
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
