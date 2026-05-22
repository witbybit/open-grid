import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { SpreadsheetRow, GridView } from '../components/GridShared';

interface SpreadsheetWorkspaceProps {
	store: GridStore<SpreadsheetRow>;
	controller: ClientRowModelController<SpreadsheetRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function SpreadsheetWorkspace({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: SpreadsheetWorkspaceProps) {
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
