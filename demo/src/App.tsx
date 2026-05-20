import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
	ClientRowModelController,
	FilterModel,
	ColumnDef,
	GridStore,
	IGridDatasource,
	ServerRowModelController,
	SortModel,
	GridApi,
	CellEditorProps,
	CellRendererProps,
	GridNavigationController,
	FilterModelItem,
} from '@open-grid/core';
import {
	GridProvider,
	useGridStore,
	useGridApi,
	useGridSelector,
	useGridKeySelector,
	useGridNavigationController,
	Cell as ReactCell,
} from '@open-grid/react';
import { ArrowDownAZ, ArrowUpAZ, Cpu, Filter, Server, RefreshCw, Zap, TableProperties, HelpCircle, Layers, Terminal, Keyboard } from 'lucide-react';

interface DemoRow {
	id: string;
	name: string;
	price: string;
	quantity: string;
	status: 'Active' | 'Pending' | 'Inactive';
	subtotal?: string;
}

// ==========================================
// A. Custom Status Editor using GridApi
// ==========================================

const StatusCellEditor = ({ value, onChange, onCommit }: CellEditorProps<DemoRow>) => {
	return (
		<select
			autoFocus
			value={value as string}
			onChange={(e) => {
				const nextVal = e.target.value;
				onChange(nextVal);
				onCommit();
			}}
			onMouseDown={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
			onBlur={onCommit}
			className='absolute inset-0 w-full h-full px-3 text-sm bg-slate-900 text-white border-2 border-purple-500 outline-none z-20 font-medium cursor-pointer'
		>
			<option value='Active'>Active</option>
			<option value='Pending'>Pending</option>
			<option value='Inactive'>Inactive</option>
		</select>
	);
};

// Define our grid column definitions using type-safe ColumnDef
const COLUMNS: ColumnDef<DemoRow>[] = [
	{ field: 'id', header: 'Row ID', width: 80 },
	{ field: 'name', header: 'Product Name', width: 180 },
	{ field: 'price', header: 'Price ($)', width: 120 },
	{ field: 'quantity', header: 'Quantity', width: 100 },
	{
		field: 'subtotal',
		header: 'Subtotal ($)',
		width: 140,
		valueGetter: ({ row }) => {
			const price = parseFloat(row.price) || 0;
			const qty = parseFloat(row.quantity) || 0;
			return (price * qty).toFixed(2);
		},
	},
	{
		field: 'status',
		header: 'Status',
		width: 120,
		cellEditor: StatusCellEditor,
		cellRenderer: ({ value }: CellRendererProps<DemoRow>) => {
			const colorClass =
				value === 'Active'
					? 'text-emerald-400 font-medium'
					: value === 'Pending'
						? 'text-amber-400 font-medium'
						: 'text-slate-500 font-medium';
			return <span className={`truncate ${colorClass}`}>{value as string}</span>;
		},
	},
];

const DEFAULT_ROW_HEIGHT = 38;

function generateRows(count: number, prefix: 'R' | 'SR'): DemoRow[] {
	const statuses: DemoRow['status'][] = ['Active', 'Pending', 'Inactive'];
	const products =
		prefix === 'R'
			? ['Laser Keyboard', 'Wireless Mouse', 'Mechanical Keycap', 'Sleek Stand', 'Ergonomic Desk', 'Premium Webcam']
			: ['Neon Controller', 'Haptic Earphone', 'VR Headset', 'Smart Mug', 'RGB Cable', 'Cozy Blanket'];

	return Array.from({ length: count }, (_, index) => {
		const price = prefix === 'R' ? Math.floor(Math.random() * 200) + 15 : ((index * 17) % 150) + 10;
		const quantity = prefix === 'R' ? Math.floor(Math.random() * 10) + 1 : (index % 5) + 1;
		return {
			id: `${prefix}-${100000 + index}`,
			name: products[index % products.length],
			price: price.toString(),
			quantity: quantity.toString(),
			status: statuses[index % statuses.length],
		};
	});
}

// ==========================================
// B. Interactive Column Resizing Header Cell
// ==========================================
interface HeaderCellProps<TRowData = unknown> {
	colField: string;
	header: string;
	width?: number;
	api: GridApi<TRowData>;
}

const HeaderCellComponent = <TRowData,>({ colField, header, width = 100, api }: HeaderCellProps<TRowData>) => {
	const colWidth = useGridSelector((state) => state.columnWidths[colField] ?? width);

	const handleMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		const startX = e.clientX;
		const startWidth = colWidth;

		const handleMouseMove = (moveEvent: MouseEvent) => {
			const deltaX = moveEvent.clientX - startX;
			const nextWidth = Math.max(60, startWidth + deltaX);
			api.setColumnWidth(colField, nextWidth);
		};

		const handleMouseUp = () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		};

		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
	};

	return (
		<div
			className='flex items-center justify-between px-3 h-10 border-r border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider relative group'
			style={{ width: colWidth }}
		>
			<span className='truncate select-none'>{header}</span>
			<div
				onMouseDown={handleMouseDown}
				className='absolute right-0 top-0 w-1.5 h-full cursor-col-resize hover:bg-purple-500/80 bg-slate-800 transition-colors duration-150 z-20 group-hover:bg-slate-700'
			/>
		</div>
	);
};

const HeaderCell = React.memo(HeaderCellComponent) as (<TRowData>(props: HeaderCellProps<TRowData>) => React.ReactElement | null) & {
	displayName?: string;
};

HeaderCell.displayName = 'HeaderCell';

// ==========================================
// C. High Performance Grid Cell Component
// ==========================================
interface CellProps {
	rowId: string;
	colField: string;
	api: GridApi<DemoRow>;
	navigation: GridNavigationController<DemoRow>;
}

const Cell = React.memo(({ rowId, colField, api, navigation }: CellProps) => {
	return <ReactCell rowId={rowId} colField={colField} api={api} navigation={navigation} />;
});

Cell.displayName = 'Cell';

// ==========================================
// D. High Performance Grid Body
// ==========================================
interface GridViewProps {
	rowHeights: Record<string, number>;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	clientController?: ClientRowModelController<DemoRow>;
	serverController?: ServerRowModelController;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

interface VirtualRowProps {
	rowIndex: number;
	virtualRow: { size: number; start: number };
	api: GridApi<DemoRow>;
	navigation: GridNavigationController<DemoRow>;
	rowHeights: Record<string, number>;
}

const VirtualRow = React.memo(({ rowIndex, virtualRow, api, navigation, rowHeights }: VirtualRowProps) => {
	const dataVersion = useGridSelector((state) => state.dataVersion);
	const row = useMemo(() => {
		const rowModel = api.getRowModel();
		return rowModel ? rowModel.getRow(rowIndex) : null;
	}, [api, rowIndex, dataVersion]);

	if (!row) {
		return (
			<div
				data-virtual-row
				className='absolute left-0 top-0 w-full flex border-b border-slate-900 items-center px-4 bg-slate-950/40 text-slate-500 animate-pulse text-xs'
				style={{
					height: `${virtualRow.size}px`,
					transform: `translateY(${virtualRow.start}px)`,
				}}
			>
				Loading chunk data...
			</div>
		);
	}

	return (
		<div
			data-virtual-row
			className='absolute left-0 top-0 w-full flex border-b border-slate-900 hover:bg-slate-900/10'
			style={{
				height: `${virtualRow.size}px`,
				transform: `translateY(${virtualRow.start}px)`,
			}}
		>
			{COLUMNS.map((col, i) => (
				<Cell key={i} rowId={row.id} colField={col.field} api={api} navigation={navigation} />
			))}
		</div>
	);
});
VirtualRow.displayName = 'VirtualRow';

function GridView({ rowHeights, onCellValueChanged, serverController, editTrigger = 'doubleClick', arrowKeyNavigationEdit = false }: GridViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const api = useGridApi<DemoRow>();
	const rowCount = useGridSelector((state) => {
		const rowModel = api.getRowModel();
		return rowModel ? rowModel.getRowCount() : 0;
	});

	const navigation = useGridNavigationController<DemoRow>({
		onCellValueChanged,
		editTrigger,
		arrowKeyNavigationEdit,
	});

	// Keyboard navigation attachment
	useEffect(() => {
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			if (document.activeElement === document.body || containerRef.current?.contains(document.activeElement)) {
				navigation.handleKeyDown(e);
			}
		};

		window.addEventListener('keydown', handleGlobalKeyDown);
		window.addEventListener('mouseup', navigation.handleMouseUp);
		return () => {
			window.removeEventListener('keydown', handleGlobalKeyDown);
			window.removeEventListener('mouseup', navigation.handleMouseUp);
		};
	}, [navigation]);

	// Virtualization hook
	const rowVirtualizer = useVirtualizer({
		count: rowCount,
		getScrollElement: () => containerRef.current,
		estimateSize: (index) => {
			const rowModel = api.getRowModel();
			const row = rowModel ? rowModel.getRow(index) : null;
			if (!row) return DEFAULT_ROW_HEIGHT;
			return rowHeights[row.id] ?? DEFAULT_ROW_HEIGHT;
		},
		overscan: 10,
	});

	// Lazy chunk fetching during scrolling in server mode
	const virtualRows = rowVirtualizer.getVirtualItems();
	useEffect(() => {
		if (serverController && virtualRows.length > 0) {
			serverController.loadVisibleBlocks(virtualRows.map((row) => row.index));
		}
	}, [virtualRows, serverController]);

	return (
		<div className='flex flex-col h-full border border-slate-800 rounded-lg overflow-hidden bg-slate-950 shadow-2xl'>
			{/* Sticky Table Header */}
			<div className='flex bg-slate-900 border-b border-slate-800 shrink-0 select-none z-10'>
				{COLUMNS.map((col, i) => (
					<HeaderCell key={i} colField={col.field} header={col.header} width={col.width} api={api} />
				))}
			</div>

			{/* Virtual Scroll Window Container */}
			<div ref={containerRef} className='flex-1 overflow-auto outline-none' tabIndex={0}>
				<div className='relative w-full' style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
					{virtualRows.map((virtualRow) => (
						<VirtualRow
							key={virtualRow.key}
							rowIndex={virtualRow.index}
							virtualRow={virtualRow}
							api={api}
							navigation={navigation}
							rowHeights={rowHeights}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

interface StateInspectorProps {
	store: GridStore<DemoRow>;
}

const StateInspectorContent = () => {
	const gridStateInfo = useGridSelector((state) => {
		const focus = state.focusedCell;
		const range = state.selectedRange;

		const focusText = focus ? `Row ID: ${focus.rowId}, Col Field: ${focus.colField}` : 'None';
		const rangeText = range ? `(${range.start.rowId},${range.start.colField}) to (${range.end.rowId},${range.end.colField})` : 'None';

		return `Focused Cell: ${focusText} | Selected Range: ${rangeText}`;
	});

	return (
		<div className='p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0'>
			<h3 className='text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
				<TableProperties className='w-4 h-4 text-purple-400' />
				State Inspector
			</h3>
			<div className='p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-purple-400 leading-relaxed break-all'>
				{gridStateInfo}
			</div>
			<p className='text-slate-500 text-[10px] leading-relaxed'>
				* Cells represent stable rowIds and column fields instead of duplicative physical coordinate offsets. Focus remains stable even during
				active sorting and filtering!
			</p>
		</div>
	);
};

const StateInspector = React.memo(({ store }: StateInspectorProps) => {
	return (
		<GridProvider store={store}>
			<StateInspectorContent />
		</GridProvider>
	);
});

StateInspector.displayName = 'StateInspector';

interface LiveEventLogPanelProps {
	store: GridStore<DemoRow>;
}

const LiveEventLogPanel = React.memo(({ store }: LiveEventLogPanelProps) => {
	const [eventLogs, setEventLogs] = useState<string[]>([]);

	useEffect(() => {
		setEventLogs([]);

		const formatLog = (name: string, payload: unknown) => {
			const time = new Date().toLocaleTimeString();
			return `[${time}] ${name} -> ${JSON.stringify(payload, null, 2)}`;
		};

		const addLog = (msg: string) => {
			setEventLogs((prev) => [msg, ...prev].slice(0, 40));
		};

		const unsubValue = store.addEventListener('cellValueChanged', (e) => {
			addLog(formatLog('cellValueChanged', e.payload));
		});

		const unsubResize = store.addEventListener('columnResized', (e) => {
			addLog(formatLog('columnResized', e.payload));
		});

		const unsubFocus = store.addEventListener('focusChanged', (e) => {
			addLog(formatLog('focusChanged', e.payload));
		});

		const unsubSelect = store.addEventListener('selectionChanged', (e) => {
			addLog(formatLog('selectionChanged', e.payload));
		});

		const unsubSort = store.addEventListener('sortChanged', (e) => {
			addLog(formatLog('sortChanged', e.payload));
		});

		const unsubFilter = store.addEventListener('filterChanged', (e) => {
			addLog(formatLog('filterChanged', e.payload));
		});

		return () => {
			unsubValue();
			unsubResize();
			unsubFocus();
			unsubSelect();
			unsubSort();
			unsubFilter();
		};
	}, [store]);

	return (
		<div className='p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 h-64 shrink-0'>
			<h3 className='text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 shrink-0'>
				<Terminal className='w-4 h-4 text-emerald-400' />
				Live Core Event Log
			</h3>
			<div className='flex-1 min-h-0 overflow-y-auto p-3 bg-slate-950 border border-slate-850 rounded-lg font-mono text-[10px] text-slate-300 leading-relaxed flex flex-col gap-1'>
				{eventLogs.length === 0 ? (
					<span className='text-slate-600 italic'>
						No events emitted yet. Interact with the grid (resize, select, double click status, edit Price) to broadcast events...
					</span>
				) : (
					eventLogs.map((log, index) => {
						const parts = log.split(' -> ');
						const header = parts[0] || '';
						const body = parts[1] || '';
						return (
							<div
								key={index}
								className='border-b border-slate-900 pb-1.5 text-slate-400 font-mono text-[9px] break-all whitespace-pre-wrap leading-relaxed'
							>
								<span className='text-emerald-400 font-semibold'>{header}</span>
								{body && <span className='text-purple-300 block pl-2 mt-0.5'>{body}</span>}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
});

LiveEventLogPanel.displayName = 'LiveEventLogPanel';

// ==========================================
// E. Main Dashboard Application
// ==========================================
export default function App() {
	const [activeTab, setActiveTab] = useState<'client' | 'server'>('client');
	const [editTrigger, setEditTrigger] = useState<'singleClick' | 'doubleClick'>('doubleClick');
	const [arrowKeyNavigationEdit, setArrowKeyNavigationEdit] = useState<boolean>(false);
	const [statusFilter, setStatusFilter] = useState<'All' | DemoRow['status']>('All');
	const [sortField, setSortField] = useState<keyof DemoRow>('id');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
	const sortModel = useMemo<SortModel>(() => [{ colId: sortField, sort: sortDirection }], [sortField, sortDirection]);
	const filterModel = useMemo<FilterModel | null>(
		() => (statusFilter === 'All' ? null : { status: { type: 'equals', filter: statusFilter } }),
		[statusFilter]
	);

	// A. Create Client-Side Grid Instance
	const clientStore = useMemo(() => {
		const store = new GridStore<DemoRow>({
			rowHeights: {},
			columnWidths: COLUMNS.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
		return store;
	}, []);

	const clientRows = useMemo(() => generateRows(10000, 'R'), []);

	const clientController = useMemo(
		() =>
			new ClientRowModelController<DemoRow>(clientStore, {
				rows: clientRows,
				columns: COLUMNS,
				rowIdField: 'id',
			}),
		[clientStore, clientRows]
	);

	// Custom Side effects and constraints
	const handleClientCellValueChanged = useCallback(
		(rowId: string, colField: string, val: unknown) => {
			// Trigger cell updating in full client controller dataset
			clientController.updateRows((rows) =>
				rows.map((row) => {
					if (row.id === rowId) {
						let updatedRow = { ...row, [colField]: val as string & DemoRow['status'] };

						// Business Rule: If status changes to Inactive, reset price & quantity to zero
						if (colField === 'status' && val === 'Inactive') {
							updatedRow.price = '0';
							updatedRow.quantity = '0';
						}
						return updatedRow;
					}
					return row;
				})
			);
		},
		[clientController]
	);

	// B. Create Server-Side Grid Instance
	const serverStore = useMemo(() => {
		return new GridStore<DemoRow>({
			rowHeights: {},
			columnWidths: COLUMNS.reduce((acc, col) => ({ ...acc, [col.field]: col.width }), {}),
		});
	}, []);

	const serverRows = useMemo(() => generateRows(100000, 'SR'), []);

	// Generate remote paginated datasource with simulated 450ms block loading delay
	const mockDatasource = useMemo<IGridDatasource>(() => {
		return {
			getRows: async (params) => {
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
							const field = item.colId as keyof DemoRow;
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

				return {
					rows: rows.slice(params.startRow, params.endRow),
					totalCount: rows.length,
				};
			},
		};
	}, [serverRows]);

	const serverController = useMemo(() => {
		return new ServerRowModelController<DemoRow>(serverStore, {
			datasource: mockDatasource,
			blockSize: 100,
			columns: COLUMNS,
			rowIdField: 'id',
		});
	}, [serverStore, mockDatasource]);

	useEffect(() => {
		clientStore.setSortModel(sortModel);
		serverStore.setSortModel(sortModel);
	}, [clientStore, serverStore, sortModel]);

	useEffect(() => {
		clientStore.setFilterModel(filterModel);
		serverStore.setFilterModel(filterModel);
	}, [clientStore, serverStore, filterModel]);

	return (
		<div className='flex flex-col h-full w-full bg-slate-950 text-slate-100 p-6 box-border'>
			{/* Premium Dashboard Header */}
			<header className='flex flex-col md:flex-row items-start md:items-center justify-between pb-6 border-b border-slate-900 gap-4 shrink-0'>
				<div>
					<div className='flex items-center gap-3'>
						<span className='p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20'>
							<Zap className='w-6 h-6 animate-pulse' />
						</span>
						<h1 className='text-2xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-500 bg-clip-text text-transparent'>
							Open Grid
						</h1>
						<span className='text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700'>
							v3.0.0
						</span>
					</div>
					<p className='text-sm text-slate-400 mt-1 max-w-xl'>
						A state-of-the-art row-store spreadsheet engine core. Supports dynamic valueGetters, custom editors, column resizing, and
						stable Row ID pointers.
					</p>
				</div>

				{/* Dynamic Navigation Mode Tabs */}
				<div className='flex p-1 bg-slate-900 border border-slate-800 rounded-xl shrink-0'>
					<button
						onClick={() => setActiveTab('client')}
						className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
							activeTab === 'client'
								? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20'
								: 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
						}`}
					>
						<Cpu className='w-4 h-4' />
						Client Performance (10k Rows)
					</button>
					<button
						onClick={() => setActiveTab('server')}
						className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
							activeTab === 'server'
								? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20'
								: 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
						}`}
					>
						<Server className='w-4 h-4' />
						Server Infinite scroll (100k Rows)
					</button>
				</div>
			</header>

			{/* Grid Controller View */}
			<main className='flex-1 min-h-0 flex flex-col md:flex-row gap-6 mt-6 overflow-hidden'>
				{/* Left Side: Real-time Interactive Grid Viewport */}
				<div className='flex-1 min-h-0 min-w-0'>
					{activeTab === 'client' ? (
						<GridProvider store={clientStore}>
							<GridView
								rowHeights={{}}
								onCellValueChanged={handleClientCellValueChanged}
								clientController={clientController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
							/>
						</GridProvider>
					) : (
						<GridProvider store={serverStore}>
							<GridView
								rowHeights={{}}
								onCellValueChanged={() => {}}
								serverController={serverController}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
							/>
						</GridProvider>
					)}
				</div>

				{/* Right Side: Visual Metrics & Control Dashboard Panel */}
				<div className='w-full md:w-80 flex flex-col gap-6 shrink-0 overflow-y-auto'>
					{/* Active coordinate coordinates indicator */}
					<StateInspector store={activeTab === 'client' ? clientStore : serverStore} />

					<div className='p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-4 shrink-0'>
						<h3 className='text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Filter className='w-4 h-4 text-emerald-400' />
							Sort & Filter
						</h3>

						<div className='grid grid-cols-2 gap-3'>
							<label className='flex flex-col gap-1.5'>
								<span className='text-[10px] text-slate-400 font-semibold uppercase tracking-wide'>Sort Field</span>
								<select
									value={sortField}
									onChange={(e) => setSortField(e.target.value as keyof DemoRow)}
									className='w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-purple-500 transition-all font-semibold cursor-pointer'
								>
									{COLUMNS.map((column) => (
										<option key={column.field} value={column.field}>
											{column.header}
										</option>
									))}
								</select>
							</label>

							<label className='flex flex-col gap-1.5'>
								<span className='text-[10px] text-slate-400 font-semibold uppercase tracking-wide'>Status</span>
								<select
									value={statusFilter}
									onChange={(e) => setStatusFilter(e.target.value as 'All' | DemoRow['status'])}
									className='w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-purple-500 transition-all font-semibold cursor-pointer'
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
								className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold border transition-all ${
									sortDirection === 'asc'
										? 'bg-purple-600 border-purple-500 text-white'
										: 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
								}`}
							>
								<ArrowDownAZ className='w-3.5 h-3.5' />
								Asc
							</button>
							<button
								onClick={() => setSortDirection('desc')}
								className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold border transition-all ${
									sortDirection === 'desc'
										? 'bg-purple-600 border-purple-500 text-white'
										: 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
								}`}
							>
								<ArrowUpAZ className='w-3.5 h-3.5' />
								Desc
							</button>
						</div>
					</div>

					{/* Pluggable Accessibility Configuration Options */}
					<div className='p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-4 shrink-0'>
						<h3 className='text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Keyboard className='w-4 h-4 text-purple-400' />
							Grid Accessibility
						</h3>

						<div className='flex flex-col gap-3.5'>
							{/* Edit Trigger Mode Dropdown */}
							<div className='flex flex-col gap-1.5'>
								<label className='text-[10px] text-slate-400 font-semibold uppercase tracking-wide'>Edit Trigger</label>
								<select
									value={editTrigger}
									onChange={(e) => setEditTrigger(e.target.value as 'singleClick' | 'doubleClick')}
									className='w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-purple-500 transition-all font-sans font-semibold cursor-pointer'
								>
									<option value='doubleClick'>Double-Click to Edit (Excel)</option>
									<option value='singleClick'>Single-Click to Edit</option>
								</select>
							</div>

							{/* Arrow Key Navigation Auto-Edit Checkbox */}
							<label className='flex items-center gap-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-900 hover:border-slate-800 cursor-pointer select-none transition-all'>
								<input
									type='checkbox'
									checked={arrowKeyNavigationEdit}
									onChange={(e) => setArrowKeyNavigationEdit(e.target.checked)}
									className='rounded border-slate-800 text-purple-600 focus:ring-purple-500/20 w-3.5 h-3.5 bg-slate-950 cursor-pointer'
								/>
								<div className='flex flex-col'>
									<span className='text-xs font-semibold text-slate-200'>Arrow Key Auto-Edit</span>
									<span className='text-[9px] text-slate-500 mt-0.5'>Auto-open cell in edit state when navigating</span>
								</div>
							</label>
						</div>
					</div>

					{/* Premium Pluggable Live Event Log Panel */}
					<LiveEventLogPanel store={activeTab === 'client' ? clientStore : serverStore} />

					{/* Quick interactive utility scripts */}
					<div className='p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-4 shrink-0'>
						<h3 className='text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Layers className='w-4 h-4 text-purple-400' />
							Developer Panel
						</h3>

						{activeTab === 'client' ? (
							<div className='flex flex-col gap-3'>
								<button
									onClick={() => {
										clientController.updateRows((rows) =>
											rows.map((row) => ({
												...row,
												price: '0',
												quantity: '0',
											}))
										);
									}}
									className='flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 hover:text-white text-xs font-semibold transition-all'
								>
									<RefreshCw className='w-3.5 h-3.5' />
									Reset Client Prices to Zero
								</button>
								<div className='p-3 bg-slate-950 border border-slate-900 rounded-lg text-slate-400 text-xs leading-relaxed'>
									<strong>Status Editor Side-Effect</strong>: Changing Status to <strong>Inactive</strong> programmatically sets
									Price and Quantity to 0 for that row!
								</div>
							</div>
						) : (
							<div className='flex flex-col gap-3'>
								<button
									onClick={() => {
										serverController.purgeCache();
									}}
									className='flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 hover:text-white text-xs font-semibold transition-all'
								>
									<RefreshCw className='w-3.5 h-3.5' />
									Purge Block Cache
								</button>
								<div className='p-3 bg-slate-950 border border-slate-900 rounded-lg text-slate-400 text-xs leading-relaxed'>
									<strong>Server Blocks</strong>: Data is loaded dynamically in chunks of 100 rows with simulated network delay.
									Purging cache empties blocks, forcing fresh server queries as you scroll.
								</div>
							</div>
						)}
					</div>

					{/* Quick Accessibility Guide */}
					<div className='p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3'>
						<h3 className='text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<HelpCircle className='w-4 h-4 text-emerald-400' />
							Keyboard Shortcuts
						</h3>
						<ul className='text-slate-400 text-xs leading-relaxed flex flex-col gap-2 font-medium'>
							<li className='flex justify-between border-b border-slate-900 pb-1.5'>
								<span>Navigate Cells</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[10px]'>Arrow Keys</span>
							</li>
							<li className='flex justify-between border-b border-slate-900 pb-1.5'>
								<span>Expand Range</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[10px]'>Shift + Arrows</span>
							</li>
							<li className='flex justify-between border-b border-slate-900 pb-1.5'>
								<span>Enter Edit Mode</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[10px]'>Enter or Double Click</span>
							</li>
							<li className='flex justify-between border-b border-slate-900 pb-1.5'>
								<span>Immediate Type</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[10px]'>Any Key</span>
							</li>
							<li className='flex justify-between border-b border-slate-900 pb-1.5'>
								<span>Commit & Down</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[10px]'>Enter</span>
							</li>
							<li className='flex justify-between pb-0.5'>
								<span>Cancel & Revert</span>
								<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[10px]'>Escape</span>
							</li>
						</ul>
					</div>
				</div>
			</main>
		</div>
	);
}
