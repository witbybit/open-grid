import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grid, GridEventName, type GridApi, type GridReadyEvent, type StyleRule } from '@open-grid/react';
import { Activity, BarChart3, Code2, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { createDashboardColumns, createDashboardRows, type DashboardStockRow } from './demoGridConfigs';

interface RealtimeDashboardProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	onGridReady?: (event: GridReadyEvent<DashboardStockRow>) => void;
}

export default function RealtimeDashboard({ editTrigger, arrowKeyNavigationEdit, onCellValueChanged, onGridReady }: RealtimeDashboardProps) {
	const columns = useMemo(() => createDashboardColumns(), []);
	const rows = useMemo(() => createDashboardRows(), []);
	const [api, setApi] = useState<GridApi<DashboardStockRow> | null>(null);
	const [stats, setStats] = useState({ sum: 0, avg: 0, min: 0, max: 0, count: 0 });
	const [prices, setPrices] = useState<number[]>([]);
	const [eventLogs, setEventLogs] = useState<Array<{ time: string; msg: string; type: string }>>([]);
	const [autoFire, setAutoFire] = useState(false);
	const autoFireRef = useRef(false);
	const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	autoFireRef.current = autoFire;

	const styleRules = useMemo<StyleRule<DashboardStockRow>[]>(
		() => [
			{
				kind: 'row',
				when: (row) => (parseFloat(row.change) || 0) > 0,
				rowClass: 'transition-all duration-200 border-l-2 border-emerald-500/60 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-100/90',
			},
			{
				kind: 'row',
				when: (row) => (parseFloat(row.change) || 0) < 0,
				rowClass: 'transition-all duration-200 border-l-2 border-rose-500/60 bg-rose-950/5 hover:bg-rose-900/10 text-rose-100/90',
			},
			{
				kind: 'cell',
				field: 'change',
				when: (row) => (parseFloat(row.change) || 0) > 0,
				cellClass: 'text-emerald-400 font-extrabold font-mono',
			},
			{ kind: 'cell', field: 'change', when: (row) => (parseFloat(row.change) || 0) < 0, cellClass: 'text-rose-400 font-extrabold font-mono' },
			{ kind: 'cell', field: 'price', when: () => true, cellClass: 'font-mono font-bold text-slate-200' },
		],
		[]
	);

	const updateStatsAndChart = useCallback(() => {
		if (!api) return;
		const state = api.getState();
		const range = state.selection.range;
		const numericValues: number[] = [];
		if (range) {
			const rowIds = api.rows().inRange(range).getIds();
			const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
			const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);
			if (startColIdx !== -1 && endColIdx !== -1) {
				const cols = state.columns.slice(Math.min(startColIdx, endColIdx), Math.max(startColIdx, endColIdx) + 1).map((c) => c.field);
				for (const rowId of rowIds)
					for (const col of cols) {
						const num = parseFloat(String(api.getCellValue(rowId, col)));
						if (!Number.isNaN(num)) numericValues.push(num);
					}
			}
		}
		if (numericValues.length) {
			const sum = numericValues.reduce((a, b) => a + b, 0);
			setStats({
				sum,
				avg: sum / numericValues.length,
				min: Math.min(...numericValues),
				max: Math.max(...numericValues),
				count: numericValues.length,
			});
		} else setStats({ sum: 0, avg: 0, min: 0, max: 0, count: 0 });
		setPrices(
			api
				.rows()
				.getAll()
				.slice(0, 18)
				.map((row) => parseFloat(String(row.price)) || 0)
		);
	}, [api]);

	useEffect(() => {
		if (!api) return;
		updateStatsAndChart();
		const log = (msg: string, type = 'info') =>
			setEventLogs((prev) => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 10));
		const unsubSelection = api.subscribeToKey('selection', updateStatsAndChart);
		const unsubValue = api.addEventListener(GridEventName.cellValueChanged, () => {
			log('cellValueChanged');
			updateStatsAndChart();
		});
		return () => {
			unsubSelection();
			unsubValue();
		};
	}, [api, updateStatsAndChart]);

	const toggleAutoFire = useCallback(() => {
		if (!api) return;
		const next = !autoFireRef.current;
		setAutoFire(next);
		if (autoIntervalRef.current) {
			clearInterval(autoIntervalRef.current);
			autoIntervalRef.current = null;
		}
		if (!next) return;
		autoIntervalRef.current = setInterval(() => {
			const allRows = api.rows().getAll();
			const row = allRows[Math.floor(Math.random() * allRows.length)];
			if (!row) return;
			const current = parseFloat(String(row.price)) || 100;
			const nextPrice = Math.max(1, current + (Math.random() - 0.5) * 2).toFixed(2);
			api.setCellValue(row.id, 'price', nextPrice);
			api.setCellValue(row.id, 'change', (parseFloat(nextPrice) - current).toFixed(2));
		}, 100);
	}, [api]);

	useEffect(
		() => () => {
			if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
		},
		[]
	);

	const svgPoints = useMemo(() => {
		if (prices.length < 2) return '';
		const max = Math.max(...prices, 1);
		const min = Math.min(...prices, 0);
		const range = max - min || 1;
		return prices.map((value, index) => `${(index / (prices.length - 1)) * 100},${40 - ((value - min) / range) * 30}`).join(' ');
	}, [prices]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0'>
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-emerald-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<TrendingUp className='w-4 h-4 text-emerald-400' />
							Realtime Portfolio Dashboard
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
				</div>
				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						mode='client'
						rows={rows}
						columns={columns}
						styleRules={styleRules}
						pinLeftColumns={2}
						enableNavigation
						navigationOptions={{ editTrigger, arrowKeyNavigationEdit, onCellValueChanged }}
						onGridReady={(event) => {
							setApi(event.api);
							onGridReady?.(event);
						}}
					/>
				</div>
			</div>
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<BarChart3 className='w-4 h-4 text-emerald-400' />
						Selection Analytics
					</h3>
					<div className='grid grid-cols-2 gap-2'>
						{[
							['Count', stats.count],
							['Sum', stats.sum.toFixed(2)],
							['Avg', stats.avg.toFixed(2)],
							['Max', stats.max.toFixed(2)],
						].map(([label, value]) => (
							<div key={label} className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5'>
								<div className='text-[8px] text-slate-500 uppercase font-extrabold'>{label}</div>
								<div className='font-mono text-xs font-bold text-slate-200'>{value}</div>
							</div>
						))}
					</div>
				</div>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Activity className='w-4 h-4 text-cyan-400' />
						Live Price Sparkline
					</h3>
					<svg className='h-20 w-full rounded-lg border border-slate-900 bg-slate-950/80' viewBox='0 0 100 40' preserveAspectRatio='none'>
						<polyline fill='none' stroke='#10b981' strokeWidth='1.5' points={svgPoints} />
					</svg>
				</div>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-2'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<RefreshCw className='w-4 h-4 text-purple-400' />
						Realtime Event Logger
					</h3>
					{eventLogs.length === 0 ? (
						<div className='text-[10px] text-slate-500'>No events yet.</div>
					) : (
						eventLogs.map((log) => (
							<div key={`${log.time}-${log.msg}`} className='font-mono text-[10px] text-slate-400'>
								{log.time} · {log.msg}
							</div>
						))
					)}
					<div className='mt-2 flex items-center gap-1.5 text-[10px] text-slate-500'>
						<Code2 className='w-3.5 h-3.5' />
						Data and controls stay in the demo.
					</div>
				</div>
			</div>
		</div>
	);
}
