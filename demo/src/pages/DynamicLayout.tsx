import React from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';

interface DynamicLayoutProps {
	store: GridStore<PerformanceRow>;
	controller: ClientRowModelController<PerformanceRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	compactLayout: 'compact' | 'normal' | 'spacious';
}

export default function DynamicLayout({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	onCellValueChanged,
	compactLayout,
}: DynamicLayoutProps) {
	return (
		<GridProvider store={store}>
			<GridView
				rowHeights={{}}
				defaultHeight={rowHeightsMap[compactLayout]}
				onCellValueChanged={onCellValueChanged}
				clientController={controller}
				editTrigger={editTrigger}
				arrowKeyNavigationEdit={arrowKeyNavigationEdit}
			/>
		</GridProvider>
	);
}
