import React from 'react';
import { GridStore, ServerRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';

interface InfiniteServerScrollProps {
	store: GridStore<PerformanceRow>;
	controller: ServerRowModelController<PerformanceRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function InfiniteServerScroll({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: InfiniteServerScrollProps) {
	return (
		<GridProvider store={store}>
			<GridView
				store={store}
				pinLeftColumns={pinLeftColumns}
				pinRightColumns={pinRightColumns}
				onCellValueChanged={() => {}}
				serverController={controller}
				editTrigger={editTrigger}
				arrowKeyNavigationEdit={arrowKeyNavigationEdit}
			/>
		</GridProvider>
	);
}
