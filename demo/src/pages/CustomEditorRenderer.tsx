import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { CustomShowcaseRow, GridView } from '../components/GridShared';

interface CustomEditorRendererProps {
	store: GridStore<CustomShowcaseRow>;
	controller: ClientRowModelController<CustomShowcaseRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CustomEditorRenderer({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: CustomEditorRendererProps) {
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
