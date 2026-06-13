import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from 'lucide-react';
import type { FilterModel, GridApi, GridReadyEvent, SortModel } from '@open-grid/react';
import { DemoGridApiScope } from './DemoGridContext';
import ShowroomHeader from './components/ShowroomHeader';
import ShowroomLeftSidebar from './components/ShowroomLeftSidebar';
import ShowroomTitleBanner from './components/ShowroomTitleBanner';
import ShowroomRightSidebar from './components/ShowroomRightSidebar';
import type { GridPageType } from './components/GridShared';
import CalculationsArena from './pages/CalculationsArena';
import InfiniteServerScroll from './pages/InfiniteServerScroll';
import SpreadsheetWorkspace from './pages/SpreadsheetWorkspace';
import CustomEditorRenderer from './pages/CustomEditorRenderer';
import DynamicLayout from './pages/DynamicLayout';
import HeadlessSkinsPlayground from './pages/HeadlessSkinsPlayground';
import RealtimeDashboard from './pages/RealtimeDashboard';
import GanttSchedulingWorkspace from './pages/GanttSchedulingWorkspace';
import NestedTablesGrouping from './pages/NestedTablesGrouping';
import PerformanceLab from './pages/PerformanceLab';
import SidebarPanelsDemo from './pages/SidebarPanelsDemo';
import NativeCellTypesDemo from './pages/NativeCellTypesDemo';
import RealtimeGroupingDemo from './pages/RealtimeGroupingDemo';
import RowMultiSelectDemo from './pages/RowMultiSelectDemo';
import { layoutColumnsFull, setInactiveRiskSideEffects } from './pages/demoGridConfigs';

const PAGES: readonly GridPageType[] = [
	'perf',
	'server',
	'ranges',
	'editors',
	'layout',
	'skins',
	'dashboard',
	'gantt',
	'nested',
	'lab',
	'panels',
	'native',
	'grouping',
	'multiselect',
];

function readActivePage(): GridPageType {
	const hash = window.location.hash.slice(1);
	return PAGES.includes(hash as GridPageType) ? (hash as GridPageType) : 'perf';
}

export default function App() {
	const [activePage, setActivePage] = useState<GridPageType>(() => readActivePage());
	const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
	const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
	const [pinLeftColumns, setPinLeftColumns] = useState(1);
	const [pinRightColumns, setPinRightColumns] = useState(1);
	const [massiveColumns, setMassiveColumns] = useState(false);
	const [editTrigger, setEditTrigger] = useState<'singleClick' | 'doubleClick'>('doubleClick');
	const [arrowKeyNavigationEdit, setArrowKeyNavigationEdit] = useState(false);
	const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Pending' | 'Inactive'>('All');
	const [sortField, setSortField] = useState('id');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
	const [compactLayout, setCompactLayout] = useState<'compact' | 'normal' | 'spacious'>('normal');
	const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
		id: true,
		name: true,
		price: true,
		quantity: true,
		subtotal: true,
		status: true,
	});
	const [activeApi, setActiveApi] = useState<GridApi<any> | null>(null);

	useEffect(() => {
		const handleHashChange = () => {
			setActivePage(readActivePage());
			setActiveApi(null);
		};
		window.addEventListener('hashchange', handleHashChange);
		if (window.location.hash) handleHashChange();
		else window.location.hash = 'perf';
		return () => window.removeEventListener('hashchange', handleHashChange);
	}, []);

	const rowHeightsMap = useMemo(() => ({ compact: 30, normal: 38, spacious: 48 }), []);
	const sortModel = useMemo<SortModel>(() => [{ colId: sortField, sort: sortDirection }], [sortField, sortDirection]);
	const filterModel = useMemo<FilterModel | null>(
		() => (statusFilter === 'All' ? null : { status: { type: 'equals', filter: statusFilter } }),
		[statusFilter]
	);

	useEffect(() => {
		activeApi?.setSortModel(sortModel);
	}, [activeApi, sortModel]);

	useEffect(() => {
		activeApi?.setFilterModel(filterModel);
	}, [activeApi, filterModel]);

	useEffect(() => {
		if (!activeApi) return;
		const columns = activeApi.getState().columns;
		if (columns.length > 0 && !columns.some((column) => column.field === sortField)) {
			setSortField(columns[0].field);
		}
	}, [activeApi, sortField]);

	const registerGridApi = useCallback(
		(page: GridPageType, event: GridReadyEvent<any>) => {
			if (page === activePage) setActiveApi(event.api);
		},
		[activePage]
	);

	const handleGridReady = useCallback((event: GridReadyEvent<any>) => registerGridApi(activePage, event), [activePage, registerGridApi]);

	const handleCellValueChanged = useCallback(
		(rowId: string, colField: string, value: unknown) => {
			if (!activeApi) return;
			setInactiveRiskSideEffects(activeApi, rowId, colField, value);
			if (activePage === 'gantt' && colField === 'status') {
				if (value === 'Done') activeApi.setCellValue(rowId, 'progress', 100);
				else if (value === 'Pending') activeApi.setCellValue(rowId, 'progress', 0);
			}
			performance.mark('open-grid-demo-cell-change');
		},
		[activeApi, activePage]
	);

	const runBulkCalculationTest = useCallback(() => {
		if (!activeApi) return;
		const start = performance.now();
		activeApi.rows().forEach((row, index) => {
			if (index % 10 !== 0) return;
			activeApi.setCellValue(row.id, 'price', (Math.floor(Math.random() * 150) + 10).toString());
			activeApi.setCellValue(row.id, 'quantity', (Math.floor(Math.random() * 60) + 15).toString());
		});
		activeApi.flushCellUpdatesSync();
		performance.measure('open-grid-demo-bulk-calculation', { start, end: performance.now() });
		performance.mark('open-grid-demo-grid-action');
	}, [activeApi]);

	const applySpreadsheetRangeAction = useCallback(
		(action: 'fill' | 'clear' | 'addPercent' | 'sum') => {
			if (!activeApi) return;
			const state = activeApi.getState();
			const range = state.selection.range;
			if (!range) {
				window.alert('Please select a range of cells first using click-and-drag or Shift+Arrows.');
				return;
			}
			const startColIndex = state.columns.findIndex((column) => column.field === range.start.colField);
			const endColIndex = state.columns.findIndex((column) => column.field === range.end.colField);
			if (startColIndex === -1 || endColIndex === -1) return;
			const rowIds = activeApi.rows().inRange(range).getIds();
			const columns = state.columns
				.slice(Math.min(startColIndex, endColIndex), Math.max(startColIndex, endColIndex) + 1)
				.map((column) => column.field)
				.filter((field) => field !== 'id');
			if (action === 'sum') {
				let total = 0;
				for (const rowId of rowIds) for (const colField of columns) total += parseFloat(String(activeApi.getCellValue(rowId, colField))) || 0;
				window.alert(`Calculated Selection Range Sum: ${total.toFixed(2)}`);
				return;
			}
			for (const rowId of rowIds) {
				for (const colField of columns) {
					if (action === 'fill') activeApi.setCellValue(rowId, colField, '100');
					else if (action === 'clear') activeApi.setCellValue(rowId, colField, '');
					else
						activeApi.setCellValue(
							rowId,
							colField,
							((parseFloat(String(activeApi.getCellValue(rowId, colField))) || 0) * 1.1).toFixed(0)
						);
				}
			}
			performance.mark('open-grid-demo-range-action');
		},
		[activeApi]
	);

	const toggleColumnVisibility = (field: string) => {
		const nextVisible = { ...visibleColumns, [field]: !visibleColumns[field] };
		if (Object.values(nextVisible).some(Boolean)) setVisibleColumns(nextVisible);
	};

	const contextValue = useMemo(() => ({ activeApi, registerGridApi }), [activeApi, registerGridApi]);
	const commonGridProps = {
		editTrigger,
		arrowKeyNavigationEdit,
		onGridReady: handleGridReady,
		onCellValueChanged: handleCellValueChanged,
		pinLeftColumns,
		pinRightColumns,
	};

	return (
		<DemoGridApiScope value={contextValue}>
			<div className='flex h-full w-full select-none flex-col overflow-hidden bg-slate-950 p-6 font-sans text-slate-100'>
				<ShowroomHeader />
				<div className='mt-6 flex min-h-0 flex-1 gap-6 overflow-hidden'>
					<ShowroomLeftSidebar
						activePage={activePage}
						leftSidebarCollapsed={leftSidebarCollapsed}
						setLeftSidebarCollapsed={setLeftSidebarCollapsed}
					/>
					<div className='flex min-w-0 flex-1 flex-col gap-5 overflow-hidden pr-1.5'>
						<ShowroomTitleBanner
							activePage={activePage}
							runBulkCalculationTest={runBulkCalculationTest}
							applySpreadsheetRangeAction={applySpreadsheetRangeAction}
							compactLayout={compactLayout}
							setCompactLayout={setCompactLayout}
							rightSidebarCollapsed={rightSidebarCollapsed}
							setRightSidebarCollapsed={setRightSidebarCollapsed}
						/>
						{activePage === 'layout' && (
							<div className='flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-slate-900 bg-slate-900/10 p-3 text-xs font-semibold'>
								<span className='flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>
									<Layout className='h-3.5 w-3.5 text-purple-400' />
									Column Visibility:
								</span>
								{layoutColumnsFull.map((col) => (
									<label
										key={col.field}
										className='flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-slate-850 bg-slate-950/80 px-2.5 py-1 transition-all hover:border-slate-750'
									>
										<input
											type='checkbox'
											checked={visibleColumns[col.field]}
											onChange={() => toggleColumnVisibility(col.field)}
											className='h-3 w-3 cursor-pointer rounded border-slate-800 bg-slate-950 text-purple-600 focus:ring-purple-500/20'
										/>
										<span className='text-[10px] font-bold text-slate-300'>{col.header}</span>
									</label>
								))}
							</div>
						)}
						<div className='flex min-h-0 flex-1 flex-col'>
							{activePage === 'perf' && <CalculationsArena {...commonGridProps} massiveColumns={massiveColumns} />}
							{activePage === 'server' && <InfiniteServerScroll {...commonGridProps} />}
							{activePage === 'ranges' && <SpreadsheetWorkspace {...commonGridProps} />}
							{activePage === 'editors' && <CustomEditorRenderer {...commonGridProps} />}
							{activePage === 'layout' && (
								<DynamicLayout
									{...commonGridProps}
									rowHeightsMap={rowHeightsMap}
									compactLayout={compactLayout}
									visibleColumns={visibleColumns}
								/>
							)}
							{activePage === 'skins' && <HeadlessSkinsPlayground {...commonGridProps} />}
							{activePage === 'dashboard' && <RealtimeDashboard {...commonGridProps} />}
							{activePage === 'gantt' && <GanttSchedulingWorkspace {...commonGridProps} />}
							{activePage === 'lab' && <PerformanceLab {...commonGridProps} />}
							{activePage === 'nested' && <NestedTablesGrouping {...commonGridProps} />}
							{activePage === 'panels' && <SidebarPanelsDemo {...commonGridProps} />}
							{activePage === 'native' && <NativeCellTypesDemo {...commonGridProps} />}
							{activePage === 'grouping' && <RealtimeGroupingDemo {...commonGridProps} />}
							{activePage === 'multiselect' && <RowMultiSelectDemo {...commonGridProps} />}
						</div>
					</div>
					{activeApi && (
						<ShowroomRightSidebar
							rightSidebarCollapsed={rightSidebarCollapsed}
							activeApi={activeApi}
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
						/>
					)}
				</div>
			</div>
		</DemoGridApiScope>
	);
}
