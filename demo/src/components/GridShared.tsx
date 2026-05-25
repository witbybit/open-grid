import React, { useEffect } from 'react';
import { useGridStore, OpenGrid, CellRendererProps, CellEditorProps, GridStore } from '@open-grid/react';

// ============================================================================
// 1. Global Render & Latency Telemetry Trackers
// ============================================================================

export const GlobalRenderTracker = {
	cellRenders: 0,
	rowRenders: 0,
	flashEnabled: true,
	cellRenderCounts: {} as Record<string, number>,
	listeners: new Set<() => void>(),
	notifyTimeout: null as any,

	subscribe(cb: () => void) {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	},
	notify() {
		if (this.notifyTimeout) return;
		this.notifyTimeout = setTimeout(() => {
			this.notifyTimeout = null;
			this.listeners.forEach((cb) => cb());
		}, 0);
	},
	incrementCellRender(rowId: string, colField: string) {
		this.cellRenders++;
		const key = `${rowId}:${colField}`;
		this.cellRenderCounts[key] = (this.cellRenderCounts[key] || 0) + 1;
		this.notify();
		return this.cellRenderCounts[key];
	},
	incrementRowRender(rowIndex: number) {
		this.rowRenders++;
		this.notify();
	},
	getCellRenderCount(rowId: string, colField: string) {
		const key = `${rowId}:${colField}`;
		return this.cellRenderCounts[key] || 0;
	},
	reset() {
		this.cellRenders = 0;
		this.rowRenders = 0;
		this.cellRenderCounts = {};
		this.notify();
	},
};

export const LatencyProfiler = {
	latencies: [] as number[],
	lastLatency: 0,
	averageLatency: 0,
	maxLatency: 0,
	listeners: new Set<() => void>(),

	subscribe(cb: () => void) {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	},
	notify() {
		this.listeners.forEach((cb) => cb());
	},
	record(ms: number) {
		this.lastLatency = ms;
		this.latencies.push(ms);
		if (this.latencies.length > 50) this.latencies.shift();
		const sum = this.latencies.reduce((a, b) => a + b, 0);
		this.averageLatency = sum / this.latencies.length;
		this.maxLatency = Math.max(...this.latencies);
		this.notify();
	},
	reset() {
		this.latencies = [];
		this.lastLatency = 0;
		this.averageLatency = 0;
		this.maxLatency = 0;
		this.notify();
	},
};

// ============================================================================
// 2. Type Interfaces & Mock Data Generators
// ============================================================================

export interface PerformanceRow {
	id: string;
	name: string;
	price: string;
	quantity: string;
	status: 'Active' | 'Pending' | 'Inactive';
	subtotal?: string;
}

export interface SpreadsheetRow {
	id: string;
	A: string;
	B: string;
	C: string;
	D: string;
	E: string;
	F: string;
}

export interface CustomShowcaseRow {
	id: string;
	name: string;
	price: string;
	rating: string;
	progress: string;
	status: 'Active' | 'Pending' | 'Inactive';
}

export function generatePerformanceRows(count: number, prefix: 'R' | 'SR'): PerformanceRow[] {
	const statuses: PerformanceRow['status'][] = ['Active', 'Pending', 'Inactive'];
	const tickers = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX', 'AMD', 'INTC', 'PYPL', 'CRM'];

	return Array.from({ length: count }, (_, index) => {
		const ticker = tickers[index % tickers.length];
		const type = index % 2 === 0 ? 'CALL' : 'PUT';
		const strike = prefix === 'R' ? Math.floor(Math.random() * 200) + 50 : ((index * 17) % 150) + 70;
		const vol = prefix === 'R' ? Math.floor(Math.random() * 60) + 15 : ((index * 11) % 50) + 25;
		return {
			id: `${ticker}-${type}-${strike}-${1000 + index}`,
			name: ticker,
			price: strike.toString(),
			quantity: vol.toString(),
			status: statuses[index % statuses.length],
		};
	});
}

export function generateCustomShowcaseRows(count: number): CustomShowcaseRow[] {
	const products = ['Pro Quantum Mouse', 'Chroma Keycap Set', 'Studio RGB Mic', 'Arc Stand Pro', 'ActiveDesk Smart', 'Apex Cam 4K'];
	const statuses: CustomShowcaseRow['status'][] = ['Active', 'Pending', 'Inactive'];

	return Array.from({ length: count }, (_, index) => {
		return {
			id: `C-${2000 + index}`,
			name: products[index % products.length],
			price: (25 + ((index * 19) % 120)).toString(),
			rating: ((index % 5) + 1).toString(),
			progress: ((index % 10) * 10).toString(),
			status: statuses[index % statuses.length],
		};
	});
}

// ============================================================================
// 3. Custom Editors & Renderers Showcase Components
// ============================================================================

export const StarRatingRenderer = ({ value, rowId, colField, api }: CellRendererProps<any>) => {
	const rating = Number(value) || 0;

	const handleStarClick = (starIndex: number, e: React.MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();

		const startTime = performance.now();
		api.setCellValue(rowId, colField, starIndex.toString());
		const duration = performance.now() - startTime;
		LatencyProfiler.record(duration);
	};

	return (
		<div className='flex items-center gap-1 h-full select-none cursor-pointer'>
			{[1, 2, 3, 4, 5].map((star) => (
				<button
					key={star}
					onClick={(e) => handleStarClick(star, e)}
					className='p-0.5 hover:scale-125 transition-transform duration-100 outline-none'
				>
					<svg
						className={`w-4 h-4 ${star <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`}
						xmlns='http://www.w3.org/2000/svg'
						viewBox='0 0 24 24'
						stroke='currentColor'
						strokeWidth='2'
						strokeLinecap='round'
						strokeLinejoin='round'
					>
						<polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' />
					</svg>
				</button>
			))}
		</div>
	);
};

export const ProgressBarRenderer = ({ value }: CellRendererProps<any>) => {
	const progress = Math.min(100, Math.max(0, Number(value) || 0));
	const barColor = progress > 75 ? 'bg-emerald-500' : progress > 40 ? 'bg-indigo-500' : 'bg-rose-500';
	return (
		<div className='flex flex-col justify-center w-full h-full pr-4 select-none'>
			<div className='flex items-center justify-between text-[9px] text-slate-400 mb-0.5 font-bold font-mono leading-none'>
				<span>{progress}%</span>
			</div>
			<div className='w-full bg-slate-850 border border-slate-800 rounded-full h-1.5 overflow-hidden'>
				<div className={`${barColor} h-full rounded-full transition-all duration-300`} style={{ width: `${progress}%` }} />
			</div>
		</div>
	);
};

export const ProgressSliderEditor = ({ value, onChange, onCommit }: CellEditorProps<any>) => {
	return (
		<div
			className='absolute inset-0 w-full h-full px-3 py-1 flex items-center bg-slate-900 border-2 border-purple-500 z-20 font-medium'
			onMouseDown={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
		>
			<input
				type='range'
				min='0'
				max='100'
				autoFocus
				value={Number(value) || 0}
				onChange={(e) => onChange(e.target.value)}
				onMouseUp={() => onCommit()}
				className='w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500'
			/>
		</div>
	);
};

export const StatusBadgeRenderer = ({ value }: CellRendererProps<any>) => {
	const valStr = String(value);
	const colorClass =
		valStr === 'Active'
			? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
			: valStr === 'Pending'
				? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
				: 'bg-slate-500/10 border-slate-700/50 text-slate-400';
	return (
		<span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border leading-none inline-block ${colorClass}`}>
			{valStr}
		</span>
	);
};

export const StatusDropdownEditor = ({ value, onCommit }: CellEditorProps<any>) => {
	return (
		<select
			autoFocus
			value={value as string}
			onChange={(e) => onCommit(e.target.value)}
			onMouseDown={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
			className='absolute inset-0 w-full h-full px-3 text-xs bg-slate-900 text-white border-2 border-purple-500 outline-none z-20 font-semibold cursor-pointer'
		>
			<option value='Active'>Active</option>
			<option value='Pending'>Pending</option>
			<option value='Inactive'>Inactive</option>
		</select>
	);
};

export const PriceBadgeRenderer = ({ value }: CellRendererProps<any>) => {
	const priceVal = parseFloat(String(value)) || 0;
	return (
		<span className='font-mono font-bold text-slate-200 text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-800 leading-none'>
			${priceVal.toFixed(2)}
		</span>
	);
};

export const GreeksRenderer = ({ value }: CellRendererProps<any>) => {
	const valNum = parseFloat(String(value)) || 0;
	const isPositive = valNum >= 0;
	const colorClass = isPositive ? 'text-emerald-400 text-glow-emerald font-extrabold' : 'text-rose-400 text-glow-rose font-extrabold';
	const sign = isPositive ? '+' : '';
	return (
		<span className={`font-mono text-xs leading-none ${colorClass}`}>
			{sign}
			{valNum.toFixed(4)}
		</span>
	);
};

export const RiskBadgeRenderer = ({ value }: CellRendererProps<any>) => {
	const valStr = String(value).toUpperCase();
	let colorClass = 'bg-slate-500/10 border-slate-700/50 text-slate-400';
	if (valStr === 'CRITICAL' || valStr === 'HIGH RISK') {
		colorClass = 'bg-rose-950/45 border-rose-500/35 text-rose-400 text-glow-rose font-black animate-pulse';
	} else if (valStr === 'HIGH' || valStr === 'MEDIUM RISK') {
		colorClass = 'bg-amber-950/40 border-amber-500/30 text-amber-400 text-glow-amber font-extrabold';
	} else if (valStr === 'MEDIUM' || valStr === 'LOW RISK') {
		colorClass = 'bg-indigo-950/30 border-indigo-500/25 text-indigo-400 font-bold';
	} else if (valStr === 'LOW' || valStr === 'NO RISK') {
		colorClass = 'bg-emerald-950/30 border-emerald-500/25 text-emerald-400 font-medium';
	}
	return (
		<span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border leading-none inline-block ${colorClass}`}>{valStr}</span>
	);
};

export const ServiceBadgeRenderer = ({ value }: CellRendererProps<any>) => {
	const valStr = String(value);
	let borderStyle = 'border-l-indigo-500 text-indigo-300 bg-indigo-950/10';
	if (valStr === 'Auth') borderStyle = 'border-l-purple-500 text-purple-300 bg-purple-950/10';
	else if (valStr === 'Billing') borderStyle = 'border-l-emerald-500 text-emerald-300 bg-emerald-950/10';
	else if (valStr === 'Database') borderStyle = 'border-l-amber-500 text-amber-300 bg-amber-950/10';
	else if (valStr === 'Cache') borderStyle = 'border-l-cyan-500 text-cyan-300 bg-cyan-950/10';

	return (
		<span className={`px-2 py-0.5 rounded border border-slate-900 border-l-2 text-[10px] font-bold leading-none inline-block ${borderStyle}`}>
			{valStr}
		</span>
	);
};

export const LatencyRenderer = ({ value }: CellRendererProps<any>) => {
	const lat = parseFloat(String(value)) || 0;
	let colorClass = 'text-emerald-400';
	if (lat > 500) colorClass = 'text-rose-400 text-glow-rose font-bold';
	else if (lat > 150) colorClass = 'text-amber-400 font-semibold';
	return <span className={`font-mono text-xs ${colorClass}`}>{lat} ms</span>;
};

// ============================================================================
// 4. Grid View Panel
// ============================================================================

export interface GridViewProps {
	store?: GridStore<any>;
	pinLeftColumns?: number;
	pinRightColumns?: number;
	pinTopRows?: number;
	pinBottomRows?: number;
	rowHeights?: Record<string, number>;
	defaultHeight?: number;
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
	className?: string;
}

export function GridView({
	store,
	pinLeftColumns = 0,
	pinRightColumns = 0,
	pinTopRows = 0,
	pinBottomRows = 0,
	rowHeights = {},
	defaultHeight = 38,
	onCellValueChanged = () => {},
	editTrigger = 'doubleClick',
	arrowKeyNavigationEdit = false,
	className = '',
}: GridViewProps) {
	// Resolve activeStore using either prop or React context hook, handling errors gracefully
	let activeStore: GridStore<any>;
	try {
		const contextStore = useGridStore<any>();
		activeStore = store || contextStore;
	} catch (e) {
		if (store) {
			activeStore = store;
		} else {
			throw e;
		}
	}

	useEffect(() => {
		activeStore.setState({
			rowHeights: rowHeights ?? {},
			defaultRowHeight: defaultHeight ?? 38,
		});
	}, [activeStore, rowHeights, defaultHeight]);

	return (
		<div className={`w-full h-full border border-slate-800 rounded-lg overflow-hidden bg-slate-950 shadow-2xl relative ${className}`}>
			<OpenGrid
				pinLeftColumns={pinLeftColumns}
				pinRightColumns={pinRightColumns}
				pinTopRows={pinTopRows}
				pinBottomRows={pinBottomRows}
				enableNavigation={true}
				navigationOptions={{
					editTrigger,
					arrowKeyNavigationEdit,
					onCellValueChanged: (rowId, colField, val) => {
						const start = performance.now();
						onCellValueChanged(rowId, colField, val);
						const duration = performance.now() - start;
						LatencyProfiler.record(duration);
					},
				}}
			/>
		</div>
	);
}

export const GanttStatusBadgeRenderer = ({ value }: CellRendererProps<any>) => {
	const valStr = String(value);
	const colorClass =
		valStr === 'Done'
			? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
			: valStr === 'In Progress'
				? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
				: valStr === 'Pending'
					? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
					: 'bg-rose-500/10 border-rose-500/20 text-rose-400'; // Blocked
	return (
		<span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border leading-none inline-block ${colorClass}`}>
			{valStr}
		</span>
	);
};

export const GanttStatusDropdownEditor = ({ value, onCommit }: CellEditorProps<any>) => {
	return (
		<select
			autoFocus
			value={value as string}
			onChange={(e) => onCommit(e.target.value)}
			onMouseDown={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
			className='absolute inset-0 w-full h-full px-3 text-xs bg-slate-900 text-white border-2 border-purple-500 outline-none z-20 font-semibold cursor-pointer'
		>
			<option value='Done'>Done</option>
			<option value='In Progress'>In Progress</option>
			<option value='Pending'>Pending</option>
			<option value='Blocked'>Blocked</option>
		</select>
	);
};

export const GanttTimelineRenderer = ({ row }: CellRendererProps<any>) => {
	const sprintDay = Math.min(30, Math.max(1, Number(row.sprintDay) || 1));
	const durationDays = Math.min(30, Math.max(1, Number(row.durationDays) || 1));
	const progress = Math.min(100, Math.max(0, Number(row.progress) || 0));
	const status = row.status || 'Pending';

	// Map status to visual HSL colors matching our beautiful neon palettes
	const barColor =
		status === 'Done' ? 'bg-emerald-500' : status === 'In Progress' ? 'bg-indigo-500' : status === 'Pending' ? 'bg-amber-500' : 'bg-rose-500'; // Blocked

	// We represent a 30-day mini-grid timeline using CSS grid
	const startPercent = ((sprintDay - 1) / 30) * 100;
	const widthPercent = (durationDays / 30) * 100;

	return (
		<div className='relative w-full h-full flex items-center pr-4 select-none'>
			{/* Grid lines backdrop */}
			<div className='absolute inset-y-2 left-0 right-4 border border-slate-900 rounded bg-slate-950/40 flex justify-between pointer-events-none opacity-30'>
				{Array.from({ length: 5 }).map((_, i) => (
					<div key={i} className='h-full border-r border-slate-800' />
				))}
			</div>

			{/* Timeline Scheduling Bar */}
			<div
				className='absolute h-4 rounded-md border border-slate-800/20 shadow-lg overflow-hidden flex flex-col justify-end'
				style={{
					left: `calc(${startPercent}% * 0.9 + 2px)`,
					width: `calc(${widthPercent}% * 0.9)`,
					minWidth: '15px',
				}}
			>
				{/* The colored background matching status */}
				<div className={`absolute inset-0 ${barColor} opacity-20`} />

				{/* The inner progress indicator bar */}
				<div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${progress}%` }} />

				{/* Inner text showing percentage */}
				<span className='absolute inset-0 flex items-center justify-center text-[7px] font-extrabold text-white font-mono leading-none tracking-tighter drop-shadow-sm select-none'>
					{progress}%
				</span>
			</div>
		</div>
	);
};
