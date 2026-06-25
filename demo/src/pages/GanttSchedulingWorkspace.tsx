import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid, type GridApi } from '@open-grid/react';
import { CheckSquare, Clock, Layers, RefreshCw, Sparkles, TrendingUp, Users, Zap } from 'lucide-react';
import { createGanttColumns, createGanttRows, type GanttRow } from './demoGridConfigs';

interface GanttSchedulingWorkspaceProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	onGridReady?: (api: GridApi<GanttRow>) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function GanttSchedulingWorkspace({
	editTrigger: _editTrigger,
	arrowKeyNavigationEdit: _arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: GanttSchedulingWorkspaceProps) {
	const [api, setApi] = useState<GridApi<GanttRow> | null>(null);
	const [revision, setRevision] = useState(0);
	const rows = useMemo(() => createGanttRows(), []);
	const columns = useMemo(() => createGanttColumns(), []);

	useEffect(() => {
		if (!api) return;
		return api.subscribe((event) => {
			if (event.type === 'cells.changed' || event.type === 'selection.changed') {
				setRevision((v) => v + 1);
			}
		});
	}, [api]);

	const stats = useMemo(() => {
		const currentRows = api?.rows.getAll() ?? rows;
		let done = 0;
		let blocked = 0;
		let progressSum = 0;
		let totalDuration = 0;
		for (const row of currentRows) {
			if (row.status === 'Done') done++;
			if (row.status === 'Blocked') blocked++;
			progressSum += Number(row.progress) || 0;
			totalDuration += Number(row.durationDays) || 0;
		}
		return {
			total: currentRows.length,
			done,
			blocked,
			progressAvg: currentRows.length > 0 ? progressSum / currentRows.length : 0,
			totalDuration,
		};
	}, [api, rows, revision]);

	const handleAutoSolveConflicts = useCallback(() => {
		if (!api) return;
		const start = performance.now();
		let currentDay = 1;
		const updates: GanttRow[] = [];
		api.rows.getAll().forEach((row) => {
			updates.push({ ...row, sprintDay: currentDay });
			currentDay += Number(row.durationDays) || 2;
		});
		api.rows.applyTransaction({ update: updates });
		setRevision((v) => v + 1);
		alert(`Sprint Scheduling Overlaps Auto-Resolved! (Shifted coordinate dates sequentially in ${(performance.now() - start).toFixed(2)}ms)`);
	}, [api]);

	const handleBatchExpedite = useCallback(() => {
		if (!api) return;
		const selectedIds = api.selection.getState().selectedRowIds;
		if (selectedIds.size === 0) {
			alert('Please select rows first using click or Shift+Click.');
			return;
		}
		api.rows.update((currentRows) =>
			currentRows.map((row) => (selectedIds.has(row.id) ? { ...row, progress: 100, status: 'Done' } : row))
		);
		setRevision((v) => v + 1);
	}, [api]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-950/80 border border-slate-900 rounded-xl p-3 flex items-center justify-between shrink-0 shadow-lg relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-indigo-500 animate-pulse' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>Gantt Scheduling Arena</span>
					</div>
					<div className='text-slate-400 font-medium text-[10px] bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 font-mono flex items-center gap-1 shrink-0'>
						<span>Select rows then use Batch Complete to mark as Done</span>
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rows={rows}
						columns={columns}
						getRowId={(row) => row.id}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						onCellValueChanged={onCellValueChanged}
						onGridReady={(api) => {
							setApi(api);
							onGridReady?.(api);
						}}
					/>
				</div>
			</div>

			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-4 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5'>
						<Clock className='w-4 h-4 text-indigo-400' />
						Sprint Project Analytics
					</h3>
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
