import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { CustomShowcaseRow, GridView } from '../components/GridShared';
import { RecycledGridViewport } from '../components/RecycledGridViewport';

interface CustomEditorRendererProps {
	store: GridStore<CustomShowcaseRow>;
	controller: ClientRowModelController<CustomShowcaseRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	use2DRecycled?: boolean;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CustomEditorRenderer({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	onCellValueChanged,
	use2DRecycled = false,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: CustomEditorRendererProps) {
	return (
		<GridProvider store={store}>
			{use2DRecycled ? (
				<RecycledGridViewport
					pinLeftColumns={pinLeftColumns}
					pinRightColumns={pinRightColumns}
					onCellValueChanged={onCellValueChanged}
					editTrigger={editTrigger}
					arrowKeyNavigationEdit={arrowKeyNavigationEdit}
				/>
			) : (
				<GridView
					rowHeights={rowHeightsMap}
					onCellValueChanged={onCellValueChanged}
					clientController={controller}
					editTrigger={editTrigger}
					arrowKeyNavigationEdit={arrowKeyNavigationEdit}
				/>
			)}
		</GridProvider>
	);
}
