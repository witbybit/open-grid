import React from 'react';
import { OpenGrid } from '@open-grid/react';
import { ServerRowModelController } from '@open-grid/core';
import { PerformanceRow } from './GridShared';

export interface RecycledGridViewportProps {
	pinLeftColumns?: number;
	pinRightColumns?: number;
	className?: string;
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	serverController?: ServerRowModelController<PerformanceRow>;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

export function RecycledGridViewport({
	pinLeftColumns = 0,
	pinRightColumns = 0,
	className = '',
	onCellValueChanged,
	editTrigger = 'doubleClick',
	arrowKeyNavigationEdit = false,
}: RecycledGridViewportProps) {
	return (
		<div className={`w-full h-full ${className}`}>
			<OpenGrid
				pinLeftColumns={pinLeftColumns}
				pinRightColumns={pinRightColumns}
				enableNavigation={true}
				navigationOptions={{
					editTrigger,
					arrowKeyNavigationEdit,
					onCellValueChanged,
				}}
			/>
		</div>
	);
}
