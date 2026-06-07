import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { GridProvider, useClientGrid } from '@open-grid/react';
import { DashboardStockRow } from '../hooks/useShowroomStores';
import { GridView } from '../components/GridShared';
import { TrendingUp, BarChart3, Activity, RefreshCw, Zap, Code2 } from 'lucide-react';

type ClientApi = ReturnType<typeof useClientGrid<DashboardStockRow>>;
interface RealtimeDashboardProps {
	api: ClientApi;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
}

export default function RealtimeDashboard({ api, editTrigger, arrowKeyNavigationEdit, onCellValueChanged }: RealtimeDashboardProps) {
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
	const [eventLogs, setEventLogs] = useState<Array<{ time: string; msg: string; type: string }>>([]);

	// Auto-volatility ticker
	const [autoFire, setAutoFire] = useState(false);
	const autoFireRef = useRef(false);
	autoFireRef.current = autoFire;
	const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Dynamic styleSlots for live-updating dashboard cells & rows
	useEffect(() => {
		api.setStyleSlots({
			rowClass: (row) => {
				const r = row as DashboardStockRow;
				if (!r) return '';
				let base = 'transition-all duration-200 border-l-2 ';
				const changeVal = parseFloat(r.change) || 0;
				if (changeVal > 0) {
					return base + 'border-emerald-500/60 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-100/90';
				} else if (changeVal < 0) {
					return base + 'border-rose-500/60 bg-rose-950/5 hover:bg-rose-900/10 text-rose-100/90';
				}
				return base + 'border-slate-800 bg-slate-900/5 hover:bg-slate-800/10';
			},
			cellClass: (col, row) => {
				const r = row as DashboardStockRow;
				if (!r) return '';
				if (col.field === 'change') {
					const changeVal = parseFloat(r.change) || 0;
					if (changeVal > 0) {
						return 'text-emerald-400 font-extrabold font-mono';
					} else if (changeVal < 0) {
						return 'text-rose-400 font-extrabold font-mono';
					}
				}
				if (col.field === 'price') {
					return 'font-mono font-bold text-slate-200';
				}
				if (col.field === 'risk') {
					if (r.risk === 'High') return 'text-rose-450 font-bold';
					if (r.risk === 'Medium') return 'text-amber-450 font-bold';
					return 'text-emerald-450 font-bold';
				}
				return '';
			},
			headerCellClass: (col) => {
				if (col.field === 'change') {
					return 'bg-emerald-950/10 text-emerald-400 font-extrabold border-b border-emerald-900/20';
				}
				return 'font-semibold text-slate-400';
			},
		});
	}, [api]);

	// Hook into grid events
	useEffect(() => {
		const updateStatsAndChart = () => {
			const state = api.getState();

			// A. Recalculate selection math
			const range = state.selection.range;
			if (range) {
				const rowIds = api.rows().inRange(range).getIds();
				const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
				const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);

				if (rowIds.length > 0 && startColIdx !== -1 && endColIdx !== -1) {
					const minCol = Math.min(startColIdx, endColIdx);
					const maxCol = Math.max(startColIdx, endColIdx);

					const cols = state.columns.slice(minCol, maxCol + 1).map((c) => c.field);

					let numericValues: number[] = [];
					for (const rowId of rowIds) {
						for (const col of cols) {
							const cellVal = api.getCellValue(rowId, col);
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
			const currentRows = api.rows().getAll();
			if (currentRows.length > 0) {
				const allPrices = currentRows.map((r) => parseFloat(String(r.price)) || 0);
				const allTickers = currentRows.map((r) => r.id);
				setPrices(allPrices);
				setTickers(allTickers);
			}
		};

		const logEvent = (name: string, details: string, type = 'info') => {
			const time = new Date().toLocaleTimeString().split(' ')[0];
			setEventLogs((prev) => [{ time, msg: `[${name}] ${details}`, type }, ...prev].slice(0, 10));
		};

		// Initial load
		updateStatsAndChart();

		// Event subscriptions
		const unsubSelect = api.addEventListener('selectionChanged', (e) => {
			updateStatsAndChart();
			logEvent('selectionChanged', `Selected range details updated.`, 'selection');
		});

		// cellValueChanged fires for individual cell edits (e.g. user typing in a cell)
		const unsubValue = api.addEventListener<{ rowId: string; colField: string; value: unknown }>('cellValueChanged', (e) => {
			updateStatsAndChart();
			logEvent('cellValueChanged', `${e.payload.rowId}:${e.payload.colField} => ${e.payload.value}`, 'edit');
		});

		// rowsUpdated fires for bulk operations (updateRows / applyTransaction)
		const unsubRowsUpdated = api.addEventListener<{ changedNodes: unknown[] }>('rowsUpdated', (e) => {
			updateStatsAndChart();
			logEvent('rowsUpdated', `${e.payload.changedNodes?.length ?? 0} rows updated in batch`, 'info');
		});

		const unsubFocus = api.addEventListener<{ focus: { rowId: string; colField: string } | null }>('focusChanged', (e) => {
			const focus = e.payload.focus;
			logEvent('focusChanged', focus ? `Cell focus: ${focus.rowId}:${focus.colField}` : 'Cell focus cleared', 'focus');
		});

		return () => {
			unsubSelect();
			unsubValue();
			unsubRowsUpdated();
			unsubFocus();
		};
	}, [api]);

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
		const endX = padding + ((prices.length - 1) / (prices.length - 1)) * (width - padding * 2);
		const bottomY = height - padding;

		return `M ${startX},${bottomY} L ${points.join(' L ')} L ${endX},${bottomY} Z`;
	}, [prices]);

	// Simulate bulk stock volatility — fires all 10 rows at once
	const triggerVolatility = useCallback(() => {
		api.updateRows((rows) =>
			rows.map((row) => {
				const priceNum = parseFloat(row.price) || 0;
				const volatility = (Math.random() - 0.5) * 8;
				const nextPrice = Math.max(1, priceNum * (1 + volatility / 100));
				const priceDiff = nextPrice - priceNum;
				const changeNum = parseFloat(row.change) || 0;
				const nextChange = changeNum + (priceDiff / priceNum) * 100;
				const volumeNum = parseFloat(row.volume) || 0;
				const nextVolume = Math.max(0.1, volumeNum * (1 + (Math.random() - 0.5) * 0.3));

				return {
					...row,
					price: nextPrice.toFixed(2),
					change: `${nextChange >= 0 ? '+' : ''}${nextChange.toFixed(1)}`,
					volume: nextVolume.toFixed(1),
				};
			})
		);
	}, [api]);

	// Toggle 100ms continuous auto-fire to stress-test the renderers
	const toggleAutoFire = useCallback(() => {
		const next = !autoFireRef.current;
		setAutoFire(next);
		if (next) {
			autoIntervalRef.current = setInterval(triggerVolatility, 100);
		} else {
			if (autoIntervalRef.current) {
				clearInterval(autoIntervalRef.current);
				autoIntervalRef.current = null;
			}
		}
	}, [triggerVolatility]);

	useEffect(
		() => () => {
			if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
		},
		[]
	);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Grid Panel */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-emerald-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-emerald-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<Activity className='w-3.5 h-3.5 text-emerald-400' />
							Real-Time Option Greeks & Market Feeds
						</span>
					</div>
					<button
						onClick={toggleAutoFire}
						className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg font-bold text-[10px] border shadow-lg transition-all cursor-pointer ${
							autoFire
								? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-500/20 shadow-rose-900/20'
								: 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
						}`}
					>
						<Zap className={`w-3 h-3 ${autoFire ? 'animate-pulse' : ''}`} />
						{autoFire ? 'Auto 10hz ON' : 'Auto 10hz'}
					</button>
					<button
						onClick={triggerVolatility}
						className='flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 font-bold text-[10px] text-white border border-emerald-500/20 shadow-lg hover:shadow-emerald-900/20 transition-all cursor-pointer'
					>
						<RefreshCw className='w-3 h-3 animate-spin-slow' />
						Trigger Market Volatility
					</button>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<GridProvider api={api}>
						<GridView
							api={api}
							pinLeftColumns={1}
							pinRightColumns={1}
							onCellValueChanged={onCellValueChanged}
							editTrigger={editTrigger}
							arrowKeyNavigationEdit={arrowKeyNavigationEdit}
						/>
					</GridProvider>
				</div>
			</div>

			{/* Right Column: Plugins & Analytics Cards */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* 1. SELECTION ANALYTICS PLUGIN */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<BarChart3 className='w-4 h-4 text-purple-400' />
						Selection Stats Desk
					</h3>

					{stats.count === 0 ? (
						<div className='text-[10px] text-slate-500 italic p-3 bg-slate-950/60 border border-slate-900 rounded-lg text-center leading-normal'>
							Drag a range of cells (prices, changes, volumes) to calculate real-time statistics!
						</div>
					) : (
						<div className='grid grid-cols-2 gap-2 mt-1'>
							{/* KPI Card 1: Sum */}
							<div className='p-2.5 bg-slate-950 border border-slate-850 hover:border-purple-500/50 rounded-lg flex flex-col transition-all duration-300 group shadow-md'>
								<span className='text-[8px] text-slate-500 font-bold uppercase tracking-wider group-hover:text-purple-400 transition-colors'>
									Range Sum
								</span>
								<span className='text-xs font-extrabold text-purple-400 text-glow-purple mt-1'>
									{stats.sum.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
								</span>
							</div>

							{/* KPI Card 2: Avg */}
							<div className='p-2.5 bg-slate-950 border border-slate-850 hover:border-indigo-500/50 rounded-lg flex flex-col transition-all duration-300 group shadow-md'>
								<span className='text-[8px] text-slate-500 font-bold uppercase tracking-wider group-hover:text-indigo-400 transition-colors'>
									Average
								</span>
								<span className='text-xs font-extrabold text-indigo-400 text-glow-indigo mt-1'>
									{stats.avg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
								</span>
							</div>

							{/* KPI Card 3: Min */}
							<div className='p-2.5 bg-slate-950 border border-slate-850 hover:border-emerald-500/50 rounded-lg flex flex-col transition-all duration-300 group shadow-md'>
								<span className='text-[8px] text-slate-500 font-bold uppercase tracking-wider group-hover:text-emerald-400 transition-colors'>
									Min Value
								</span>
								<span className='text-xs font-extrabold text-emerald-400 text-glow-emerald mt-1'>
									{stats.min.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
								</span>
							</div>

							{/* KPI Card 4: Max */}
							<div className='p-2.5 bg-slate-950 border border-slate-850 hover:border-pink-500/50 rounded-lg flex flex-col transition-all duration-300 group shadow-md'>
								<span className='text-[8px] text-slate-500 font-bold uppercase tracking-wider group-hover:text-pink-400 transition-colors'>
									Max Value
								</span>
								<span className='text-xs font-extrabold text-pink-400 text-glow-pink mt-1'>
									{stats.max.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
								</span>
							</div>

							{/* Count */}
							<div className='col-span-2 p-2.5 bg-slate-950/80 border border-slate-900 hover:border-slate-800 rounded-lg flex items-center justify-between transition-all shadow-inner mt-0.5'>
								<span className='text-[8px] text-slate-500 font-bold uppercase tracking-wider'>Highlighted Capacity</span>
								<span className='text-[10px] font-mono font-bold text-slate-350'>{stats.count} cells active</span>
							</div>
						</div>
					)}
				</div>

				{/* 2. REAL-TIME SVG AREA CHART PLUGIN */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<TrendingUp className='w-4 h-4 text-emerald-400' />
						Market Price Distribution
					</h3>

					{prices.length === 0 ? (
						<div className='h-28 flex items-center justify-center text-xs text-slate-600 italic bg-slate-950/60 border border-slate-900 rounded-lg'>
							Awaiting price metrics...
						</div>
					) : (
						<div className='flex flex-col gap-2 bg-slate-950/90 border border-slate-900 rounded-lg p-2.5 shadow-inner'>
							{/* Beautiful Glowing SVG Area Chart */}
							<svg viewBox='0 0 500 110' className='w-full h-24 overflow-visible'>
								<defs>
									{/* Gradient area */}
									<linearGradient id='areaGrad' x1='0' y1='0' x2='0' y2='1'>
										<stop offset='0%' stopColor='#10b981' stopOpacity='0.35' />
										<stop offset='50%' stopColor='#6366f1' stopOpacity='0.1' />
										<stop offset='100%' stopColor='#6366f1' stopOpacity='0.0' />
									</linearGradient>
									{/* Stroke glow */}
									<filter id='svgGlow' x='-20%' y='-20%' width='140%' height='140%'>
										<feGaussianBlur stdDeviation='3.5' result='blur' />
										<feMerge>
											<feMergeNode in='blur' />
											<feMergeNode in='SourceGraphic' />
										</feMerge>
									</filter>
								</defs>

								{/* Grid Lines */}
								<line x1='10' y1='10' x2='490' y2='10' stroke='#1e293b' strokeWidth='0.5' strokeDasharray='2,2' />
								<line x1='10' y1='55' x2='490' y2='55' stroke='#1e293b' strokeWidth='0.5' strokeDasharray='2,2' />
								<line x1='10' y1='100' x2='490' y2='100' stroke='#1e293b' strokeWidth='0.5' strokeDasharray='2,2' />

								{/* Filled Area */}
								<path d={svgAreaPath} fill='url(#areaGrad)' className='transition-all duration-300 ease-out' />

								{/* Line Path with Glow */}
								<path
									d={svgPath}
									fill='none'
									stroke='#10b981'
									strokeWidth='2'
									filter='url(#svgGlow)'
									className='transition-all duration-300 ease-out'
								/>

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
											r='4'
											className='fill-slate-950 stroke-emerald-400 stroke-2 hover:r-6 cursor-help transition-all duration-300'
										>
											<title>
												{tickers[idx]}: ${price.toFixed(2)}
											</title>
										</circle>
									);
								})}
							</svg>
							<div className='flex justify-between text-[8px] text-slate-500 font-extrabold uppercase mt-1 tracking-wider'>
								<span>{tickers[0]}</span>
								<span>Assets Portfolio Profile</span>
								<span>{tickers[tickers.length - 1]}</span>
							</div>
						</div>
					)}
				</div>

				{/* 3. CORE PLUGIN LOGGER (SLEEK CARDS) */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Activity className='w-4 h-4 text-purple-400' />
						Active Core Events Logger
					</h3>

					<div className='flex flex-col gap-2 max-h-40 overflow-y-auto font-mono text-[9px] leading-snug'>
						{eventLogs.length === 0 ? (
							<div className='text-slate-600 italic p-3 bg-slate-950/60 border border-slate-900 rounded-lg text-center'>
								Interact with the grid (select ranges, edit prices, navigate cells) to see real-time listener events!
							</div>
						) : (
							eventLogs.map((log, i) => {
								const cardColor =
									log.type === 'edit'
										? 'border-emerald-500/20 bg-emerald-950/5 text-emerald-400'
										: log.type === 'selection'
											? 'border-purple-500/20 bg-purple-950/5 text-purple-400'
											: 'border-slate-850 bg-slate-950/50 text-slate-350';
								return (
									<div key={i} className={`p-2 border rounded-lg flex items-start gap-2.5 transition-all shadow-sm ${cardColor}`}>
										<span className='text-[8px] text-slate-500 font-bold shrink-0 mt-0.5'>{log.time}</span>
										<span className='break-all flex-1 font-semibold leading-normal'>{log.msg}</span>
									</div>
								);
							})
						)}
					</div>
				</div>

				{/* 4. RENDERER PROTOCOL SHOWCASE */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-cyan-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Code2 className='w-4 h-4 text-cyan-400' />
						Renderer Protocols
					</h3>

					<div className='flex flex-col gap-2'>
						{/* DOM Renderer */}
						<div className='p-2.5 rounded-lg border border-emerald-900/40 bg-emerald-950/10'>
							<div className='flex items-center gap-1.5 mb-1'>
								<span className='w-1.5 h-1.5 rounded-full bg-emerald-400' />
								<span className='text-[9px] font-bold text-emerald-400 uppercase tracking-wider'>DOM Renderer</span>
								<span className='ml-auto text-[8px] text-emerald-600 font-mono'>Price col</span>
							</div>
							<p className='text-[9px] text-slate-500 leading-relaxed'>
								<code className='text-emerald-400/80'>DomCellRenderer.mount()</code> → returns handle. Grid calls{' '}
								<code className='text-emerald-400/80'>handle.update()</code> directly. Zero React — canvas sparkline drawn in the
								paint loop.
							</p>
						</div>

						{/* Imperative React */}
						<div className='p-2.5 rounded-lg border border-cyan-900/40 bg-cyan-950/10'>
							<div className='flex items-center gap-1.5 mb-1'>
								<span className='w-1.5 h-1.5 rounded-full bg-cyan-400' />
								<span className='text-[9px] font-bold text-cyan-400 uppercase tracking-wider'>Imperative React</span>
								<span className='ml-auto text-[8px] text-cyan-600 font-mono'>Change col</span>
							</div>
							<p className='text-[9px] text-slate-500 leading-relaxed'>
								<code className='text-cyan-400/80'>forwardRef + useImperativeHandle</code>. Grid calls{' '}
								<code className='text-cyan-400/80'>ref.current.update()</code> — bypasses React scheduler. Flash animation is direct
								DOM mutation.
							</p>
						</div>

						{/* Standard React */}
						<div className='p-2.5 rounded-lg border border-slate-800 bg-slate-950/30'>
							<div className='flex items-center gap-1.5 mb-1'>
								<span className='w-1.5 h-1.5 rounded-full bg-slate-400' />
								<span className='text-[9px] font-bold text-slate-400 uppercase tracking-wider'>Standard React</span>
								<span className='ml-auto text-[8px] text-slate-600 font-mono'>Vol/Analytics col</span>
							</div>
							<p className='text-[9px] text-slate-500 leading-relaxed'>
								<code className='text-slate-400/80'>React.memo</code> +{' '}
								<code className='text-slate-400/80'>useSyncExternalStore</code>. Full reconciler path per update. Compare jitter vs
								the other two columns at 10hz.
							</p>
						</div>

						<div className='text-[8px] text-slate-600 italic text-center pt-1'>
							Hit "Auto 10hz" and watch all three columns update simultaneously
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
