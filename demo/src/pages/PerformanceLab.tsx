import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Play } from 'lucide-react';
import {
	GridProvider,
	useClientGrid,
	type ColumnDef,
	type DomCellRenderer,
	type ImperativeCellHandle,
	type CellRendererProps,
} from '@open-grid/react';
import { GridView } from '../components/GridShared';

type RendererMode = 'text' | 'dom' | 'imperativeReact' | 'deferredReact';

interface LabRow {
	id: string;
	name: string;
	price: string;
	status: string;
	[key: string]: string;
}

const statusDomRenderer: DomCellRenderer<LabRow> = {
	mount(container, params) {
		const badge = document.createElement('span');
		badge.style.cssText =
			'display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:4px;font:800 11px ui-monospace,monospace;text-transform:uppercase;';
		container.appendChild(badge);
		const paint = (value: unknown) => {
			const text = String(value ?? '');
			badge.textContent = text;
			const active = text === 'Active';
			badge.style.color = active ? '#34d399' : text === 'Pending' ? '#fbbf24' : '#94a3b8';
			badge.style.background = active ? 'rgba(16,185,129,.12)' : text === 'Pending' ? 'rgba(245,158,11,.12)' : 'rgba(148,163,184,.10)';
			badge.style.border = active
				? '1px solid rgba(16,185,129,.35)'
				: text === 'Pending'
					? '1px solid rgba(245,158,11,.35)'
					: '1px solid rgba(148,163,184,.25)';
		};
		paint(params.value);
		return {
			update(next) {
				paint(next.value);
			},
			destroy() {
				container.textContent = '';
			},
		};
	},
};

const DeferredStatus = React.memo(function DeferredStatus({ value }: CellRendererProps<LabRow>) {
	return <span className='font-mono text-xs font-extrabold text-cyan-300'>{String(value)}</span>;
});

const ImperativeStatus = React.forwardRef<ImperativeCellHandle<LabRow>, CellRendererProps<LabRow>>(function ImperativeStatus({ value }, ref) {
	const spanRef = useRef<HTMLSpanElement>(null);
	React.useImperativeHandle(ref, () => ({
		update(params) {
			if (spanRef.current) spanRef.current.textContent = String(params.value ?? '');
		},
	}));
	return (
		<span ref={spanRef} className='font-mono text-xs font-extrabold text-emerald-300'>
			{String(value)}
		</span>
	);
});

function makeRows(count: number): LabRow[] {
	const statuses = ['Active', 'Pending', 'Inactive'];
	return Array.from({ length: count }, (_, rowIndex) => {
		const row: LabRow = {
			id: `LAB-${rowIndex}`,
			name: `Instrument ${rowIndex}`,
			price: (100 + (rowIndex % 900)).toString(),
			status: statuses[rowIndex % statuses.length],
		};
		for (let col = 0; col < 32; col++) {
			row[`m_${col}`] = `${(rowIndex * 17 + col * 31) % 10000}`;
		}
		return row;
	});
}

function makeColumns(mode: RendererMode): ColumnDef<LabRow>[] {
	const statusColumn: ColumnDef<LabRow> =
		mode === 'dom'
			? { field: 'status', header: 'Status DOM', width: 120, renderer: { kind: 'dom', renderer: statusDomRenderer } }
			: mode === 'imperativeReact'
				? { field: 'status', header: 'Status Imperative', width: 150, renderer: { kind: 'imperativeReact', component: ImperativeStatus } }
				: mode === 'deferredReact'
					? { field: 'status', header: 'Status Deferred', width: 140, renderer: { kind: 'react', component: DeferredStatus } }
					: { field: 'status', header: 'Status Text', width: 120, renderer: { kind: 'text' } };

	return [
		{ field: 'id', header: 'ID', width: 130 },
		{ field: 'name', header: 'Name', width: 160 },
		{ field: 'price', header: 'Price', width: 100 },
		statusColumn,
		...Array.from({ length: 996 }, (_, index) => ({
			field: `m_${index}`,
			header: `Metric ${index}`,
			width: 96 + (index % 5) * 12,
			renderer: { kind: 'text' as const },
		})),
	];
}

export default function PerformanceLab() {
	const [mode, setMode] = useState<RendererMode>('dom');
	const rows = useMemo(() => makeRows(100000), []);
	const columns = useMemo(() => makeColumns(mode), [mode]);
	const api = useClientGrid<LabRow>({
		rows,
		columns,
		rowBuffer: 2,
		colBuffer: 1,
		runtimeLimits: { maxRenderedRows: 36, maxRenderedCells: 900 },
		getRowId: (row) => row.id,
	});
	const hostRef = useRef<HTMLDivElement>(null);
	const [stats, setStats] = useState(api.getRenderStats());

	useEffect(() => {
		const id = window.setInterval(() => setStats(api.getRenderStats()), 250);
		return () => window.clearInterval(id);
	}, [api]);

	const runGlide = useCallback(() => {
		const scroller = hostRef.current?.querySelector<HTMLDivElement>('.og-scroll-viewport');
		if (!scroller) return;
		api.resetRenderStats();
		let frame = 0;
		const maxFrames = 90;
		const tick = () => {
			frame++;
			scroller.scrollTop = (frame * 280) % 3200000;
			scroller.scrollLeft = (frame * 190) % 80000;
			scroller.dispatchEvent(new Event('scroll'));
			if (frame < maxFrames) requestAnimationFrame(tick);
			else setStats(api.getRenderStats());
		};
		requestAnimationFrame(tick);
	}, [api]);

	return (
		<div className='flex h-full w-full flex-col gap-4 overflow-hidden'>
			<div className='grid grid-cols-2 xl:grid-cols-4 gap-3 shrink-0'>
				{[
					['Frames', stats.scrollFrames],
					['Cells Written', stats.cellsWrittenDuringScroll],
					['Rows Visited', stats.rowsVisitedDuringScroll],
					['Portal Mounts', stats.portalMountsDuringScroll],
					['State Reads', stats.stateReadsDuringScroll],
					['Plan Version', stats.compiledPlanVersion ?? 0],
					['Same Window', stats.sameWindowBailouts],
					['DOM Releases', stats.hotDomReleases],
				].map(([label, value]) => (
					<div key={label} className='rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2'>
						<div className='text-[9px] uppercase tracking-widest text-slate-500 font-extrabold'>{label}</div>
						<div className='font-mono text-lg font-black text-emerald-300'>{String(value)}</div>
					</div>
				))}
			</div>

			<div className='flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/30 p-3 shrink-0'>
				<div className='flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-300'>
					<Gauge className='h-4 w-4 text-emerald-400' />
					Performance Lab
				</div>
				<div className='flex items-center gap-2'>
					{(['text', 'dom', 'imperativeReact', 'deferredReact'] as RendererMode[]).map((nextMode) => (
						<button
							key={nextMode}
							onClick={() => setMode(nextMode)}
							className={`rounded-md border px-2.5 py-1 text-[10px] font-extrabold uppercase ${
								mode === nextMode ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200' : 'border-slate-800 text-slate-400'
							}`}
						>
							{nextMode}
						</button>
					))}
					<button
						onClick={runGlide}
						className='inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1 text-xs font-black text-slate-950'
					>
						<Play className='h-3.5 w-3.5' />
						Glide
					</button>
				</div>
			</div>

			<div ref={hostRef} className='min-h-0 flex-1'>
				<GridProvider api={api}>
					<GridView api={api} pinLeftColumns={2} pinRightColumns={1} defaultHeight={34} enableContextMenu={false} />
				</GridProvider>
			</div>
		</div>
	);
}
