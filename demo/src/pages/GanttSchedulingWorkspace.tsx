import React, { useMemo } from 'react';
import { GridProvider, useClientGrid, useGridKeySelector } from '@open-grid/react';
import { GridView } from '../components/GridShared';
import { Sparkles, Clock, Users, Zap, RefreshCw, Layers, CheckSquare, TrendingUp } from 'lucide-react';

export interface GanttRow {
	id: string;
	name: string;
	owner: string;
	sprintDay: number;
	durationDays: number;
	progress: number;
	status: 'Done' | 'In Progress' | 'Pending' | 'Blocked';
}

type ClientApi = ReturnType<typeof useClientGrid<GanttRow>>;

interface GanttSchedulingWorkspaceProps {
	api: ClientApi;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

function GanttSchedulingWorkspaceInner({
	api,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: GanttSchedulingWorkspaceProps) {
	const selectedRange = useGridKeySelector('selection', (state) => state.selection.range);

	// Custom Developer Style Slots Configs (The Dynamic CSS Theme Overrides!)
	React.useEffect(() => {
		// Hook the dynamic customizer classes directly into our core style slots!
		api.setStyleSlots({
			rowClass: (row) => {
				const rowData = row as GanttRow;
				if (!rowData) return '';

				// Core structural layouts alternate, but Blocked and Done rows get custom aesthetic glow borders!
				let base = 'transition-all duration-200 border-l-2 ';
				if (rowData.status === 'Blocked') {
					return base + 'border-rose-500/80 bg-rose-950/5 hover:bg-rose-900/10 text-rose-200/90';
				}
				if (rowData.status === 'Done') {
					return base + 'border-emerald-500/80 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-200/90';
				}
				if (rowData.status === 'In Progress') {
					return base + 'border-indigo-500/50 bg-indigo-950/5 hover:bg-indigo-900/10';
				}
				return base + 'border-slate-800 bg-slate-900/5 hover:bg-slate-800/10';
			},
			cellClass: (col, row) => {
				// Add dynamic glows on critical status metrics
				const rowData = row as GanttRow;
				if (!rowData) return '';
				if (col.field === 'progress' && rowData.progress >= 90) {
					return 'text-emerald-400 font-extrabold font-mono shadow-sm';
				}
				if (col.field === 'status' && rowData.status === 'Blocked') {
					return 'animate-pulse text-rose-400 font-semibold';
				}
				return '';
			},
			headerCellClass: (col) => {
				if (col.field === 'timeline') {
					return 'bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900 text-indigo-300 font-bold border-b border-indigo-900/30';
				}
				return 'font-semibold text-slate-400';
			},
		});
	}, [api]);

	// Quantitative team analytics calculations
	const stats = useMemo(() => {
		const rowsCount = api.getRowCount();
		let doneCount = 0;
		let blockedCount = 0;
		let progressSum = 0;
		let durationSum = 0;

		for (let i = 0; i < rowsCount; i++) {
			const node = api.getRowNode(i);
			if (node) {
				const r = node.data as GanttRow;
				if (r.status === 'Done') doneCount++;
				if (r.status === 'Blocked') blockedCount++;
				progressSum += Number(r.progress) || 0;
				durationSum += Number(r.durationDays) || 0;
			}
		}

		return {
			total: rowsCount,
			done: doneCount,
			blocked: blockedCount,
			progressAvg: rowsCount > 0 ? progressSum / rowsCount : 0,
			totalDuration: durationSum,
		};
	}, [api, selectedRange]);

	const handleAutoSolveConflicts = () => {
		const start = performance.now();
		const count = api.getRowCount();

		let currentDay = 1;

		for (let i = 0; i < count; i++) {
			const row = api.getRow(i);
			if (!row) continue;

			const duration = Number(row.durationDays) || 2;

			api.setCellValue(row.id, 'sprintDay', currentDay);

			currentDay += duration;
		}

		const durationMs = performance.now() - start;

		alert(`Sprint Scheduling Overlaps Auto-Resolved! (Shifted coordinate dates sequentially in ${durationMs.toFixed(2)}ms)`);
	};

	// Batch expedite progress for selection range
	const handleBatchExpedite = () => {
		if (!selectedRange) {
			alert('Please select a range of cells using drag selection first.');
			return;
		}

		const startIdx = api.getRowIndexById(selectedRange.start.rowId) ?? 0;
		const endIdx = api.getRowIndexById(selectedRange.end.rowId) ?? 0;

		if (startIdx === -1 || endIdx === -1) return;

		const minRow = Math.min(startIdx, endIdx);
		const maxRow = Math.max(startIdx, endIdx);

		for (let i = minRow; i <= maxRow; i++) {
			const node = api.getRowNode(i);
			if (!node) continue;

			api.setCellValue(node.id, 'progress', 100);
			api.setCellValue(node.id, 'status', 'Done');
		}
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Interactive Grid Viewport */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-950/80 border border-slate-900 rounded-xl p-3 flex items-center justify-between shrink-0 shadow-lg relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none' />

					{/* Active Drag-to-Fill telemetry */}
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-indigo-500 animate-pulse' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>Gantt Scheduling Arena</span>
					</div>

					<div className='text-slate-400 font-medium text-[10px] bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 font-mono flex items-center gap-1 shrink-0'>
						<span>Drag glowing anchor handle at selection bottom-right to autocomplete/extrapolate sprint days & sequences!</span>
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<GridView
						api={api}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						onCellValueChanged={onCellValueChanged}
						editTrigger={editTrigger}
						arrowKeyNavigationEdit={arrowKeyNavigationEdit}
					/>
				</div>
			</div>

			{/* Right Column: Quantitative Project Optimizer Side-panel */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* KPI Cards Container */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-4 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />

					<h3 className='text-[10px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5'>
						<Clock className='w-4 h-4 text-indigo-400' />
						Sprint Project Analytics
					</h3>

					{/* Sprint metrics */}
					<div className='grid grid-cols-2 gap-2'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<Layers className='w-3 h-3 text-slate-500' /> Total Tasks
							</span>
							<span className='font-mono text-[14px] font-bold text-slate-100 mt-1'>{stats.total}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<Users className='w-3 h-3 text-indigo-400' /> Team Capacity
							</span>
							<span className='font-mono text-[14px] font-bold text-slate-100 mt-1'>{stats.totalDuration} days</span>
						</div>
					</div>

					<div className='grid grid-cols-2 gap-2'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col border-l-2 border-l-emerald-500'>
							<span className='text-[8px] text-emerald-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<CheckSquare className='w-3 h-3 text-emerald-500' /> Completed
							</span>
							<span className='font-mono text-[14px] font-bold text-emerald-400 mt-1'>{stats.done} Tasks</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col border-l-2 border-l-rose-500'>
							<span className='text-[8px] text-rose-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<Zap className='w-3 h-3 text-rose-500' /> Blocked
							</span>
							<span className='font-mono text-[14px] font-bold text-rose-400 mt-1'>{stats.blocked} Tasks</span>
						</div>
					</div>

					{/* Custom Progress SVG Circular Gauge */}
					<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-4 flex flex-col items-center justify-center text-center mt-1 relative overflow-hidden'>
						<span className='text-[8px] text-slate-400 uppercase tracking-wider font-extrabold mb-3 flex items-center gap-1.5'>
							<TrendingUp className='w-3.5 h-3.5 text-indigo-400' />
							Sprint Completion Rate
						</span>

						<svg className='w-24 h-24 transform -rotate-90' viewBox='0 0 100 100'>
							<circle cx='50' cy='50' r='40' stroke='#1e293b' strokeWidth='8' fill='transparent' />
							<circle
								cx='50'
								cy='50'
								r='40'
								stroke='#6366f1'
								strokeWidth='8'
								fill='transparent'
								strokeDasharray={2 * Math.PI * 40}
								strokeDashoffset={2 * Math.PI * 40 * (1 - stats.progressAvg / 100)}
								strokeLinecap='round'
								className='transition-all duration-500'
								style={{ filter: 'drop-shadow(0 0 4px rgba(99, 102, 241, 0.4))' }}
							/>
						</svg>
						<span className='absolute font-mono text-[15px] font-bold text-slate-100 top-[52%] translate-y-[-50%]'>
							{stats.progressAvg.toFixed(1)}%
						</span>
					</div>
				</div>

				{/* Strategy Actions Dashboard */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<h3 className='text-[10px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5'>
						<Sparkles className='w-4 h-4 text-purple-400' />
						Sprint Scheduling Optimizer
					</h3>

					<p className='text-[9px] text-slate-500 font-medium leading-normal'>
						Run programmatic scheduling algorithms or batch optimize workflows instantly over the active viewport data.
					</p>

					<div className='flex flex-col gap-2 mt-1'>
						<button
							onClick={handleAutoSolveConflicts}
							className='w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95'
						>
							<RefreshCw className='w-3.5 h-3.5 animate-spin' />
							Auto-Solve Overlaps
						</button>

						<button
							onClick={handleBatchExpedite}
							className='w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95'
						>
							<CheckSquare className='w-3.5 h-3.5' />
							Batch Complete Selection
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function GanttSchedulingWorkspace(props: GanttSchedulingWorkspaceProps) {
	return (
		<GridProvider api={props.api}>
			<GanttSchedulingWorkspaceInner {...props} />
		</GridProvider>
	);
}
