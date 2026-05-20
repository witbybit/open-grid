import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';

interface CalculationsArenaProps {
	store: GridStore<PerformanceRow>;
	controller: ClientRowModelController<PerformanceRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
}

export default function CalculationsArena({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	onCellValueChanged,
}: CalculationsArenaProps) {
	return (
		<GridProvider store={store}>
			<GridView
				rowHeights={rowHeightsMap}
				onCellValueChanged={onCellValueChanged}
				clientController={controller}
				editTrigger={editTrigger}
				arrowKeyNavigationEdit={arrowKeyNavigationEdit}
			/>
		</GridProvider>
	);
}
