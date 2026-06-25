/**
 * Advanced Filters Demo
 *
 * Demonstrates all available filter types in the new kernel:
 *   text, number, date, set (filterValues), none
 *
 * Includes: floating filters, filter chip bar, sort, sidebar column panel.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid } from '@open-grid/react';
import type { ColumnDef, GridApi, ColumnFilter } from '@open-grid/react';
import { Filter, X, SlidersHorizontal, Users, BarChart3 } from 'lucide-react';

// ── Row type ──────────────────────────────────────────────────────────────────

interface EmployeeRow {
	id: string;
	name: string;
	department: string;
	location: string;
	status: 'Active' | 'On Leave' | 'Contractor' | 'Alumni';
	level: 'IC1' | 'IC2' | 'IC3' | 'IC4' | 'IC5' | 'M1' | 'M2' | 'M3';
	salary: number;
	startDate: string;
	skills: string;
}

// ── Data ──────────────────────────────────────────────────────────────────────

const DEPARTMENTS = ['Engineering', 'Product', 'Design', 'Marketing', 'Sales', 'Finance', 'Operations', 'HR', 'Legal', 'Support'];
const LOCATIONS = ['San Francisco', 'New York', 'London', 'Berlin', 'Singapore', 'Toronto', 'Austin', 'Remote'];
const STATUSES: EmployeeRow['status'][] = ['Active', 'On Leave', 'Contractor', 'Alumni'];
const LEVELS: EmployeeRow['level'][] = ['IC1', 'IC2', 'IC3', 'IC4', 'IC5', 'M1', 'M2', 'M3'];
const NAMES = [
	'Alice Chen',
	'Bob Martinez',
	'Carol Smith',
	'David Kim',
	'Emma Wilson',
	'Frank Lee',
	'Grace Park',
	'Henry Brown',
	'Iris Davis',
	'Jake Thompson',
	'Kate Anderson',
	'Liam Johnson',
	'Maya Patel',
	'Noah Williams',
	'Olivia Garcia',
	'Peter Zhang',
	'Quinn Rodriguez',
	'Rachel Torres',
	'Sam White',
	'Tara Nguyen',
];
const ALL_SKILLS = [
	'React',
	'TypeScript',
	'Python',
	'Go',
	'Rust',
	'SQL',
	'Figma',
	'Kubernetes',
	'AWS',
	'Machine Learning',
	'Data Analysis',
	'Product Strategy',
	'UX Research',
	'Copywriting',
	'SEO',
	'Finance',
	'Compliance',
	'Recruiting',
];

function generateEmployees(count: number): EmployeeRow[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `EMP-${String(i + 1).padStart(4, '0')}`,
		name: `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
		department: DEPARTMENTS[i % DEPARTMENTS.length],
		location: LOCATIONS[i % LOCATIONS.length],
		status: STATUSES[i % STATUSES.length],
		level: LEVELS[i % LEVELS.length],
		salary: 60000 + (i % 8) * 20000 + Math.floor(i / 3) * 500,
		startDate: new Date(2015 + (i % 10), (i * 3) % 12, (i % 28) + 1).toISOString().slice(0, 10),
		skills: ALL_SKILLS.slice((i * 3) % ALL_SKILLS.length, ((i * 3) % ALL_SKILLS.length) + 3).join(', '),
	}));
}

const ALL_ROWS = generateEmployees(200);

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
	Active: '#22c55e',
	'On Leave': '#f59e0b',
	Contractor: '#60a5fa',
	Alumni: '#94a3b8',
};

function StatusRenderer({ value }: { value: unknown }) {
	const v = String(value ?? '');
	const color = STATUS_COLORS[v] ?? '#94a3b8';
	return (
		<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
			<span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
			{v}
		</span>
	);
}

// ── Columns ───────────────────────────────────────────────────────────────────

function makeColumns(): ColumnDef<EmployeeRow>[] {
	return [
		{ field: 'id', header: 'ID', width: 100, filterType: 'none' },
		{ field: 'name', header: 'Name', width: 180, filterType: 'text' },
		{ field: 'department', header: 'Department', width: 160, filterType: 'set', filterValues: DEPARTMENTS },
		{ field: 'location', header: 'Location', width: 150, filterType: 'set', filterValues: LOCATIONS },
		{
			field: 'status',
			header: 'Status',
			width: 130,
			filterType: 'set',
			filterValues: STATUSES as string[],
			renderer: { kind: 'react', component: StatusRenderer },
		},
		{ field: 'level', header: 'Level', width: 100, filterType: 'set', filterValues: LEVELS as string[] },
		{
			field: 'salary',
			header: 'Salary',
			width: 130,
			filterType: 'number',
			valueFormatter: ({ value }) => `$${Number(value).toLocaleString()}`,
		},
		{ field: 'startDate', header: 'Start Date', width: 130, filterType: 'date' },
		{ field: 'skills', header: 'Skills', width: 220, filterType: 'text' },
	];
}

// ── Quick-filter presets ──────────────────────────────────────────────────────

interface FilterPreset {
	label: string;
	color: string;
	filters: ColumnFilter[];
}

const PRESETS: FilterPreset[] = [
	{
		label: 'Engineering · Active',
		color: '#818cf8',
		filters: [
			{ columnId: 'department', field: 'department', operator: 'equals', value: 'Engineering' },
			{ columnId: 'status', field: 'status', operator: 'equals', value: 'Active' },
		],
	},
	{
		label: 'Remote Team',
		color: '#34d399',
		filters: [{ columnId: 'location', field: 'location', operator: 'equals', value: 'Remote' }],
	},
	{
		label: 'Senior ICs (salary > $100k)',
		color: '#f59e0b',
		filters: [{ columnId: 'salary', field: 'salary', operator: 'gt', value: 100000 }],
	},
	{
		label: 'Contractors',
		color: '#60a5fa',
		filters: [{ columnId: 'status', field: 'status', operator: 'equals', value: 'Contractor' }],
	},
];

// ── Stats bar ─────────────────────────────────────────────────────────────────

interface StatsBarProps {
	filterModel: ColumnFilter[];
	totalRows: number;
}

function StatsBar({ filterModel, totalRows }: StatsBarProps) {
	const filtered = useMemo(() => {
		if (filterModel.length === 0) return totalRows;
		// Rough client-side estimate for display only
		return Math.max(1, Math.floor(totalRows * Math.pow(0.45, filterModel.length)));
	}, [filterModel, totalRows]);

	return (
		<div className='flex items-center gap-4 rounded-lg border border-slate-800/60 bg-slate-900/20 px-4 py-2 shrink-0'>
			<div className='flex items-center gap-2 text-[11px] text-slate-400'>
				<Users className='h-3.5 w-3.5 text-slate-500' />
				<span>
					<span className='font-bold text-slate-200'>{totalRows}</span> total employees
				</span>
			</div>
			{filterModel.length > 0 && (
				<>
					<span className='text-slate-700'>·</span>
					<div className='flex items-center gap-2 text-[11px] text-slate-400'>
						<Filter className='h-3 w-3 text-violet-400' />
						<span>
							<span className='font-bold text-violet-300'>{filterModel.length}</span> active filter{filterModel.length !== 1 ? 's' : ''}
						</span>
					</div>
				</>
			)}
			<div className='flex items-center gap-2 text-[11px] text-slate-400 ml-auto'>
				<BarChart3 className='h-3 w-3 text-slate-500' />
				<span className='text-[10px] text-slate-600'>Filters: text, number, date, set</span>
			</div>
		</div>
	);
}

// ── Demo ──────────────────────────────────────────────────────────────────────

interface AdvancedFiltersDemoProps {
	onGridReady?: (api: GridApi<EmployeeRow>) => void;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function AdvancedFiltersDemo({ onGridReady: onGridReadyProp, pinLeftColumns, pinRightColumns }: AdvancedFiltersDemoProps) {
	const [api, setApi] = useState<GridApi<EmployeeRow> | null>(null);
	const [filterModel, setFilterModel] = useState<ColumnFilter[]>([]);
	const [showFloating, setShowFloating] = useState(false);
	const columns = useMemo(() => makeColumns(), []);

	const handleGridReady = useCallback(
		(api: GridApi<EmployeeRow>) => {
			setApi(api);
			setFilterModel(api.pipeline.getFilterModel() as ColumnFilter[]);
			onGridReadyProp?.(api);
		},
		[onGridReadyProp]
	);

	useEffect(() => {
		if (!api) return;
		return api.subscribe((event) => {
			if (event.type === 'pipeline.changed') {
				setFilterModel(api.pipeline.getFilterModel() as ColumnFilter[]);
			}
		});
	}, [api]);

	const applyPreset = useCallback(
		(preset: FilterPreset) => {
			api?.pipeline.setFilterModel(preset.filters);
		},
		[api]
	);

	const clearFilters = useCallback(() => {
		api?.pipeline.setFilterModel([]);
	}, [api]);

	const removeFilter = useCallback(
		(field: string) => {
			api?.pipeline.setFilterModel(filterModel.filter((f) => f.field !== field));
		},
		[api, filterModel]
	);

	const activeCount = filterModel.length;

	return (
		<div className='flex h-full min-h-0 flex-col gap-3'>
			{/* Header */}
			<div className='flex shrink-0 items-start gap-4 rounded-xl border border-slate-900 bg-slate-900/30 p-4'>
				<span className='mt-0.5 shrink-0 rounded-lg border border-violet-500/20 bg-violet-500/10 p-2 text-violet-400'>
					<SlidersHorizontal className='h-4 w-4' />
				</span>
				<div className='flex-1 min-w-0'>
					<h3 className='text-sm font-extrabold uppercase tracking-wider text-slate-200'>Advanced Filters</h3>
					<p className='mt-0.5 text-[10px] leading-relaxed text-slate-400'>
						Filter types: <span className='font-semibold text-slate-300'>text</span> (name, skills),{' '}
						<span className='font-semibold text-slate-300'>number</span> (salary),{' '}
						<span className='font-semibold text-slate-300'>date</span> (startDate),{' '}
						<span className='font-semibold text-slate-300'>set</span> (department, location, status, level). Use the header dropdowns or
						floating filters below.
					</p>
				</div>
				<div className='flex shrink-0 items-center gap-2'>
					{activeCount > 0 && (
						<button
							onClick={clearFilters}
							className='flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-400 transition-colors hover:bg-rose-500/20'
						>
							<X className='h-3 w-3' />
							Clear {activeCount} filter{activeCount !== 1 ? 's' : ''}
						</button>
					)}
					<button
						onClick={() => setShowFloating((v) => !v)}
						className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all ${
							showFloating
								? 'border-violet-500/30 bg-violet-500/15 text-violet-300 hover:bg-violet-500/25'
								: 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'
						}`}
					>
						Floating {showFloating ? 'ON' : 'OFF'}
					</button>
				</div>
			</div>

			{/* Quick-apply presets */}
			<div className='flex shrink-0 flex-wrap items-center gap-2 px-1'>
				<span className='text-[9px] font-extrabold uppercase tracking-widest text-slate-600'>Quick apply:</span>
				{PRESETS.map((preset) => {
					const isActive =
						preset.filters.length === filterModel.length &&
						preset.filters.every((pf) =>
							filterModel.some((af) => af.field === pf.field && af.operator === pf.operator && String(af.value) === String(pf.value))
						);
					return (
						<button
							key={preset.label}
							onClick={() => applyPreset(preset)}
							style={{ borderColor: isActive ? `${preset.color}70` : `${preset.color}30`, color: isActive ? preset.color : '#64748b' }}
							className={`rounded-lg border px-3 py-1 text-[10px] font-semibold transition-all hover:opacity-90 ${isActive ? 'bg-slate-800/50' : 'bg-transparent hover:bg-slate-900/40'}`}
						>
							{preset.label}
						</button>
					);
				})}
			</div>

			{/* Stats */}
			<StatsBar filterModel={filterModel} totalRows={ALL_ROWS.length} />

			{/* Active filter chips */}
			{activeCount > 0 && (
				<div className='flex shrink-0 flex-wrap gap-2 px-1'>
					{filterModel.map((filter) => {
						const opMap: Record<string, string> = {
							contains: 'contains',
							equals: '=',
							gte: '≥',
							lte: '≤',
							gt: '>',
							lt: '<',
							notEquals: '≠',
							in: 'in',
						};
						const desc = `${opMap[filter.operator] ?? filter.operator} ${filter.value ?? ''}`;
						return (
							<div
								key={`${filter.field}-${filter.operator}`}
								className='flex items-center gap-2 rounded-lg border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300'
							>
								<span className='opacity-60'>{filter.field}:</span>
								<span>{desc}</span>
								<button
									onClick={() => removeFilter(filter.field)}
									className='ml-1 text-violet-400 transition-colors hover:text-white'
								>
									<X className='h-2.5 w-2.5' />
								</button>
							</div>
						);
					})}
				</div>
			)}

			{/* Grid */}
			<div className='min-h-0 flex-1'>
				<Grid<EmployeeRow>
					columns={columns}
					rows={ALL_ROWS}
					getRowId={(row) => row.id}
					pinLeftColumns={pinLeftColumns}
					pinRightColumns={pinRightColumns}
					showFloatingFilters={showFloating}
					showFilterChipBar
					onGridReady={handleGridReady}
					sidebar={{ panels: ['columns', 'themes'], position: 'right' }}
				/>
			</div>
		</div>
	);
}
