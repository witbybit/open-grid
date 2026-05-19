import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GridStore, ServerRowModelController, IGridDatasource } from '@open-grid/core';
import {
	GridProvider,
	useGridStore,
	useGridApi,
	useGridSelector,
	useGridCell,
	useCellSelectionState,
	useCellEditState,
	useGridNavigationController,
	CellEditorProps,
	Cell as ReactCell,
} from '@open-grid/react';
import { Cpu, Server, RefreshCw, Zap, TableProperties, HelpCircle, Layers, Terminal, Keyboard } from 'lucide-react';

// ==========================================
// A. Custom Status Editor using GridApi
// ==========================================
const StatusCellEditor = ({ row, col, value, onChange, onCommit, api }: CellEditorProps) => {
	return (
		<select
			autoFocus
			value={value}
			onChange={(e) => {
				const nextVal = e.target.value;
				onChange(nextVal);

				// Commit after updating activeEditValue so stopEditing writes the selected value.
				onCommit();

				if (nextVal === 'Inactive') {
					api.setCellValue(row, 2, '0');
					api.setCellValue(row, 3, '0');
				}
			}}
			onMouseDown={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
			onBlur={() => {
				// Delay blur closure slightly to avoid double-click focus races
				setTimeout(() => {
					onCommit();
				}, 150);
			}}
			className='absolute inset-0 w-full h-full px-3 text-sm bg-slate-900 text-white border-2 border-purple-500 outline-none z-20 font-medium cursor-pointer'
		>
			<option value='Active'>Active</option>
			<option value='Pending'>Pending</option>
			<option value='Inactive'>Inactive</option>
		</select>
	);
};

// Define our grid column definitions
interface ColumnDef {
	header: string;
	width: number;
	cellEditor?: React.ComponentType<CellEditorProps>;
}

const COLUMNS: ColumnDef[] = [
	{ header: 'Row ID', width: 80 },
	{ header: 'Product Name', width: 180 },
	{ header: 'Price ($)', width: 120 },
	{ header: 'Quantity', width: 100 },
	{ header: 'Subtotal ($)', width: 140 },
	{ header: 'Status', width: 120, cellEditor: StatusCellEditor },
];

const DEFAULT_ROW_HEIGHT = 38;

// ==========================================
// B. Interactive Column Resizing Header Cell
// ==========================================
interface HeaderCellProps {
	colIndex: number;
	header: string;
	width: number;
	api: ReturnType<typeof useGridApi>;
}

const HeaderCell = React.memo(({ colIndex, header, width, api }: HeaderCellProps) => {
	// Subscribe to changes in this column's width
	const colWidth = useGridSelector((state) => state.colWidths[colIndex] ?? width);

	const handleMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		const startX = e.clientX;
		const startWidth = colWidth;

		const handleMouseMove = (moveEvent: MouseEvent) => {
			const deltaX = moveEvent.clientX - startX;
			const nextWidth = Math.max(60, startWidth + deltaX);
			api.setColumnWidth(colIndex, nextWidth);
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
			{/* Dynamic Glow Handle for drag-resizing */}
			<div
				onMouseDown={handleMouseDown}
				className='absolute right-0 top-0 w-1.5 h-full cursor-col-resize hover:bg-purple-500/80 bg-slate-800 transition-colors duration-150 z-20 group-hover:bg-slate-700'
			/>
		</div>
	);
});

HeaderCell.displayName = 'HeaderCell';

// ==========================================
// C. High Performance Grid Cell Component
// ==========================================
interface CellProps {
	row: number;
	col: number;
	navigation: ReturnType<typeof useGridNavigationController>;
}

const Cell = React.memo(({ row, col, navigation }: CellProps) => {
	const customEditor = COLUMNS[col].cellEditor;

	// Custom cell formatting for Status (col index 5)
	const renderValue = useCallback(
		(value: any, computedValue: any) => {
			if (col === 5) {
				const colorClass =
					value === 'Active'
						? 'text-emerald-400 font-medium'
						: value === 'Pending'
							? 'text-amber-400 font-medium'
							: 'text-slate-500 font-medium';
				return <span className={`truncate ${colorClass}`}>{computedValue ?? value}</span>;
			}
			return <span className='truncate'>{computedValue ?? value}</span>;
		},
		[col]
	);

	return <ReactCell row={row} col={col} navigation={navigation} customEditor={customEditor} renderValue={renderValue} />;
});

Cell.displayName = 'Cell';

// ==========================================
// D. High Performance Grid Body
// ==========================================
interface GridViewProps {
	rowCount: number;
	rowHeights: Record<number, number>;
	onCellValueChanged: (row: number, col: number, val: any) => void;
	serverController?: ServerRowModelController;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

function GridView({
	rowCount,
	rowHeights,
	onCellValueChanged,
	serverController,
	editTrigger = 'doubleClick',
	arrowKeyNavigationEdit = false,
}: GridViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const store = useGridStore();
	const api = useGridApi();
	const navigation = useGridNavigationController({
		onCellValueChanged,
		editTrigger,
		arrowKeyNavigationEdit,
	});

	// Keyboard navigation attachment
	useEffect(() => {
		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			// Only capture keyboard if focusing inside grid or body
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
		estimateSize: (index) => rowHeights[index] ?? DEFAULT_ROW_HEIGHT,
		overscan: 10,
	});

	// If server row model controller exists, trigger fetching on scroll window viewport
	const virtualRows = rowVirtualizer.getVirtualItems();
	useEffect(() => {
		if (serverController && virtualRows.length > 0) {
			virtualRows.forEach((row) => {
				serverController.getRow(row.index);
			});
		}
	}, [virtualRows, serverController]);

	return (
		<div className='flex flex-col h-full border border-slate-800 rounded-lg overflow-hidden bg-slate-950 shadow-2xl'>
			{/* Sticky Table Header */}
			<div className='flex bg-slate-900 border-b border-slate-800 shrink-0 select-none z-10'>
				{COLUMNS.map((col, i) => (
					<HeaderCell key={i} colIndex={i} header={col.header} width={col.width} api={api} />
				))}
			</div>

			{/* Virtual Scroll Window Container */}
			<div ref={containerRef} className='flex-1 overflow-auto outline-none' tabIndex={0}>
				<div className='relative w-full' style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
					{virtualRows.map((virtualRow) => {
						const rowIndex = virtualRow.index;

						// If in server-side mode, query row data from block paginator
						if (serverController) {
							const { data, isLoading } = serverController.getRow(rowIndex);

							if (isLoading) {
								return (
									<div
										key={virtualRow.key}
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

							// Pre-populate store values with fetched block row data dynamically
							if (data) {
								COLUMNS.forEach((_, colIndex) => {
									const key = `${rowIndex},${colIndex}`;
									const current = store.getState().cells[key]?.value;
									const nextVal = data[colIndex];
									if (current !== nextVal) {
										store.setCellValue(rowIndex, colIndex, nextVal);
									}
								});
							}
						}

						return (
							<div
								key={virtualRow.key}
								data-virtual-row
								className='absolute left-0 top-0 w-full flex border-b border-slate-900'
								style={{
									height: `${virtualRow.size}px`,
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								{COLUMNS.map((_, colIndex) => (
									<Cell key={colIndex} row={rowIndex} col={colIndex} navigation={navigation} />
								))}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

interface StateInspectorProps {
	store: GridStore;
}

const StateInspectorContent = () => {
	const gridStateInfo = useGridSelector((state) => {
		const focus = state.focusedCell;
		const range = state.selectedRange;

		const focusText = focus ? `Row ${focus.row}, Col ${focus.col}` : 'None';
		const rangeText = range ? `(${range.start.row},${range.start.col}) to (${range.end.row},${range.end.col})` : 'None';

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
				* Cell coordinates reflect absolute indexes in memory. Updates bypass React's virtual DOM tree using targeted micro-subscriptions to
				maximize rendering framerate.
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
	store: GridStore;
}

const LiveEventLogPanel = React.memo(({ store }: LiveEventLogPanelProps) => {
	const [eventLogs, setEventLogs] = useState<string[]>([]);

	useEffect(() => {
		// Clear logs on store switch
		setEventLogs([]);

		const formatLog = (name: string, payload: any) => {
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

		return () => {
			unsubValue();
			unsubResize();
			unsubFocus();
			unsubSelect();
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

	// A. Create Client-Side Grid Instance
	const clientStore = useMemo(() => {
		const store = new GridStore({
			rowCount: 10000,
			colCount: COLUMNS.length,
			rowHeights: {},
			colWidths: COLUMNS.reduce((acc, col, i) => ({ ...acc, [i]: col.width }), {}),
		});

		// Populate initial Client Data (10,000 rows)
		const initialCells: Record<string, any> = {};
		const statuses = ['Active', 'Pending', 'Inactive'];
		const products = ['Laser Keyboard', 'Wireless Mouse', 'Mechanical Keycap', 'Sleek Stand', 'Ergonomic Desk', 'Premium Webcam'];

		for (let r = 0; r < 10000; r++) {
			const price = Math.floor(Math.random() * 200) + 15;
			const qty = Math.floor(Math.random() * 10) + 1;
			const subtotal = (price * qty).toFixed(2);

			initialCells[`${r},0`] = {
				value: `R-${100000 + r}`,
				computedValue: `R-${100000 + r}`,
			};
			initialCells[`${r},1`] = {
				value: products[r % products.length],
				computedValue: products[r % products.length],
			};
			initialCells[`${r},2`] = {
				value: price.toString(),
				computedValue: price.toString(),
			};
			initialCells[`${r},3`] = {
				value: qty.toString(),
				computedValue: qty.toString(),
			};
			initialCells[`${r},4`] = { value: subtotal, computedValue: subtotal };
			initialCells[`${r},5`] = {
				value: statuses[r % statuses.length],
				computedValue: statuses[r % statuses.length],
			};
		}

		store.setState({ cells: initialCells });
		return store;
	}, []);

	// Pluggable formula recalculations on edit commit
	const handleClientCellValueChanged = useCallback(
		(row: number, col: number, val: any) => {
			// If Price (2) or Quantity (3) edits committed, recalculate Subtotal (4)
			if (col === 2 || col === 3) {
				const priceVal = clientStore.getCellState(row, 2).value;
				const qtyVal = clientStore.getCellState(row, 3).value;
				const price = parseFloat(priceVal) || 0;
				const qty = parseInt(qtyVal, 10) || 0;
				const subtotal = (price * qty).toFixed(2);

				clientStore.setCellValue(row, 4, subtotal);
			}
		},
		[clientStore]
	);

	// B. Create Server-Side Grid Instance
	const serverStore = useMemo(() => {
		return new GridStore({
			rowCount: 100000, // 100,000 rows
			colCount: COLUMNS.length,
			rowHeights: {},
			colWidths: COLUMNS.reduce((acc, col, i) => ({ ...acc, [i]: col.width }), {}),
		});
	}, []);

	// Generate remote paginated datasource with simulated 450ms block loading delay
	const mockDatasource = useMemo<IGridDatasource>(() => {
		const products = ['Neon Controller', 'Haptic Earphone', 'VR Headset', 'Smart Mug', 'RGB Cable', 'Cozy Blanket'];
		const statuses = ['Active', 'Pending', 'Inactive'];

		return {
			getRows: async (params) => {
				// Simulate network roundtrip latency
				await new Promise((resolve) => setTimeout(resolve, 450));

				const rows: any[][] = [];
				const length = params.endRow - params.startRow;

				for (let i = 0; i < length; i++) {
					const r = params.startRow + i;
					const price = Math.floor(Math.random() * 150) + 10;
					const qty = Math.floor(Math.random() * 5) + 1;
					const subtotal = (price * qty).toFixed(2);

					rows.push([
						`SR-${100000 + r}`,
						products[r % products.length],
						price.toString(),
						qty.toString(),
						subtotal,
						statuses[r % statuses.length],
					]);
				}

				return {
					rows,
					totalCount: 100000,
				};
			},
		};
	}, []);

	const serverController = useMemo(() => {
		return new ServerRowModelController(serverStore, {
			datasource: mockDatasource,
			blockSize: 100,
		});
	}, [serverStore, mockDatasource]);

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
							v2.0.0
						</span>
					</div>
					<p className='text-sm text-slate-400 mt-1 max-w-xl'>
						A high-performance modular spreadsheet engine core. Upgrade features include interactive resizing, pluggable events, and
						custom editors.
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
								rowCount={10000}
								rowHeights={{}}
								onCellValueChanged={handleClientCellValueChanged}
								editTrigger={editTrigger}
								arrowKeyNavigationEdit={arrowKeyNavigationEdit}
							/>
						</GridProvider>
					) : (
						<GridProvider store={serverStore}>
							<GridView
								rowCount={100000}
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
										const store = clientStore;
										const cells = { ...store.getState().cells };
										// Reset all subtotals
										for (let r = 0; r < 10000; r++) {
											cells[`${r},2`] = { value: '0', computedValue: '0' };
											cells[`${r},3`] = { value: '0', computedValue: '0' };
											cells[`${r},4`] = {
												value: '0.00',
												computedValue: '0.00',
											};
										}
										store.setState({ cells });
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
