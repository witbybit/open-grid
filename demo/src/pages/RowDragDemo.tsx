/**
 * Row Drag Demo — row drag/reorder API is not yet wired in the new GridKernel.
 * This page shows the task data and explains what will be added.
 */
import React, { useState } from 'react';
import { Grid, type GridColumnDef, type GridApi } from '@open-grid/react';
import { GripVertical, List, ArrowUpDown } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

interface TaskRow {
	id: string;
	rank: number;
	title: string;
	priority: 'Critical' | 'High' | 'Medium' | 'Low';
	assignee: string;
	effort: number;
}

const ASSIGNEES = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Frank'];
const PRIORITIES: TaskRow['priority'][] = ['Critical', 'High', 'Medium', 'Low'];

function generateTasks(count: number): TaskRow[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `T-${100 + i}`,
		rank: i + 1,
		title: [
			'Implement auth flow',
			'Fix memory leak in renderer',
			'Write E2E tests',
			'Migrate to TypeScript 5',
			'Optimise bundle size',
			'Add dark mode support',
			'Document public API',
			'Resolve flaky CI',
			'Profile hot path allocations',
			'Triage open issues',
			'Upgrade dependencies',
			'Design new onboarding',
			'Refactor column sizing',
			'Add keyboard shortcuts',
			'Improve error messages',
		][i % 15]!,
		priority: PRIORITIES[i % 4]!,
		assignee: ASSIGNEES[i % ASSIGNEES.length]!,
		effort: ((i * 3) % 8) + 1,
	}));
}

// ─── Priority badge ───────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
	Critical: 'bg-rose-500/10 border-rose-500/25 text-rose-400',
	High: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
	Medium: 'bg-indigo-500/10 border-indigo-500/25 text-indigo-400',
	Low: 'bg-slate-700/20 border-slate-600/30 text-slate-400',
};

const PriorityBadge = ({ value }: { value: unknown }) => {
	const v = String(value ?? '');
	return (
		<span
			className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border leading-none inline-block ${PRIORITY_COLORS[v] ?? 'text-slate-400'}`}
		>
			{v}
		</span>
	);
};

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: GridColumnDef<TaskRow>[] = [
	{ id: 'rank', field: 'rank', header: '#', width: 48 },
	{ id: 'title', field: 'title', header: 'Task', width: 240 },
	{
		id: 'priority',
		field: 'priority',
		header: 'Priority',
		width: 100,
		renderer: { kind: 'react', component: ({ value }: { value: unknown }) => <PriorityBadge value={value} /> } as any,
	},
	{ id: 'assignee', field: 'assignee', header: 'Assignee', width: 100 },
	{ id: 'effort', field: 'effort', header: 'Effort (d)', width: 90 },
];

const ROWS = generateTasks(15);

// ─── Demo component ───────────────────────────────────────────────────────────

export default function RowDragDemo() {
	const [_api, setApi] = useState<GridApi<TaskRow> | null>(null);

	return (
		<div className='flex h-full min-h-0 flex-1 gap-4 overflow-hidden'>
			<div className='flex flex-1 min-w-0 flex-col gap-3 overflow-hidden'>
				<div className='flex shrink-0 items-center gap-3 rounded-xl border border-slate-900 bg-slate-950/60 px-4 py-2.5'>
					<span className='flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>
						<GripVertical className='h-3.5 w-3.5 text-purple-400' />
						Row Drag &amp; Reorder
					</span>
					<span className='ml-auto text-[10px] font-mono text-amber-400/70 bg-amber-950/20 border border-amber-900/30 px-2 py-0.5 rounded'>
						Row drag API — coming in next kernel phase
					</span>
				</div>

				<div className='shrink-0 rounded-lg border border-slate-900 bg-slate-950/40 px-3 py-2 text-[10px] text-slate-400 leading-relaxed'>
					<span className='font-bold text-purple-400'>Row drag-and-drop</span> — the drag-reorder commands (
					<span className='font-mono text-indigo-300'>rows.setOrder</span>,{' '}
					<span className='font-mono text-indigo-300'>rowDragStart/End</span> events) are not yet wired into the new GridKernel pipeline.
					The task grid below is fully functional — sort and edit freely while this feature is added.
				</div>

				<div className='flex-1 min-h-0 overflow-hidden rounded-xl border border-slate-900/60'>
					<Grid<TaskRow> columns={COLUMNS} rows={ROWS} getRowId={(row) => row.id} rowHeight={36} onGridReady={(api) => setApi(api)} />
				</div>
			</div>

			<div className='w-72 shrink-0 flex flex-col gap-2 overflow-hidden rounded-xl border border-slate-900 bg-slate-950/60 p-3'>
				<div className='flex items-center justify-between shrink-0'>
					<div className='flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>
						<List className='h-3.5 w-3.5 text-purple-400' />
						Drag Events
					</div>
				</div>

				<div className='flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 font-mono'>
					<div className='flex flex-col items-center justify-center h-full gap-2 text-center'>
						<ArrowUpDown className='h-6 w-6 text-slate-700' />
						<span className='text-[10px] text-slate-600 font-semibold'>Row drag events not yet available</span>
					</div>
				</div>
			</div>
		</div>
	);
}
