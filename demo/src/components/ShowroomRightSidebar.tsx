import React from 'react';
import { GridStore } from '@open-grid/core';
import { StateInspector, LiveEventLogPanel } from './RightSidebar';
import {
	ViewportPanel,
	SortFilterPanel,
	AccessibilityPanel,
	DeveloperPanel,
	KeyboardShortcutsPanel,
} from './ShowroomControls';

interface ShowroomRightSidebarProps {
	rightSidebarCollapsed: boolean;
	activeStore: GridStore<any>;
	pinLeftColumns: number;
	setPinLeftColumns: (n: number) => void;
	pinRightColumns: number;
	setPinRightColumns: (n: number) => void;
	activePage: 'perf' | 'server' | 'ranges' | 'editors' | 'layout' | 'skins' | 'dashboard' | 'gantt';
	massiveColumns: boolean;
	setMassiveColumns: (b: boolean) => void;
	sortField: string;
	setSortField: (s: string) => void;
	statusFilter: 'All' | 'Active' | 'Pending' | 'Inactive';
	setStatusFilter: (s: 'All' | 'Active' | 'Pending' | 'Inactive') => void;
	sortDirection: 'asc' | 'desc';
	setSortDirection: (d: 'asc' | 'desc') => void;
	editTrigger: 'singleClick' | 'doubleClick';
	setEditTrigger: (t: 'singleClick' | 'doubleClick') => void;
	arrowKeyNavigationEdit: boolean;
	setArrowKeyNavigationEdit: (b: boolean) => void;
	perfController: any;
	serverController: any;
	spreadsheetController: any;
	customController: any;
	skinsController: any;
	dashboardController: any;
	ganttController: any;
}

export default function ShowroomRightSidebar({
	rightSidebarCollapsed,
	activeStore,
	pinLeftColumns,
	setPinLeftColumns,
	pinRightColumns,
	setPinRightColumns,
	activePage,
	massiveColumns,
	setMassiveColumns,
	sortField,
	setSortField,
	statusFilter,
	setStatusFilter,
	sortDirection,
	setSortDirection,
	editTrigger,
	setEditTrigger,
	arrowKeyNavigationEdit,
	setArrowKeyNavigationEdit,
	perfController,
	serverController,
	spreadsheetController,
	customController,
	skinsController,
	dashboardController,
	ganttController,
}: ShowroomRightSidebarProps) {
	return (
		<div
			className={`${rightSidebarCollapsed ? 'w-0 p-0 border-0 overflow-hidden' : 'w-72 p-4 border border-slate-900/50'} shrink-0 flex flex-col gap-4 overflow-y-auto pl-1 glass-panel rounded-xl transition-all duration-300 ease-in-out`}
		>
			{/* Coordinate Inspector */}
			<StateInspector store={activeStore} />

			{/* Viewport Settings Panel */}
			<ViewportPanel
				pinLeftColumns={pinLeftColumns}
				setPinLeftColumns={setPinLeftColumns}
				pinRightColumns={pinRightColumns}
				setPinRightColumns={setPinRightColumns}
				activePage={activePage}
				massiveColumns={massiveColumns}
				setMassiveColumns={setMassiveColumns}
			/>

			{/* Sorting and Filtering controls */}
			<SortFilterPanel
				activeStore={activeStore}
				sortField={sortField}
				setSortField={setSortField}
				statusFilter={statusFilter}
				setStatusFilter={setStatusFilter}
				sortDirection={sortDirection}
				setSortDirection={setSortDirection}
			/>

			{/* Grid Accessibility panel */}
			<AccessibilityPanel
				editTrigger={editTrigger}
				setEditTrigger={setEditTrigger}
				arrowKeyNavigationEdit={arrowKeyNavigationEdit}
				setArrowKeyNavigationEdit={setArrowKeyNavigationEdit}
			/>

			{/* Live core event log panel */}
			<LiveEventLogPanel store={activeStore} />

			{/* Developer Panel */}
			<DeveloperPanel
				activePage={activePage}
				perfController={perfController}
				serverController={serverController}
				spreadsheetController={spreadsheetController}
				customController={customController}
				skinsController={skinsController}
				dashboardController={dashboardController}
				ganttController={ganttController}
			/>

			{/* Keyboard Shortcuts guide */}
			<KeyboardShortcutsPanel />
		</div>
	);
}
