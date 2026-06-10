import React, { useState, useEffect, useMemo } from 'react';
import { GridProvider, useClientGrid, useGridKeySelector } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';
import { Layout, Maximize2, Cpu, Compass, CheckCircle2 } from 'lucide-react';

type DynamiclayoutApi = ReturnType<typeof useClientGrid<PerformanceRow>>;
interface DynamicLayoutProps {
	api: DynamiclayoutApi;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	compactLayout: 'compact' | 'normal' | 'spacious';
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

function DynamicLayoutInner({
	api,
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	onCellValueChanged,
	compactLayout,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: DynamicLayoutProps) {
	const focusedCell = useGridKeySelector('selection', (state) => state.selection.focus);
	const columns = useGridKeySelector('columns', (state) => state.columns);

	const [scrollPosition, setScrollPosition] = useState({ scrollTop: 0, scrollLeft: 0 });

	useEffect(() => {
		const handleScroll = (event: any) => {
			const { scrollTop, scrollLeft } = event.detail || {};
			setScrollPosition({
				scrollTop: scrollTop ?? 0,
				scrollLeft: scrollLeft ?? 0,
			});
		};
		const unsub = api.addEventListener('gridScrolled', handleScroll);
		return () => unsub();
	}, [api]);

	// Sizing parameters
	const layoutStats = useMemo(() => {
		const colsCount = columns.length;
		const rowHeight = rowHeightsMap[compactLayout];
		const totalRows = api.rows().getAll().length;
		// Simulate memory load: ~1.2KB per visible grid node
		const estimatedMemoryKb = (totalRows * colsCount * 1.2).toFixed(1);

		return {
			colsCount,
			rowHeight,
			totalRows,
			estimatedMemoryKb,
		};
	}, [columns, compactLayout, rowHeightsMap, api]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Grid Viewport */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-purple-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-purple-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<Layout className='w-3.5 h-3.5 text-purple-400' />
							Workspace Responsive Grid (Virtual Scroll Viewport)
						</span>
					</div>
					<div className='text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono bg-slate-950/60 border border-slate-900 px-2 py-0.5 rounded'>
						Auto Layout Resizing
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<GridView
						api={api}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						rowHeights={{}}
						defaultHeight={rowHeightsMap[compactLayout]}
						onCellValueChanged={onCellValueChanged}
						editTrigger={editTrigger}
						arrowKeyNavigationEdit={arrowKeyNavigationEdit}
					/>
				</div>
			</div>

			{/* Right Column: Layout Blueprint Sidebar */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* 1. LAYOUT METRICS */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Maximize2 className='w-4 h-4 text-purple-400' />
						Layout Sizing Telemetry
					</h3>

					<div className='grid grid-cols-2 gap-2 mt-1'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Density Preset</span>
							<span className='font-mono text-xs font-bold text-purple-400 text-glow-purple uppercase'>{compactLayout}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Row Height</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{layoutStats.rowHeight}px</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Visible Cols</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{layoutStats.colsCount} Fields</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Total Rows</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{layoutStats.totalRows} Items</span>
						</div>
					</div>

					<div className='border-t border-slate-900/60 pt-3 mt-1 flex flex-col gap-2'>
						<div className='flex items-center justify-between text-[9px] font-bold text-slate-500 uppercase tracking-wider'>
							<span>Render Grid Load</span>
							<span className='text-emerald-400 font-extrabold'>{layoutStats.estimatedMemoryKb} KB</span>
						</div>
						<div className='w-full bg-slate-950 border border-slate-900 rounded-full h-1.5 overflow-hidden'>
							<div className='h-full bg-emerald-500 rounded-full' style={{ width: '12%' }} />
						</div>
					</div>
				</div>

				{/* 2. BLUEPRINT CELL DENSITY & VIEWPORT DESK */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Compass className='w-4 h-4 text-purple-400' />
						Viewport Blueprint
					</h3>

					<div className='flex flex-col gap-2 mt-1'>
						{/* Scroll Y telemetry */}
						<div className='flex justify-between items-center bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg font-mono text-[10px]'>
							<div className='flex flex-col'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Scroll Top (Y)</span>
								<span className='text-slate-200 font-bold'>{Math.round(scrollPosition.scrollTop)}px</span>
							</div>
							<div className='text-slate-500 font-bold'>Vertical</div>
						</div>

						{/* Scroll X telemetry */}
						<div className='flex justify-between items-center bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg font-mono text-[10px]'>
							<div className='flex flex-col'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Scroll Left (X)</span>
								<span className='text-slate-200 font-bold'>{Math.round(scrollPosition.scrollLeft)}px</span>
							</div>
							<div className='text-slate-500 font-bold'>Horizontal</div>
						</div>

						{/* Focus cell coordinates */}
						<div className='flex justify-between items-center bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg font-mono text-[10px]'>
							<div className='flex flex-col col-span-2'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Focus Address</span>
								<span className='text-purple-400 font-extrabold text-glow-purple'>
									{focusedCell ? `${focusedCell.rowId} : ${focusedCell.colField}` : 'No Focus Coordinate'}
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* 3. PERFORMANCE VIRTUALIZATION STATUS */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Cpu className='w-4 h-4 text-emerald-400 animate-pulse' />
						Grid Virtualization Engine
					</h3>

					<div className='flex flex-col gap-2 mt-1'>
						<div className='flex items-start gap-2 text-[10px] font-medium text-slate-400 leading-relaxed'>
							<CheckCircle2 className='w-4 h-4 text-emerald-400 shrink-0 mt-0.5' />
							<span>
								<strong>DOM Virtualization</strong> active. Reusing nodes on scroll to render thousands of rows smoothly.
							</span>
						</div>
						<div className='flex items-start gap-2 text-[10px] font-medium text-slate-400 leading-relaxed'>
							<CheckCircle2 className='w-4 h-4 text-emerald-400 shrink-0 mt-0.5' />
							<span>
								<strong>Passive event listeners</strong> used to ensure buttery 60fps kinetic scrolling.
							</span>
						</div>
					</div>

					<p className='text-[9px] text-slate-500 leading-normal mt-1'>
						The density preset is hot-swapped dynamically without rebuilding the row DOM cache, keeping memory footprint low.
					</p>
				</div>
			</div>
		</div>
	);
}

export default function DynamicLayout({ api, ...props }: DynamicLayoutProps) {
	return (
		<GridProvider api={api}>
			<DynamicLayoutInner api={api} {...props} />
		</GridProvider>
	);
}
