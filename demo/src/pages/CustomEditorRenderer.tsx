import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { CustomShowcaseRow, GridView } from '../components/GridShared';

interface CustomEditorRendererProps {
	store: GridStore<CustomShowcaseRow>;
	controller: ClientRowModelController<CustomShowcaseRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
}

export default function CustomEditorRenderer({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	onCellValueChanged,
}: CustomEditorRendererProps) {
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
