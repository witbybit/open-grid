import React from 'react';
import { GridStore, ServerRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';
import { RecycledGridViewport } from '../components/RecycledGridViewport';

interface InfiniteServerScrollProps {
	store: GridStore<PerformanceRow>;
	controller: ServerRowModelController<PerformanceRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	use2DRecycled?: boolean;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function InfiniteServerScroll({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	use2DRecycled = false,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: InfiniteServerScrollProps) {
	return (
		<GridProvider store={store}>
			{use2DRecycled ? (
				<RecycledGridViewport
					pinLeftColumns={pinLeftColumns}
					pinRightColumns={pinRightColumns}
					serverController={controller}
					editTrigger={editTrigger}
					arrowKeyNavigationEdit={arrowKeyNavigationEdit}
				/>
			) : (
				<GridView
					rowHeights={rowHeightsMap}
					onCellValueChanged={() => {}}
					serverController={controller}
					editTrigger={editTrigger}
					arrowKeyNavigationEdit={arrowKeyNavigationEdit}
				/>
			)}
		</GridProvider>
	);
}
