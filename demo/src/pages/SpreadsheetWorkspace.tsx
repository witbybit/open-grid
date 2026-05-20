import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { SpreadsheetRow, GridView } from '../components/GridShared';

interface SpreadsheetWorkspaceProps {
	store: GridStore<SpreadsheetRow>;
	controller: ClientRowModelController<SpreadsheetRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
}

export default function SpreadsheetWorkspace({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	onCellValueChanged,
}: SpreadsheetWorkspaceProps) {
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
