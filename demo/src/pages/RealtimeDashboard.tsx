import React, { useState, useEffect, useMemo } from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { DashboardStockRow } from '../hooks/useShowroomStores';
import { GridView } from '../components/GridShared';
import { TrendingUp, BarChart3, ListFilter, Activity, RefreshCw } from 'lucide-react';

interface RealtimeDashboardProps {
	store: GridStore<DashboardStockRow>;
	controller: ClientRowModelController<DashboardStockRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
}

export default function RealtimeDashboard({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
}: RealtimeDashboardProps) {
	// Selection stats state
	const [stats, setStats] = useState({
		sum: 0,
		avg: 0,
		min: 0,
		max: 0,
		count: 0,
	});

	// Sparkline data state (maps current prices for drawing live SVG chart)
	const [prices, setPrices] = useState<number[]>([]);
	const [tickers, setTickers] = useState<string[]>([]);

	// Real-time Event Logger state
	const [eventLogs, setEventLogs] = useState<Array<{ time: string; msg: string }>>([]);

	// Hook into grid events
	useEffect(() => {
		const updateStatsAndChart = () => {
			const state = store.getState();
			const rowModel = store.getRowModel();
			if (!rowModel) return;

			// A. Recalculate selection math
			const range = state.selectedRange;
			if (range) {
				const startIdx = rowModel.getRowIndexById(range.start.rowId);
				const endIdx = rowModel.getRowIndexById(range.end.rowId);
				const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
				const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);

				if (startIdx !== -1 && endIdx !== -1 && startColIdx !== -1 && endColIdx !== -1) {
					const minRow = Math.min(startIdx, endIdx);
					const maxRow = Math.max(startIdx, endIdx);
					const minCol = Math.min(startColIdx, endColIdx);
					const maxCol = Math.max(startColIdx, endColIdx);

					const cols = state.columns.slice(minCol, maxCol + 1).map((c) => c.field);
					const rowIds: string[] = [];
					for (let i = minRow; i <= maxRow; i++) {
						const node = rowModel.getRowNode ? rowModel.getRowNode(i) : null;
						if (node) rowIds.push(node.id);
					}

					let numericValues: number[] = [];
					for (const rowId of rowIds) {
						for (const col of cols) {
							const cellVal = store.getCellValue(rowId, col);
							if (cellVal !== undefined) {
								const num = parseFloat(String(cellVal));
								if (!Number.isNaN(num)) {
									numericValues.push(num);
								}
							}
						}
					}

					if (numericValues.length > 0) {
						const sum = numericValues.reduce((a, b) => a + b, 0);
						const count = numericValues.length;
						const avg = sum / count;
						const min = Math.min(...numericValues);
						const max = Math.max(...numericValues);
						setStats({ sum, avg, min, max, count });
					} else {
						setStats({ sum: 0, avg: 0, min: 0, max: 0, count: 0 });
					}
				}
			} else {
				setStats({ sum: 0, avg: 0, min: 0, max: 0, count: 0 });
			}

			// B. Extract prices for live SVG Sparkline chart
			const count = controller.getRowCount();
			const currentRows: DashboardStockRow[] = [];
			for (let i = 0; i < count; i++) {
				const r = controller.getRow(i);
				if (r) currentRows.push(r);
			}
			if (currentRows.length > 0) {
				const allPrices = currentRows.map((r) => parseFloat(String(r.price)) || 0);
				const allTickers = currentRows.map((r) => r.id);
				setPrices(allPrices);
				setTickers(allTickers);
			}
		};

		const logEvent = (name: string, details: string) => {
			const time = new Date().toLocaleTimeString().split(' ')[0];
			setEventLogs((prev) => [{ time, msg: `[${name}] ${details}` }, ...prev].slice(0, 10));
		};

		// Initial load
		updateStatsAndChart();

		// Event subscriptions
		const unsubSelect = store.addEventListener('selectionChanged', (e) => {
			updateStatsAndChart();
			logEvent('selectionChanged', `Start: ${e.payload.start.rowId}:${e.payload.start.colField}`);
		});

		const unsubValue = store.addEventListener('cellValueChanged', (e) => {
			updateStatsAndChart();
			logEvent('cellValueChanged', `${e.payload.rowId}:${e.payload.colField} => ${e.payload.value}`);
		});

		const unsubFocus = store.addEventListener('focusChanged', (e) => {
			logEvent('focusChanged', `Cell focus: ${e.payload.rowId}:${e.payload.colField}`);
		});

		return () => {
			unsubSelect();
			unsubValue();
			unsubFocus();
		};
	}, [store, controller]);

	// Math to generate SVG path from price array
	const svgPath = useMemo(() => {
		if (prices.length === 0) return '';
		const width = 500;
		const height = 110;
		const padding = 10;

		const minPrice = Math.min(...prices) * 0.95;
		const maxPrice = Math.max(...prices) * 1.05;
		const priceRange = maxPrice - minPrice || 1;

		const points = prices.map((price, idx) => {
			const x = padding + (idx / (prices.length - 1)) * (width - padding * 2);
			const y = height - padding - ((price - minPrice) / priceRange) * (height - padding * 2);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});

		return `M ${points.join(' L ')}`;
	}, [prices]);

	const svgAreaPath = useMemo(() => {
		if (prices.length === 0) return '';
		const width = 500;
		const height = 110;
		const padding = 10;
		const minPrice = Math.min(...prices) * 0.95;
		const maxPrice = Math.max(...prices) * 1.05;
		const priceRange = maxPrice - minPrice || 1;

		const points = prices.map((price, idx) => {
			const x = padding + (idx / (prices.length - 1)) * (width - padding * 2);
			const y = height - padding - ((price - minPrice) / priceRange) * (height - padding * 2);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});

		const startX = padding;
		const endX = padding + (prices.length - 1) / (prices.length - 1) * (width - padding * 2);
		const bottomY = height - padding;

		return `M ${startX},${bottomY} L ${points.join(' L ')} L ${endX},${bottomY} Z`;
	}, [prices]);

	// Simulate bulk stock volatility
	const triggerVolatility = () => {
		controller.updateRows((rows) =>
			rows.map((row) => {
				const priceNum = parseFloat(row.price) || 0;
				const volatility = (Math.random() - 0.5) * 5; // up to 2.5% volatility
				const nextPrice = Math.max(1, priceNum * (1 + volatility / 100));
				const priceDiff = nextPrice - priceNum;
				const changeNum = parseFloat(row.change) || 0;
				const nextChange = changeNum + (priceDiff / priceNum) * 100;

				return {
					...row,
					price: nextPrice.toFixed(2),
					change: `${nextChange >= 0 ? '+' : ''}${nextChange.toFixed(1)}`,
				};
			})
		);
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Grid Panel */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0'>
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-emerald-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>
							Real-Time Market Grid
						</span>
					</div>
					<button
						onClick={triggerVolatility}
						className='flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 font-bold text-[10px] text-white border border-emerald-500/20 shadow-md transition-all cursor-pointer'
					>
						<RefreshCw className='w-3 h-3' />
						Trigger Market Volatility
					</button>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<GridProvider store={store}>
						<GridView
							store={store}
							pinLeftColumns={1}
							pinRightColumns={1}
							onCellValueChanged={onCellValueChanged}
							clientController={controller}
							editTrigger={editTrigger}
							arrowKeyNavigationEdit={arrowKeyNavigationEdit}
						/>
					</GridProvider>
				</div>
			</div>

			{/* Right Column: Plugins & Analytics Cards */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* 1. SELECTION ANALYTICS PLUGIN */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<BarChart3 className='w-4 h-4 text-purple-400' />
						Selection Stats Plugin
					</h3>

					{stats.count === 0 ? (
						<div className='text-[10px] text-slate-500 italic p-3 bg-slate-950/60 border border-slate-900 rounded-lg text-center leading-normal'>
							Drag a range of cells (prices, changes, volumes) to calculate real-time statistics!
						</div>
					) : (
						<div className='grid grid-cols-2 gap-2.5'>
							<div className='p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col'>
								<span className='text-[8px] text-slate-500 font-bold uppercase'>Range Sum</span>
								<span className='text-sm font-extrabold text-purple-400 mt-0.5'>
									{stats.sum.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
								</span>
							</div>
							<div className='p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col'>
								<span className='text-[8px] text-slate-500 font-bold uppercase'>Average</span>
								<span className='text-sm font-extrabold text-indigo-400 mt-0.5'>
									{stats.avg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
								</span>
							</div>
							<div className='p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col'>
								<span className='text-[8px] text-slate-500 font-bold uppercase'>Min Value</span>
								<span className='text-sm font-extrabold text-emerald-400 mt-0.5'>
									{stats.min.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
								</span>
							</div>
							<div className='p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col'>
								<span className='text-[8px] text-slate-500 font-bold uppercase'>Max Value</span>
								<span className='text-sm font-extrabold text-pink-400 mt-0.5'>
									{stats.max.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
								</span>
							</div>
							<div className='col-span-2 p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex items-center justify-between'>
								<span className='text-[8px] text-slate-500 font-bold uppercase'>Highlighted Count</span>
								<span className='text-xs font-mono font-bold text-slate-300'>
									{stats.count} cells selected
								</span>
							</div>
						</div>
					)}
				</div>

				{/* 2. REAL-TIME SVG AREA CHART PLUGIN */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<TrendingUp className='w-4 h-4 text-emerald-400' />
						Market price distribution
					</h3>

					{prices.length === 0 ? (
						<div className='h-28 flex items-center justify-center text-xs text-slate-600 italic bg-slate-950/60 border border-slate-900 rounded-lg'>
							Awaiting price metrics...
						</div>
					) : (
						<div className='flex flex-col gap-2 bg-slate-950/90 border border-slate-900 rounded-lg p-2.5'>
							{/* Beautiful SVG Area Chart */}
							<svg viewBox='0 0 500 110' className='w-full h-24 overflow-visible'>
								<defs>
									<linearGradient id='areaGrad' x1='0' y1='0' x2='0' y2='1'>
										<stop offset='0%' stopColor='#10b981' stopOpacity='0.3' />
										<stop offset='100%' stopColor='#10b981' stopOpacity='0.0' />
									</linearGradient>
								</defs>

								{/* Grid Lines */}
								<line x1='10' y1='10' x2='490' y2='10' stroke='#334155' strokeWidth='0.5' strokeDasharray='2,2' />
								<line x1='10' y1='55' x2='490' y2='55' stroke='#334155' strokeWidth='0.5' strokeDasharray='2,2' />
								<line x1='10' y1='100' x2='490' y2='100' stroke='#334155' strokeWidth='0.5' strokeDasharray='2,2' />

								{/* Filled Area */}
								<path d={svgAreaPath} fill='url(#areaGrad)' className='transition-all duration-300 ease-out' />

								{/* Line Path */}
								<path d={svgPath} fill='none' stroke='#10b981' strokeWidth='2' className='transition-all duration-300 ease-out' />

								{/* Interactive Nodes */}
								{prices.map((price, idx) => {
									const minPrice = Math.min(...prices) * 0.95;
									const maxPrice = Math.max(...prices) * 1.05;
									const priceRange = maxPrice - minPrice || 1;
									const x = 10 + (idx / (prices.length - 1)) * (500 - 10 * 2);
									const y = 110 - 10 - ((price - minPrice) / priceRange) * (110 - 10 * 2);
									return (
										<circle
											key={idx}
											cx={x}
											cy={y}
											r='3.5'
											className='fill-slate-950 stroke-emerald-400 stroke-2 hover:r-5 cursor-help transition-all duration-300'
										>
											<title>{tickers[idx]}: ${price.toFixed(2)}</title>
										</circle>
									);
								})}
							</svg>
							<div className='flex justify-between text-[8px] text-slate-500 font-extrabold uppercase mt-1'>
								<span>{tickers[0]}</span>
								<span>Assets Portfolio Profile</span>
								<span>{tickers[tickers.length - 1]}</span>
							</div>
						</div>
					)}
				</div>

				{/* 3. CORE PLUGIN LOGGER */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Activity className='w-4 h-4 text-purple-400' />
						Active Core Events Logger
					</h3>

					<div className='flex flex-col gap-1.5 max-h-40 overflow-y-auto font-mono text-[8px] text-purple-300 leading-snug'>
						{eventLogs.length === 0 ? (
							<div className='text-slate-600 italic p-2 bg-slate-950/60 border border-slate-900 rounded-lg'>
								Interact with the grid (select ranges, edit prices, navigate cells) to see real-time listener events!
							</div>
						) : (
							eventLogs.map((log, i) => (
								<div key={i} className='p-1.5 bg-slate-950/70 border border-slate-900 rounded flex gap-1.5 justify-between items-start'>
									<span className='text-slate-500 shrink-0'>{log.time}</span>
									<span className='break-all flex-1'>{log.msg}</span>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
