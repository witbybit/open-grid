import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
	ClientRowModelController,
	ColumnDef,
	GridStore,
	ServerRowModelController,
	GridApi,
	CellEditorProps,
	CellRendererProps,
	GridNavigationController,
} from '@open-grid/core';
import { useGridApi, useGridKeySelector, useGridNavigationController, useGridDimensions, Cell as ReactCell } from '@open-grid/react';

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
	const products = [
		'Laser Keyboard',
		'Wireless Mouse',
		'Mechanical Keycap',
		'Sleek Stand',
		'Ergonomic Desk',
		'Premium Webcam',
		'Neon Controller',
		'Haptic Earphone',
		'VR Headset',
		'Smart Mug',
		'RGB Cable',
		'Cozy Blanket',
	];

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

export function generateSpreadsheetRows(count: number): SpreadsheetRow[] {
	return Array.from({ length: count }, (_, index) => {
		return {
			id: `S-${1000 + index}`,
			A: (10 + (index % 7) * 5).toString(),
			B: (index * 3).toString(),
			C: ((index * 2) % 15).toString(),
			D: '100',
			E: (Math.random() * 50).toFixed(0),
			F: '25',
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

// ============================================================================
// 4. Header Cell and O(1) Wrapper Components
// ============================================================================

interface HeaderCellProps<TRowData = unknown> {
	colField: string;
	header: string;
	width?: number;
	api: GridApi<TRowData>;
}

const HeaderCellComponent = <TRowData,>({ colField, header, width = 100, api }: HeaderCellProps<TRowData>) => {
	const colWidth = useGridKeySelector(`colWidth:${colField}`, (state) => state.columnWidths[colField] ?? width);

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
			className='flex items-center justify-between px-3 h-10 border-r border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider relative group select-none shrink-0 bg-slate-900'
			style={{ width: colWidth }}
		>
			<span className='truncate'>{header}</span>
			<div
				onMouseDown={handleMouseDown}
				className='absolute right-0 top-0 w-1.5 h-full cursor-col-resize hover:bg-purple-500/80 bg-slate-800 transition-colors duration-150 z-20 group-hover:bg-slate-700'
			/>
		</div>
	);
};

export const HeaderCell = React.memo(HeaderCellComponent) as <TRowData>(props: HeaderCellProps<TRowData>) => React.ReactElement | null;

interface CellProps {
	rowId: string;
	colField: string;
	api: GridApi<any>;
	navigation: GridNavigationController<any>;
}

const Cell = React.memo(({ rowId, colField, api, navigation }: CellProps) => {
	const renderCount = GlobalRenderTracker.incrementCellRender(rowId, colField);

	const flashKey = `${rowId}:${colField}-${renderCount}`;
	const flashClass = GlobalRenderTracker.flashEnabled ? 'animate-flash' : '';

	const customRenderValue = useCallback(
		(value: unknown, computedValue: unknown) => {
			const displayVal =
				typeof computedValue === 'string' || typeof computedValue === 'number'
					? String(computedValue)
					: typeof value === 'string' || typeof value === 'number'
						? String(value)
						: '';

			return (
				<div key={flashKey} className={`w-full h-full flex items-center truncate ${flashClass}`}>
					{displayVal}
				</div>
			);
		},
		[flashKey, flashClass]
	);

	return <ReactCell rowId={rowId} colField={colField} api={api} navigation={navigation} renderValue={customRenderValue} />;
});

Cell.displayName = 'Cell';

interface VirtualRowProps {
	rowIndex: number;
	virtualRow: { size: number; start: number };
	api: GridApi<any>;
	navigation: GridNavigationController<any>;
	rowHeights: Record<string, number>;
	defaultHeight: number;
	totalWidth: number;
}

const VirtualRow = React.memo(({ rowIndex, virtualRow, api, navigation, rowHeights, defaultHeight, totalWidth }: VirtualRowProps) => {
	GlobalRenderTracker.incrementRowRender(rowIndex);

	const dataVersion = useGridKeySelector('dataVersion', (state) => state.dataVersion);
	const columns = useGridKeySelector('dataVersion', (state) => state.columns);

	const row = useMemo(() => {
		const rowModel = api.getRowModel();
		return rowModel ? rowModel.getRow(rowIndex) : null;
	}, [api, rowIndex, dataVersion]);

	if (!row) {
		return (
			<div
				data-virtual-row
				className='absolute left-0 top-0 flex border-b border-slate-900 items-center px-4 bg-slate-950/40 text-slate-500 animate-pulse text-xs'
				style={{
					height: `${virtualRow.size}px`,
					transform: `translateY(${virtualRow.start}px)`,
					width: `${totalWidth}px`,
					minWidth: '100%',
				}}
			>
				Loading chunk data...
			</div>
		);
	}

	return (
		<div
			data-virtual-row
			className='absolute left-0 top-0 flex border-b border-slate-900 hover:bg-slate-900/10'
			style={{
				height: `${virtualRow.size}px`,
				transform: `translateY(${virtualRow.start}px)`,
				width: `${totalWidth}px`,
				minWidth: '100%',
			}}
		>
			{columns.map((col) => (
				<Cell key={col.field} rowId={row.id} colField={col.field} api={api} navigation={navigation} />
			))}
		</div>
	);
});

VirtualRow.displayName = 'VirtualRow';

// ============================================================================
// 5. Grid View Panel
// ============================================================================

export interface GridViewProps {
	rowHeights?: Record<string, number>;
	defaultHeight?: number;
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	clientController?: ClientRowModelController<any>;
	serverController?: ServerRowModelController;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

export function GridView({
	rowHeights = {},
	defaultHeight = 38,
	onCellValueChanged = () => {},
	serverController,
	editTrigger = 'doubleClick',
	arrowKeyNavigationEdit = false,
}: GridViewProps) {
	const api = useGridApi<any>();
	
	// Use headless hook - only provides dimensions and refs, no virtualization coupling
	const { containerRef, headerRef, totalWidth, columns } = useGridDimensions();

	const rowCount = useGridKeySelector('dataVersion', (state) => {
		const rowModel = api.getRowModel();
		return rowModel ? rowModel.getRowCount() : 0;
	});

	const navigation = useGridNavigationController<any>({
		onCellValueChanged: (rowId, colField, val) => {
			const start = performance.now();
			onCellValueChanged(rowId, colField, val);
			const duration = performance.now() - start;
			LatencyProfiler.record(duration);
		},
		editTrigger,
		arrowKeyNavigationEdit,
	});

	// Keyboard navigation listeners
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
	}, [navigation, containerRef]);

	// Virtualizer - you choose your own virtualization library
	const rowVirtualizer = useVirtualizer({
		count: rowCount,
		getScrollElement: () => containerRef.current,
		estimateSize: (index) => {
			const rowModel = api.getRowModel();
			const row = rowModel ? rowModel.getRow(index) : null;
			if (!row) return defaultHeight;
			return rowHeights[row.id] ?? defaultHeight;
		},
		overscan: 10,
	});

	const virtualRows = rowVirtualizer.getVirtualItems();
	
	useEffect(() => {
		if (serverController && virtualRows.length > 0) {
			serverController.loadVisibleBlocks(virtualRows.map((row) => row.index));
		}
	}, [virtualRows, serverController]);

	return (
		<div className='flex flex-col h-full border border-slate-800 rounded-lg overflow-hidden bg-slate-950 shadow-2xl relative'>
			{/* Header - automatically synced with body scroll via useGridDimensions */}
			<div ref={headerRef} className='bg-slate-900 border-b border-slate-800 shrink-0 select-none z-10 overflow-hidden'>
				<div className='flex' style={{ width: `${totalWidth}px`, minWidth: '100%' }}>
					{columns.map((col) => (
						<HeaderCell key={col.field} colField={col.field} header={col.header} width={col.width} api={api} />
					))}
				</div>
			</div>

			{/* Body - automatically handles horizontal and vertical scrolling */}
			<div ref={containerRef} className='flex-1 overflow-auto outline-none' tabIndex={0}>
				<div className='relative' style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: `${totalWidth}px`, minWidth: '100%' }}>
					{virtualRows.map((virtualRow) => (
						<VirtualRow
							key={virtualRow.key}
							rowIndex={virtualRow.index}
							virtualRow={virtualRow}
							api={api}
							navigation={navigation}
							rowHeights={rowHeights}
							defaultHeight={defaultHeight}
							totalWidth={totalWidth}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
