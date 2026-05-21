import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';
import { RecycledGridViewport } from '../components/RecycledGridViewport';

interface DynamicLayoutProps {
	store: GridStore<PerformanceRow>;
	controller: ClientRowModelController<PerformanceRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	compactLayout: 'compact' | 'normal' | 'spacious';
	use2DRecycled?: boolean;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function DynamicLayout({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	onCellValueChanged,
	compactLayout,
	use2DRecycled = false,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: DynamicLayoutProps) {
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
					rowHeights={{}}
					defaultHeight={rowHeightsMap[compactLayout]}
					onCellValueChanged={onCellValueChanged}
					clientController={controller}
					editTrigger={editTrigger}
					arrowKeyNavigationEdit={arrowKeyNavigationEdit}
				/>
			)}
		</GridProvider>
	);
}
