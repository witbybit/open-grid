import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';

interface CalculationsArenaProps {
	store: GridStore<PerformanceRow>;
	controller: ClientRowModelController<PerformanceRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CalculationsArena({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: CalculationsArenaProps) {
	return (
		<GridProvider store={store}>
			<GridView
				store={store}
				pinLeftColumns={pinLeftColumns}
				pinRightColumns={pinRightColumns}
				onCellValueChanged={onCellValueChanged}
				clientController={controller}
				editTrigger={editTrigger}
				arrowKeyNavigationEdit={arrowKeyNavigationEdit}
			/>
		</GridProvider>
	);
}
