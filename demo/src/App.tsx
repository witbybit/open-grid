import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
	ClientRowModelController,
	FilterModel,
	ColumnDef,
	GridStore,
	IGridDatasource,
	ServerRowModelController,
	SortModel,
	FilterModelItem,
} from '@open-grid/core';
import {
	ArrowDownAZ,
	ArrowUpAZ,
	Cpu,
	Filter,
	RefreshCw,
	Zap,
	HelpCircle,
	Layers,
	Keyboard,
	TrendingUp,
	Database,
	FileSpreadsheet,
	Sliders,
	Layout,
	Play,
	Sparkles,
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightClose,
	PanelRightOpen,
} from 'lucide-react';

import {
	generatePerformanceRows,
	generateSpreadsheetRows,
	generateCustomShowcaseRows,
	PerformanceRow,
	SpreadsheetRow,
	CustomShowcaseRow,
	StarRatingRenderer,
	ProgressBarRenderer,
	ProgressSliderEditor,
	StatusBadgeRenderer,
	StatusDropdownEditor,
	PriceBadgeRenderer,
	LatencyProfiler,
} from './components/GridShared';

import { StateInspector, LiveEventLogPanel } from './components/RightSidebar';

import CalculationsArena from './pages/CalculationsArena';
import InfiniteServerScroll from './pages/InfiniteServerScroll';
import SpreadsheetWorkspace from './pages/SpreadsheetWorkspace';
import CustomEditorRenderer from './pages/CustomEditorRenderer';
import DynamicLayout from './pages/DynamicLayout';

export default function App() {
	// Active Page Routing State via URL Hash Routing
	const [activePage, setActivePage] = useState<'perf' | 'server' | 'ranges' | 'editors' | 'layout'>('perf');

	// Collapsible Sidebars State
	const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
	const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

	useEffect(() => {
		const handleHashChange = () => {
			const hash = window.location.hash.slice(1);
			if (['perf', 'server', 'ranges', 'editors', 'layout'].includes(hash)) {
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

	// --------------------------------------------------------------------------
	// A. PAGE 1: CLIENT PERFORMANCE CALCULATION PLAYGROUND (10k Rows)
	// --------------------------------------------------------------------------

	const clientColumns = useMemo<ColumnDef<PerformanceRow>[]>(
		() => [
			{ field: 'id', header: 'Row ID', width: 80 },
			{ field: 'name', header: 'Product Name', width: 170 },
			{ field: 'price', header: 'Price ($)', width: 110 },
			{ field: 'quantity', header: 'Quantity', width: 90 },
			{
				field: 'subtotal',
				header: 'Subtotal ($)',
				width: 130,
				valueGetter: ({ row }) => {
					const price = parseFloat(row.price) || 0;
					const qty = parseFloat(row.quantity) || 0;
					return (price * qty).toFixed(2);
				},
			},
			{
				field: 'status',
				header: 'Status',
				width: 110,
				cellEditor: StatusDropdownEditor,
				cellRenderer: StatusBadgeRenderer,
			},
		],
		[]
	);

	const perfStore = useMemo(() => {
		return new GridStore<PerformanceRow>({
			rowHeights: {},
			columnWidths: clientColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [clientColumns]);

	const perfRows = useMemo(() => generatePerformanceRows(10000, 'R'), []);

	const perfController = useMemo(() => {
		return new ClientRowModelController<PerformanceRow>(perfStore, {
			rows: perfRows,
			columns: clientColumns,
			rowIdField: 'id',
		});
	}, [perfStore, perfRows, clientColumns]);

	const handlePerfCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			perfController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						let updated = { ...row, [colField]: val as any };
						if (colField === 'status' && val === 'Inactive') {
							updated.price = '0';
							updated.quantity = '0';
						}
						return updated;
					}
					return row;
				})
			);
		},
		[perfController]
	);

	// Performance calculation bulk update simulation
	const runBulkCalculationTest = () => {
		const start = performance.now();
		perfController.updateRows((rows) => {
			return rows.map((row, index) => {
				if (index % 10 === 0) {
					return {
						...row,
						price: (Math.floor(Math.random() * 150) + 10).toString(),
						quantity: (Math.floor(Math.random() * 5) + 1).toString(),
					};
				}
				return row;
			});
		});
		const duration = performance.now() - start;
		LatencyProfiler.record(duration);
	};

	// --------------------------------------------------------------------------
	// B. PAGE 2: INFINITE SERVER CHUNKS SCROLL (100k Rows)
	// --------------------------------------------------------------------------

	const serverColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => clientColumns, [clientColumns]);

	const serverStore = useMemo(() => {
		return new GridStore<PerformanceRow>({
			rowHeights: {},
			columnWidths: serverColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [serverColumns]);

	const serverRows = useMemo(() => generatePerformanceRows(100000, 'SR'), []);

	const mockDatasource = useMemo<IGridDatasource>(() => {
		return {
			getRows: async (params) => {
				const start = performance.now();
				// Simulated server response lag
				await new Promise((resolve) => setTimeout(resolve, 450));

				const filterModel = params.filterModel as FilterModel | undefined;
				const sortModel = params.sortModel as SortModel | undefined;

				let rows = serverRows;

				const statusFilter = filterModel?.status as FilterModelItem | undefined;
				if (statusFilter?.filter) {
					rows = rows.filter((row) => row.status === statusFilter.filter);
				}

				if (sortModel?.length) {
					rows = [...rows].sort((a, b) => {
						for (const item of sortModel) {
							const field = item.colId as keyof PerformanceRow;
							const left = a[field];
							const right = b[field];
							const leftNumber = Number(left);
							const rightNumber = Number(right);
							const comparison =
								!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)
									? leftNumber - rightNumber
									: String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
							if (comparison !== 0) return item.sort === 'desc' ? -comparison : comparison;
						}
						return 0;
					});
				}

				const resultRows = rows.slice(params.startRow, params.endRow);
				const duration = performance.now() - start;
				LatencyProfiler.record(duration);

				// Dispatch custom notification for log streamer
				serverStore.dispatchEvent('serverBlockLoaded', {
					loadedBlockStart: params.startRow,
					loadedBlockEnd: params.endRow,
					totalRecords: rows.length,
					durationMs: duration,
				});

				return {
					rows: resultRows,
					totalCount: rows.length,
				};
			},
		};
	}, [serverRows, serverStore]);

	const serverController = useMemo(() => {
		return new ServerRowModelController<PerformanceRow>(serverStore, {
			datasource: mockDatasource,
			blockSize: 100,
			columns: serverColumns,
			rowIdField: 'id',
		});
	}, [serverStore, mockDatasource, serverColumns]);

	// --------------------------------------------------------------------------
	// C. PAGE 3: SPREADSHEET RANGE MULTI-SELECT WORKSPACE
	// --------------------------------------------------------------------------

	const spreadsheetColumns = useMemo<ColumnDef<SpreadsheetRow>[]>(
		() => [
			{ field: 'id', header: 'Cell ID', width: 80 },
			{ field: 'A', header: 'Column A', width: 110 },
			{ field: 'B', header: 'Column B', width: 110 },
			{ field: 'C', header: 'Column C', width: 110 },
			{ field: 'D', header: 'Column D', width: 110 },
			{ field: 'E', header: 'Column E', width: 110 },
			{ field: 'F', header: 'Column F', width: 110 },
		],
		[]
	);

	const spreadsheetStore = useMemo(() => {
		return new GridStore<SpreadsheetRow>({
			rowHeights: {},
			columnWidths: spreadsheetColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [spreadsheetColumns]);

	const spreadsheetRows = useMemo(() => generateSpreadsheetRows(500), []);

	const spreadsheetController = useMemo(() => {
		return new ClientRowModelController<SpreadsheetRow>(spreadsheetStore, {
			rows: spreadsheetRows,
			columns: spreadsheetColumns,
			rowIdField: 'id',
		});
	}, [spreadsheetStore, spreadsheetRows, spreadsheetColumns]);

	const handleSpreadsheetCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			spreadsheetController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						return { ...row, [colField]: val as string };
					}
					return row;
				})
			);
		},
		[spreadsheetController]
	);

	// Batch Selection Range Spreadsheet operations
	const applySpreadsheetRangeAction = (action: 'fill' | 'clear' | 'addPercent' | 'sum') => {
		const state = spreadsheetStore.getState();
		const range = state.selectedRange;
		if (!range) {
			alert('Please select a range of cells first using click-and-drag or Shift+Arrows.');
			return;
		}

		const rowModel = spreadsheetStore.getRowModel();
		if (!rowModel) return;

		const startIdx = rowModel.getRowIndexById(range.start.rowId);
		const endIdx = rowModel.getRowIndexById(range.end.rowId);
		const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
		const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);

		if (startIdx === -1 || endIdx === -1 || startColIdx === -1 || endColIdx === -1) return;

		const minRow = Math.min(startIdx, endIdx);
		const maxRow = Math.max(startIdx, endIdx);
		const minCol = Math.min(startColIdx, endColIdx);
		const maxCol = Math.max(startColIdx, endColIdx);

		const colsToModify = state.columns.slice(minCol, maxCol + 1).map((c) => c.field);
		const rowIdsToModify: string[] = [];
		for (let i = minRow; i <= maxRow; i++) {
			const node = rowModel.getRowNode ? rowModel.getRowNode(i) : null;
			if (node) rowIdsToModify.push(node.id);
		}

		const startTime = performance.now();

		if (action === 'sum') {
			let totalSum = 0;
			for (const rowId of rowIdsToModify) {
				for (const colField of colsToModify) {
					if (colField === 'id') continue;
					const val = parseFloat(String(spreadsheetStore.getCellValue(rowId, colField))) || 0;
					totalSum += val;
				}
			}
			const duration = performance.now() - startTime;
			LatencyProfiler.record(duration);
			alert(`Calculated Selection Range Sum: ${totalSum.toFixed(2)} (Completed in ${duration.toFixed(3)}ms)`);
			return;
		}

		spreadsheetController.updateRows((rows) => {
			return rows.map((row) => {
				if (rowIdsToModify.includes(row.id)) {
					let nextRow = { ...row };
					for (const colField of colsToModify) {
						if (colField === 'id') continue;
						if (action === 'fill') {
							(nextRow as any)[colField] = '100';
						} else if (action === 'clear') {
							(nextRow as any)[colField] = '';
						} else if (action === 'addPercent') {
							const valNum = parseFloat((row as any)[colField]) || 0;
							(nextRow as any)[colField] = (valNum * 1.1).toFixed(0);
						}
					}
					return nextRow;
				}
				return row;
			});
		});

		const duration = performance.now() - startTime;
		LatencyProfiler.record(duration);
	};

	// --------------------------------------------------------------------------
	// D. PAGE 4: ADVANCED CUSTOM EDITORS & RENDERERS SHOWCASE (50 Rows)
	// --------------------------------------------------------------------------

	const customColumns = useMemo<ColumnDef<CustomShowcaseRow>[]>(
		() => [
			{ field: 'id', header: 'Product ID', width: 80 },
			{ field: 'name', header: 'Premium Product', width: 170 },
			{
				field: 'price',
				header: 'Unit Cost ($)',
				width: 120,
				cellRenderer: PriceBadgeRenderer,
			},
			{
				field: 'rating',
				header: 'Satisfaction Rating',
				width: 160,
				cellRenderer: StarRatingRenderer,
			},
			{
				field: 'progress',
				header: 'Fulfillment progress',
				width: 160,
				cellRenderer: ProgressBarRenderer,
				cellEditor: ProgressSliderEditor,
			},
			{
				field: 'status',
				header: 'Current Status',
				width: 120,
				cellRenderer: StatusBadgeRenderer,
				cellEditor: StatusDropdownEditor,
			},
		],
		[]
	);

	const customStore = useMemo(() => {
		return new GridStore<CustomShowcaseRow>({
			rowHeights: {},
			columnWidths: customColumns.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [customColumns]);

	const customRows = useMemo(() => generateCustomShowcaseRows(50), []);

	const customController = useMemo(() => {
		return new ClientRowModelController<CustomShowcaseRow>(customStore, {
			rows: customRows,
			columns: customColumns,
			rowIdField: 'id',
		});
	}, [customStore, customRows, customColumns]);

	const handleCustomCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			customController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						return { ...row, [colField]: val as string };
					}
					return row;
				})
			);
		},
		[customController]
	);

	// --------------------------------------------------------------------------
	// E. PAGE 5: DYNAMIC LAYOUT & VISIBILITY RESIZING (100 Rows)
	// --------------------------------------------------------------------------

	const layoutColumnsFull = useMemo<ColumnDef<PerformanceRow>[]>(
		() => [
			{ field: 'id', header: 'Row ID', width: 80 },
			{ field: 'name', header: 'Product Name', width: 160 },
			{ field: 'price', header: 'Price ($)', width: 110 },
			{ field: 'quantity', header: 'Quantity', width: 90 },
			{
				field: 'subtotal',
				header: 'Subtotal ($)',
				width: 130,
				valueGetter: ({ row }) => {
					const price = parseFloat(row.price) || 0;
					const qty = parseFloat(row.quantity) || 0;
					return (price * qty).toFixed(2);
				},
			},
			{
				field: 'status',
				header: 'Status',
				width: 110,
				cellEditor: StatusDropdownEditor,
				cellRenderer: StatusBadgeRenderer,
			},
		],
		[]
	);

	const layoutColumns = useMemo<ColumnDef<PerformanceRow>[]>(() => {
		return layoutColumnsFull.filter((col) => visibleColumns[col.field]);
	}, [layoutColumnsFull, visibleColumns]);

	const layoutStore = useMemo(() => {
		return new GridStore<PerformanceRow>({
			rowHeights: {},
			columnWidths: layoutColumnsFull.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, [layoutColumnsFull]);

	const layoutRows = useMemo(() => generatePerformanceRows(100, 'R'), []);

	const layoutController = useMemo(() => {
		return new ClientRowModelController<PerformanceRow>(layoutStore, {
			rows: layoutRows,
			columns: layoutColumns,
			rowIdField: 'id',
		});
	}, [layoutStore, layoutRows, layoutColumns]);

	// Update columns inside the controller when layout changes
	useEffect(() => {
		layoutStore.setState({ columns: layoutColumns });
	}, [layoutStore, layoutColumns]);

	const handleLayoutCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			layoutController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						let updated = { ...row, [colField]: val as any };
						if (colField === 'status' && val === 'Inactive') {
							updated.price = '0';
							updated.quantity = '0';
						}
						return updated;
					}
					return row;
				})
			);
		},
		[layoutController]
	);

	const toggleColumnVisibility = (field: string) => {
		const nextVisible = { ...visibleColumns, [field]: !visibleColumns[field] };
		// Make sure we have at least one visible column
		const visibleCount = Object.values(nextVisible).filter(Boolean).length;
		if (visibleCount > 0) {
			const start = performance.now();
			setVisibleColumns(nextVisible);
			const duration = performance.now() - start;
			LatencyProfiler.record(duration);
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
			default:
				return perfStore;
		}
	}, [activePage, perfStore, serverStore, spreadsheetStore, customStore, layoutStore]);

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
		<div className='flex flex-col h-full w-full bg-slate-950 text-slate-100 p-6 box-border overflow-hidden select-none'>
			{/* Dashboard Top Header */}
			<header className='flex flex-col md:flex-row items-start md:items-center justify-between pb-5 border-b border-slate-900 gap-4 shrink-0'>
				<div>
					<div className='flex items-center gap-3'>
						<span className='p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20'>
							<Zap className='w-6 h-6 animate-pulse' />
						</span>
						<h1 className='text-2xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent flex items-center gap-2'>
							Open Grid Showcase
						</h1>
						<p className='text-xs text-slate-400 mt-1 max-w-2xl'>
							Explore our ultra high-performance coordinate-isolated row-store. Prove strict $O(1)$ calculations, inspect real-time
							logs, profile transaction latencies, and configure rich custom editors.
						</p>
					</div>
				</div>
			</header>

			{/* Three-Column Showroom Layout */}
			<div className='flex-1 min-h-0 flex gap-6 mt-6 overflow-hidden'>
				{/* COLUMN A: GORGEOUS SIDEBAR NAVIGATION */}
				<div
					className={`${leftSidebarCollapsed ? 'w-16 p-2' : 'w-56 p-4'} shrink-0 flex flex-col justify-between overflow-y-auto glass-panel rounded-xl border border-slate-900/50 relative transition-all duration-300 ease-in-out`}
				>
					<div className='flex flex-col gap-5'>
						<div className={`flex items-center justify-between ${leftSidebarCollapsed ? 'flex-col gap-3' : ''} px-1.5 py-0.5`}>
							{!leftSidebarCollapsed && (
								<span className='text-[9px] font-bold text-slate-500 uppercase tracking-wider truncate'>Showrooms</span>
							)}
							<button
								onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
								className='p-1 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white transition-all duration-200 shadow-sm border border-slate-800/30'
								title={leftSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
							>
								{leftSidebarCollapsed ? <PanelLeftOpen className='w-4 h-4' /> : <PanelLeftClose className='w-4 h-4' />}
							</button>
						</div>

						<nav className='flex flex-col gap-1.5'>
							<a
								href='#perf'
								title={leftSidebarCollapsed ? 'Calculations Arena (10k Rows • Real-time Math)' : undefined}
								className={`w-full flex ${leftSidebarCollapsed ? 'justify-center p-3' : 'flex-col gap-0.5 px-3 py-2.5'} rounded-xl text-left transition-all group ${
									activePage === 'perf'
										? 'bg-purple-600 text-white shadow-lg shadow-purple-600/10'
										: 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
								}`}
							>
								<div className='flex items-center gap-2 text-xs font-bold'>
									<Cpu className='w-4 h-4 shrink-0' />
									{!leftSidebarCollapsed && 'Calculations Arena'}
								</div>
								{!leftSidebarCollapsed && (
									<span className={`text-[9px] ${activePage === 'perf' ? 'text-purple-200' : 'text-slate-500'} font-medium`}>
										10k Rows • Real-time Math
									</span>
								)}
							</a>

							<a
								href='#server'
								title={leftSidebarCollapsed ? 'Infinite Server Scroll (100k Rows • Delayed Chunks)' : undefined}
								className={`w-full flex ${leftSidebarCollapsed ? 'justify-center p-3' : 'flex-col gap-0.5 px-3 py-2.5'} rounded-xl text-left transition-all group ${
									activePage === 'server'
										? 'bg-purple-600 text-white shadow-lg shadow-purple-600/10'
										: 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
								}`}
							>
								<div className='flex items-center gap-2 text-xs font-bold'>
									<Database className='w-4 h-4 shrink-0' />
									{!leftSidebarCollapsed && 'Infinite Scroll'}
								</div>
								{!leftSidebarCollapsed && (
									<span className={`text-[9px] ${activePage === 'server' ? 'text-purple-200' : 'text-slate-500'} font-medium`}>
										100k Rows • Delayed Chunks
									</span>
								)}
							</a>

							<a
								href='#ranges'
								title={leftSidebarCollapsed ? 'Spreadsheet Selection (Multi-Range • Batch Math)' : undefined}
								className={`w-full flex ${leftSidebarCollapsed ? 'justify-center p-3' : 'flex-col gap-0.5 px-3 py-2.5'} rounded-xl text-left transition-all group ${
									activePage === 'ranges'
										? 'bg-purple-600 text-white shadow-lg shadow-purple-600/10'
										: 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
								}`}
							>
								<div className='flex items-center gap-2 text-xs font-bold'>
									<FileSpreadsheet className='w-4 h-4 shrink-0' />
									{!leftSidebarCollapsed && 'Spreadsheet Selection'}
								</div>
								{!leftSidebarCollapsed && (
									<span className={`text-[9px] ${activePage === 'ranges' ? 'text-purple-200' : 'text-slate-500'} font-medium`}>
										Multi-Range • Batch Math
									</span>
								)}
							</a>

							<a
								href='#editors'
								title={leftSidebarCollapsed ? 'Custom Editor / Renderer (Ratings • Progress Slider)' : undefined}
								className={`w-full flex ${leftSidebarCollapsed ? 'justify-center p-3' : 'flex-col gap-0.5 px-3 py-2.5'} rounded-xl text-left transition-all group ${
									activePage === 'editors'
										? 'bg-purple-600 text-white shadow-lg shadow-purple-600/10'
										: 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
								}`}
							>
								<div className='flex items-center gap-2 text-xs font-bold'>
									<Sliders className='w-4 h-4 shrink-0' />
									{!leftSidebarCollapsed && 'Custom Editors'}
								</div>
								{!leftSidebarCollapsed && (
									<span className={`text-[9px] ${activePage === 'editors' ? 'text-purple-200' : 'text-slate-500'} font-medium`}>
										Ratings • Progress Slider
									</span>
								)}
							</a>

							<a
								href='#layout'
								title={leftSidebarCollapsed ? 'Dynamic Visibility (Hide Columns • Compact Row)' : undefined}
								className={`w-full flex ${leftSidebarCollapsed ? 'justify-center p-3' : 'flex-col gap-0.5 px-3 py-2.5'} rounded-xl text-left transition-all group ${
									activePage === 'layout'
										? 'bg-purple-600 text-white shadow-lg shadow-purple-600/10'
										: 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
								}`}
							>
								<div className='flex items-center gap-2 text-xs font-bold'>
									<Layout className='w-4 h-4 shrink-0' />
									{!leftSidebarCollapsed && 'Dynamic Visibility'}
								</div>
								{!leftSidebarCollapsed && (
									<span className={`text-[9px] ${activePage === 'layout' ? 'text-purple-200' : 'text-slate-500'} font-medium`}>
										Hide Columns • Compact Row
									</span>
								)}
							</a>
						</nav>
					</div>

					<div className='flex flex-col gap-3 pt-4 border-t border-slate-900/60 items-center justify-center'>
						{leftSidebarCollapsed ? (
							<div
								title='Grid Engine v3.1.0'
								className='p-2 rounded-lg bg-slate-950/40 border border-slate-900/80 text-purple-400 cursor-help'
							>
								<Sparkles className='w-4 h-4' />
							</div>
						) : (
							<div className='flex items-center justify-between w-full p-2 rounded-lg bg-slate-950/40 border border-slate-900/80'>
								<div className='flex items-center gap-1.5 text-[10px] text-slate-400 font-bold'>
									<Sparkles className='w-3 h-3 text-purple-400' />
									Grid Engine
								</div>
								<span className='font-mono text-[9px] text-slate-500 font-semibold'>v3.1.0</span>
							</div>
						)}
					</div>
				</div>

				{/* COLUMN B: MAIN GRID AND VIEWPORTS */}
				<div className='flex-1 min-h-0 min-w-0 flex flex-col gap-5 overflow-hidden pr-1.5'>
					{/* Active Showcase Title Banner */}
					<div className='flex items-center justify-between bg-slate-900/10 border border-slate-900 rounded-xl p-3.5 relative overflow-hidden shrink-0'>
						<div className='absolute right-0 top-0 translate-x-6 -translate-y-6 w-20 h-20 bg-purple-600/10 rounded-full blur-xl' />
						<div className='z-10 flex items-center gap-3'>
							<span className='p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400'>
								{activePage === 'perf' && <Cpu className='w-4.5 h-4.5' />}
								{activePage === 'server' && <Database className='w-4.5 h-4.5' />}
								{activePage === 'ranges' && <FileSpreadsheet className='w-4.5 h-4.5' />}
								{activePage === 'editors' && <Sliders className='w-4.5 h-4.5' />}
								{activePage === 'layout' && <Layout className='w-4.5 h-4.5' />}
							</span>
							<div>
								<h2 className='text-sm font-extrabold text-slate-200 leading-tight uppercase tracking-wider flex items-center gap-2'>
									{activePage === 'perf' && 'Performance Calculations Playground'}
									{activePage === 'server' && 'Remote Infinite Scroll Engine'}
									{activePage === 'ranges' && 'Spreadsheet Multi-Range Workspace'}
									{activePage === 'editors' && 'Advanced Custom Editors & Renderers'}
									{activePage === 'layout' && 'Dynamic Layout Visibility & Resizing'}
								</h2>
								<p className='text-[10px] text-slate-400 leading-tight mt-0.5'>
									{activePage === 'perf' &&
										'Run high-speed reactive calculations on a 10,000-row list. Proof that sibling components bypass evaluations.'}
									{activePage === 'server' &&
										'Dynamically query a 100,000-row remote server with chunked pagination. Scroll down to trigger loaders.'}
									{activePage === 'ranges' &&
										'Perform advanced batch actions like addition and sum Tooltips over click-and-drag grid selection bounds.'}
									{activePage === 'editors' &&
										'Click interactive Gold star ratings and drag the double-click progress range slider to test premium cell components.'}
									{activePage === 'layout' &&
										'Toggle column checkboxes and normal/compact spacing buttons to see live grid layouts render under sub-millisecond loads.'}
								</p>
							</div>
						</div>

						{/* Context-aware upper toolbar buttons */}
						<div className='z-10 flex gap-2 shrink-0'>
							{activePage === 'perf' && (
								<button
									onClick={runBulkCalculationTest}
									className='flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 font-bold text-[10px] text-white border border-purple-500/20 shadow-md shadow-purple-600/10 transition-all font-sans'
								>
									<Play className='w-3 h-3' />
									Simulate 1,000 Live Updates
								</button>
							)}

							{activePage === 'ranges' && (
								<div className='flex gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-850 shrink-0'>
									<button
										onClick={() => applySpreadsheetRangeAction('sum')}
										className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-purple-400 font-bold hover:text-white transition-all font-sans'
									>
										Sum Selected
									</button>
									<button
										onClick={() => applySpreadsheetRangeAction('addPercent')}
										className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-indigo-400 font-bold hover:text-white transition-all font-sans'
									>
										Add +10%
									</button>
									<button
										onClick={() => applySpreadsheetRangeAction('fill')}
										className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-emerald-400 font-bold hover:text-white transition-all font-sans'
									>
										Fill 100
									</button>
									<button
										onClick={() => applySpreadsheetRangeAction('clear')}
										className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-rose-400 font-bold hover:text-white transition-all font-sans'
									>
										Clear Range
									</button>
								</div>
							)}

							{activePage === 'layout' && (
								<div className='flex items-center gap-1.5 bg-slate-950 border border-slate-850 rounded-lg p-0.5 shrink-0'>
									{(['compact', 'normal', 'spacious'] as const).map((mode) => (
										<button
											key={mode}
											onClick={() => {
												const start = performance.now();
												setCompactLayout(mode);
												const duration = performance.now() - start;
												LatencyProfiler.record(duration);
											}}
											className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all ${
												compactLayout === mode ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
											}`}
										>
											{mode}
										</button>
									))}
								</div>
							)}
							<button
								onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
								className='flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-slate-950 hover:bg-slate-900 font-bold text-[10px] text-slate-300 hover:text-white border border-slate-850 hover:border-slate-750 transition-all font-sans'
								title={rightSidebarCollapsed ? 'Open Controls Sidebar' : 'Hide Controls Sidebar'}
							>
								{rightSidebarCollapsed ? <PanelRightOpen className='w-3 h-3' /> : <PanelRightClose className='w-3 h-3' />}
								{!rightSidebarCollapsed ? 'Hide Controls' : 'Show Controls'}
							</button>
						</div>
					</div>

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
								rowHeightsMap={rowHeightsMap}
								onCellValueChanged={handlePerfCellValueChanged}
							/>
						)}

						{activePage === 'server' && (
							<InfiniteServerScroll
								store={serverStore}
								controller={serverController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								rowHeightsMap={rowHeightsMap}
							/>
						)}

						{activePage === 'ranges' && (
							<SpreadsheetWorkspace
								store={spreadsheetStore}
								controller={spreadsheetController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								rowHeightsMap={rowHeightsMap}
								onCellValueChanged={handleSpreadsheetCellValueChanged}
							/>
						)}

						{activePage === 'editors' && (
							<CustomEditorRenderer
								store={customStore}
								controller={customController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
								rowHeightsMap={rowHeightsMap}
								onCellValueChanged={handleCustomCellValueChanged}
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
							/>
						)}
					</div>
				</div>

				{/* COLUMN C: PRESERVED RIGHT-SIDE CONTROLS SIDEBAR */}
				<div
					className={`${rightSidebarCollapsed ? 'w-0 p-0 border-0 overflow-hidden' : 'w-72 p-4 border border-slate-900/50'} shrink-0 flex flex-col gap-4 overflow-y-auto pl-1 glass-panel rounded-xl transition-all duration-300 ease-in-out`}
				>
					{/* Coordinate Inspector */}
					<StateInspector store={activeStore} />

					{/* Sorting and Filtering controls */}
					<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0'>
						<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Filter className='w-4 h-4 text-emerald-400' />
							Sort & Filter
						</h3>

						<div className='grid grid-cols-2 gap-2.5'>
							<label className='flex flex-col gap-1'>
								<span className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Sort Field</span>
								<select
									value={sortField}
									onChange={(e) => setSortField(e.target.value)}
									className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-bold cursor-pointer'
								>
									{activeStore.getState().columns.map((column) => (
										<option key={column.field} value={column.field}>
											{column.header}
										</option>
									))}
								</select>
							</label>

							<label className='flex flex-col gap-1'>
								<span className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Status Filter</span>
								<select
									value={statusFilter}
									onChange={(e) => setStatusFilter(e.target.value as any)}
									className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-bold cursor-pointer'
								>
									<option value='All'>All Rows</option>
									<option value='Active'>Active</option>
									<option value='Pending'>Pending</option>
									<option value='Inactive'>Inactive</option>
								</select>
							</label>
						</div>

						<div className='flex gap-2'>
							<button
								onClick={() => setSortDirection('asc')}
								className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
									sortDirection === 'asc'
										? 'bg-purple-600 border-purple-500 text-white shadow-md shadow-purple-600/10'
										: 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200'
								}`}
							>
								<ArrowDownAZ className='w-3.5 h-3.5' />
								Asc
							</button>
							<button
								onClick={() => setSortDirection('desc')}
								className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
									sortDirection === 'desc'
										? 'bg-purple-600 border-purple-500 text-white shadow-md shadow-purple-600/10'
										: 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200'
								}`}
							>
								<ArrowUpAZ className='w-3.5 h-3.5' />
								Desc
							</button>
						</div>
					</div>

					{/* Grid Accessibility panel */}
					<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0'>
						<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Keyboard className='w-4 h-4 text-purple-400' />
							Grid Accessibility
						</h3>

						<div className='flex flex-col gap-2.5'>
							<div className='flex flex-col gap-1'>
								<label className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Edit Trigger</label>
								<select
									value={editTrigger}
									onChange={(e) => setEditTrigger(e.target.value as any)}
									className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-sans font-bold cursor-pointer'
								>
									<option value='doubleClick'>Double-Click to Edit (Excel)</option>
									<option value='singleClick'>Single-Click to Edit</option>
								</select>
							</div>

							<label className='flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-900 hover:border-slate-850 cursor-pointer select-none transition-all'>
								<input
									type='checkbox'
									checked={arrowKeyNavigationEdit}
									onChange={(e) => setArrowKeyNavigationEdit(e.target.checked)}
									className='rounded border-slate-800 text-purple-600 focus:ring-purple-500/20 w-3 h-3 bg-slate-950 cursor-pointer'
								/>
								<div className='flex flex-col'>
									<span className='text-[11px] font-bold text-slate-200 leading-tight'>Arrow Key Auto-Edit</span>
									<span className='text-[9px] text-slate-500 mt-0.5 leading-none'>
										Auto-open cell in edit state when navigating
									</span>
								</div>
							</label>
						</div>
					</div>

					{/* Live core event log panel */}
					<LiveEventLogPanel store={activeStore} />

					{/* Developer Panel */}
					<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0'>
						<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Layers className='w-4 h-4 text-purple-400' />
							Developer Panel
						</h3>

						{activePage === 'perf' || activePage === 'layout' ? (
							<div className='flex flex-col gap-2.5'>
								<button
									onClick={() => {
										const start = performance.now();
										perfController.updateRows((rows) =>
											rows.map((row) => ({
												...row,
												price: '0',
												quantity: '0',
											}))
										);
										const duration = performance.now() - start;
										LatencyProfiler.record(duration);
									}}
									className='flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg bg-slate-850 hover:bg-slate-850/80 text-slate-200 border border-slate-800 hover:text-white text-[10px] font-bold transition-all font-sans'
								>
									<RefreshCw className='w-3 h-3' />
									Reset Prices to Zero
								</button>
								<div className='p-2 bg-slate-950 border border-slate-900 rounded text-[10px] text-slate-400 leading-relaxed'>
									<strong>Calculations Side-Effect</strong>: Changing Status to <strong>Inactive</strong> programmatically sets
									Price and Quantity to 0 for that row!
								</div>
							</div>
						) : activePage === 'server' ? (
							<div className='flex flex-col gap-2.5'>
								<button
									onClick={() => {
										const start = performance.now();
										serverController.purgeCache();
										const duration = performance.now() - start;
										LatencyProfiler.record(duration);
									}}
									className='flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg bg-slate-850 hover:bg-slate-850/80 text-slate-200 border border-slate-800 hover:text-white text-[10px] font-bold transition-all font-sans'
								>
									<RefreshCw className='w-3 h-3' />
									Purge Server Block Cache
								</button>
								<div className='p-2 bg-slate-950 border border-slate-900 rounded text-[10px] text-slate-400 leading-relaxed'>
									<strong>Infinite Server Blocks</strong>: Data is paginated in chunks of 100 with simulated network lag. Purging
									empties cache to force reloading.
								</div>
							</div>
						) : activePage === 'ranges' ? (
							<div className='flex flex-col gap-2'>
								<button
									onClick={() => {
										const start = performance.now();
										spreadsheetController.updateRows((rows) =>
											rows.map((row) => ({
												...row,
												A: '0',
												B: '0',
												C: '0',
												D: '0',
												E: '0',
												F: '0',
											}))
										);
										const duration = performance.now() - start;
										LatencyProfiler.record(duration);
									}}
									className='flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg bg-slate-850 hover:bg-slate-850/80 text-slate-200 border border-slate-800 hover:text-white text-[10px] font-bold transition-all font-sans'
								>
									<RefreshCw className='w-3 h-3' />
									Reset Sheet Values
								</button>
								<div className='p-2 bg-slate-950 border border-slate-900 rounded text-[10px] text-slate-400 leading-relaxed'>
									<strong>Spreadsheet Workspace</strong>: You can perform arithmetic operations and batch edits directly across
									multiple cells!
								</div>
							</div>
						) : (
							<div className='flex flex-col gap-2.5'>
								<button
									onClick={() => {
										const start = performance.now();
										customController.updateRows((rows) =>
											rows.map((row) => ({
												...row,
												price: '50',
												rating: '5',
												progress: '100',
											}))
										);
										const duration = performance.now() - start;
										LatencyProfiler.record(duration);
									}}
									className='flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg bg-slate-850 hover:bg-slate-850/80 text-slate-200 border border-slate-800 hover:text-white text-[10px] font-bold transition-all font-sans'
								>
									<RefreshCw className='w-3 h-3' />
									Max-Out All Metrics
								</button>
								<div className='p-2 bg-slate-950 border border-slate-900 rounded text-[10px] text-slate-400 leading-relaxed'>
									<strong>Interactive Star Ratings</strong>: Simply click any of the rating star cells directly in the grid view to
									update them in O(1) duration!
								</div>
							</div>
						)}
					</div>

					{/* Keyboard Shortcuts guide */}
					<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-2.5'>
						<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<HelpCircle className='w-4 h-4 text-emerald-400' />
							Keyboard Shortcuts
						</h3>
						<ul className='text-slate-400 text-[10px] leading-relaxed flex flex-col gap-1.5 font-semibold'>
							<li className='flex justify-between border-b border-slate-900/60 pb-1'>
								<span>Navigate Cells</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Arrow Keys</span>
							</li>
							<li className='flex justify-between border-b border-slate-900/60 pb-1'>
								<span>Expand Range</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Shift + Arrows</span>
							</li>
							<li className='flex justify-between border-b border-slate-900/60 pb-1'>
								<span>Edit Mode</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Enter / Double Click</span>
							</li>
							<li className='flex justify-between border-b border-slate-900/60 pb-1'>
								<span>Commit & Down</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Enter</span>
							</li>
							<li className='flex justify-between pb-0.5'>
								<span>Navigate / Cancel</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Escape</span>
							</li>
						</ul>
					</div>
				</div>
			</div>
		</div>
	);
}
