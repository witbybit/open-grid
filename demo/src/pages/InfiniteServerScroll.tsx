import React from 'react';
import { GridStore, ServerRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';

interface InfiniteServerScrollProps {
	store: GridStore<PerformanceRow>;
	controller: ServerRowModelController<PerformanceRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
}

export default function InfiniteServerScroll({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
}: InfiniteServerScrollProps) {
	return (
		<GridProvider store={store}>
			<GridView
				rowHeights={rowHeightsMap}
				onCellValueChanged={() => {}}
				serverController={controller}
				editTrigger={editTrigger}
				arrowKeyNavigationEdit={arrowKeyNavigationEdit}
			/>
		</GridProvider>
	);
}
