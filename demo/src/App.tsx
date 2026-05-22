import React, { useState, useEffect, useMemo } from 'react';
import { FilterModel, SortModel } from '@open-grid/core';
import { Layout } from 'lucide-react';

import ShowroomHeader from './components/ShowroomHeader';
import ShowroomLeftSidebar from './components/ShowroomLeftSidebar';
import ShowroomTitleBanner from './components/ShowroomTitleBanner';
import ShowroomRightSidebar from './components/ShowroomRightSidebar';

import CalculationsArena from './pages/CalculationsArena';
import InfiniteServerScroll from './pages/InfiniteServerScroll';
import SpreadsheetWorkspace from './pages/SpreadsheetWorkspace';
import CustomEditorRenderer from './pages/CustomEditorRenderer';
import DynamicLayout from './pages/DynamicLayout';
import HeadlessSkinsPlayground from './pages/HeadlessSkinsPlayground';
import RealtimeDashboard from './pages/RealtimeDashboard';
import { useShowroomStores } from './hooks/useShowroomStores';

export default function App() {
	// Active Page Routing State via URL Hash Routing
	const [activePage, setActivePage] = useState<'perf' | 'server' | 'ranges' | 'editors' | 'layout' | 'skins' | 'dashboard'>('perf');

	// Collapsible Sidebars State
	const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
	const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

	// Pinning & Column Scale State
	const [pinLeftColumns, setPinLeftColumns] = useState<number>(1);
	const [pinRightColumns, setPinRightColumns] = useState<number>(1);
	const [massiveColumns, setMassiveColumns] = useState<boolean>(false);

	useEffect(() => {
		const handleHashChange = () => {
			const hash = window.location.hash.slice(1);
			if (['perf', 'server', 'ranges', 'editors', 'layout', 'skins', 'dashboard'].includes(hash)) {
				setActivePage(hash as any);
			}
		};
		window.addEventListener('hashchange', handleHashChange);

		// Set default hash or resolve current deep-link hash
		if (window.location.hash) {
			handleHashChange();
		} else {
			window.location.hash = 'perf';
		}

		return () => window.removeEventListener('hashchange', handleHashChange);
	}, []);

	// Preserve Accessibility settings
	const [editTrigger, setEditTrigger] = useState<'singleClick' | 'doubleClick'>('doubleClick');
	const [arrowKeyNavigationEdit, setArrowKeyNavigationEdit] = useState<boolean>(false);

	// Sorting & Filtering variables
	const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Pending' | 'Inactive'>('All');
	const [sortField, setSortField] = useState<string>('id');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

	// Dynamic Layout properties (Page 5)
	const [compactLayout, setCompactLayout] = useState<'compact' | 'normal' | 'spacious'>('normal');
	const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
		id: true,
		name: true,
		price: true,
		quantity: true,
		subtotal: true,
		status: true,
	});

	// Column height selection mapping
	const rowHeightsMap = {
		compact: 30,
		normal: 38,
		spacious: 48,
	};

	// Central showroom stores custom hook
	const stores = useShowroomStores({ massiveColumns, visibleColumns });

	const {
		perfStore,
		perfController,
		runBulkCalculationTest,
		handlePerfCellValueChanged,
		serverStore,
		serverController,
		spreadsheetStore,
		spreadsheetController,
		applySpreadsheetRangeAction,
		handleSpreadsheetCellValueChanged,
		customStore,
		customController,
		handleCustomCellValueChanged,
		layoutStore,
		layoutController,
		handleLayoutCellValueChanged,
		layoutColumnsFull,
		skinsStore,
		skinsController,
		handleSkinsCellValueChanged,
		dashboardStore,
		dashboardController,
		handleDashboardCellValueChanged,
	} = stores;

	const toggleColumnVisibility = (field: string) => {
		const nextVisible = { ...visibleColumns, [field]: !visibleColumns[field] };
		const visibleCount = Object.values(nextVisible).filter(Boolean).length;
		if (visibleCount > 0) {
			setVisibleColumns(nextVisible);
		}
	};

	// --------------------------------------------------------------------------
	// Active Grid Store Selector Helper
	// --------------------------------------------------------------------------

	const activeStore = useMemo(() => {
		switch (activePage) {
			case 'perf':
				return perfStore;
			case 'server':
				return serverStore;
			case 'ranges':
				return spreadsheetStore;
			case 'editors':
				return customStore;
			case 'layout':
				return layoutStore;
			case 'skins':
				return skinsStore;
			case 'dashboard':
				return dashboardStore;
			default:
				return perfStore;
		}
	}, [activePage, perfStore, serverStore, spreadsheetStore, customStore, layoutStore, skinsStore, dashboardStore]);

	// Apply filter and sort models to the active store when they change
	const sortModel = useMemo<SortModel>(() => [{ colId: sortField, sort: sortDirection }], [sortField, sortDirection]);
	const filterModel = useMemo<FilterModel | null>(
		() => (statusFilter === 'All' ? null : { status: { type: 'equals', filter: statusFilter } }),
		[statusFilter]
	);

	useEffect(() => {
		activeStore.setSortModel(sortModel);
	}, [activeStore, sortModel]);

	useEffect(() => {
		activeStore.setFilterModel(filterModel);
	}, [activeStore, filterModel]);

	return (
		<div className='flex flex-col h-full w-full bg-slate-950 text-slate-100 p-6 box-border overflow-hidden select-none font-sans'>
			{/* Dashboard Top Header */}
			<ShowroomHeader />

			{/* Three-Column Showroom Layout */}
			<div className='flex-1 min-h-0 flex gap-6 mt-6 overflow-hidden'>
				{/* COLUMN A: GORGEOUS SIDEBAR NAVIGATION */}
				<ShowroomLeftSidebar
					activePage={activePage}
					leftSidebarCollapsed={leftSidebarCollapsed}
					setLeftSidebarCollapsed={setLeftSidebarCollapsed}
				/>

				{/* COLUMN B: MAIN GRID AND VIEWPORTS */}
				<div className='flex-1 min-h-0 min-w-0 flex flex-col gap-5 overflow-hidden pr-1.5'>
					{/* Active Showcase Title Banner */}
					<ShowroomTitleBanner
						activePage={activePage}
						runBulkCalculationTest={runBulkCalculationTest}
						applySpreadsheetRangeAction={applySpreadsheetRangeAction}
						compactLayout={compactLayout}
						setCompactLayout={setCompactLayout}
						rightSidebarCollapsed={rightSidebarCollapsed}
						setRightSidebarCollapsed={setRightSidebarCollapsed}
					/>

					{/* Layout Column Visibility Bar (Only on Page 5) */}
					{activePage === 'layout' && (
						<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex flex-wrap items-center gap-3 shrink-0 text-xs font-semibold'>
							<span className='text-[10px] text-slate-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<Layout className='w-3.5 h-3.5 text-purple-400' />
								Column Visibility:
							</span>
							{layoutColumnsFull.map((col) => (
								<label
									key={col.field}
									className='flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-850 hover:border-slate-750 cursor-pointer select-none transition-all'
								>
									<input
										type='checkbox'
										checked={visibleColumns[col.field]}
										onChange={() => toggleColumnVisibility(col.field)}
										className='rounded border-slate-800 text-purple-600 focus:ring-purple-500/20 w-3 h-3 bg-slate-950 cursor-pointer'
									/>
									<span className='text-[10px] font-bold text-slate-300'>{col.header}</span>
								</label>
							))}
						</div>
					)}

					{/* Visual Interactive Grid viewport */}
					<div className='flex-1 min-h-0 flex flex-col'>
						{activePage === 'perf' && (
							<CalculationsArena
								store={perfStore}
								controller={perfController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								onCellValueChanged={handlePerfCellValueChanged}
								pinLeftColumns={pinLeftColumns}
								pinRightColumns={pinRightColumns}
							/>
						)}

						{activePage === 'server' && (
							<InfiniteServerScroll
								store={serverStore}
								controller={serverController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								pinLeftColumns={pinLeftColumns}
								pinRightColumns={pinRightColumns}
							/>
						)}

						{activePage === 'ranges' && (
							<SpreadsheetWorkspace
								store={spreadsheetStore}
								controller={spreadsheetController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								onCellValueChanged={handleSpreadsheetCellValueChanged}
								pinLeftColumns={pinLeftColumns}
								pinRightColumns={pinRightColumns}
							/>
						)}

						{activePage === 'editors' && (
							<CustomEditorRenderer
								store={customStore}
								controller={customController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								onCellValueChanged={handleCustomCellValueChanged}
								pinLeftColumns={pinLeftColumns}
								pinRightColumns={pinRightColumns}
							/>
						)}

						{activePage === 'layout' && (
							<DynamicLayout
								store={layoutStore}
								controller={layoutController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								rowHeightsMap={rowHeightsMap}
								onCellValueChanged={handleLayoutCellValueChanged}
								compactLayout={compactLayout}
								pinLeftColumns={pinLeftColumns}
								pinRightColumns={pinRightColumns}
							/>
						)}

						{activePage === 'skins' && (
							<HeadlessSkinsPlayground
								store={skinsStore}
								controller={skinsController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								onCellValueChanged={handleSkinsCellValueChanged}
							/>
						)}

						{activePage === 'dashboard' && (
							<RealtimeDashboard
								store={dashboardStore}
								controller={dashboardController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								onCellValueChanged={handleDashboardCellValueChanged}
							/>
						)}
					</div>
				</div>

				{/* COLUMN C: PRESERVED RIGHT-SIDE CONTROLS SIDEBAR */}
				<ShowroomRightSidebar
					rightSidebarCollapsed={rightSidebarCollapsed}
					activeStore={activeStore}
					pinLeftColumns={pinLeftColumns}
					setPinLeftColumns={setPinLeftColumns}
					pinRightColumns={pinRightColumns}
					setPinRightColumns={setPinRightColumns}
					activePage={activePage}
					massiveColumns={massiveColumns}
					setMassiveColumns={setMassiveColumns}
					sortField={sortField}
					setSortField={setSortField}
					statusFilter={statusFilter}
					setStatusFilter={setStatusFilter}
					sortDirection={sortDirection}
					setSortDirection={setSortDirection}
					editTrigger={editTrigger}
					setEditTrigger={setEditTrigger}
					arrowKeyNavigationEdit={arrowKeyNavigationEdit}
					setArrowKeyNavigationEdit={setArrowKeyNavigationEdit}
					perfController={perfController}
					serverController={serverController}
					spreadsheetController={spreadsheetController}
					customController={customController}
					skinsController={skinsController}
					dashboardController={dashboardController}
				/>
			</div>
		</div>
	);
}
