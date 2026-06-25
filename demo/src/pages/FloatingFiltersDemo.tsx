import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Grid, type GridApi, type ColumnDef, type ColumnFilter, type CellRendererProps } from '@open-grid/react';
import { Filter, X, ToggleLeft, ToggleRight, Code2 } from 'lucide-react';

// ── Row type ──────────────────────────────────────────────────────────────────

interface DealRow {
	id: string;
	dealName: string;
	stage: 'Lead' | 'Qualified' | 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost';
	region: 'North America' | 'Europe' | 'APAC' | 'LATAM';
	value: number;
	probability: number;
	closeDate: string;
	owner: string;
}

// ── Data generation ───────────────────────────────────────────────────────────

const STAGES: DealRow['stage'][] = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
const REGIONS: DealRow['region'][] = ['North America', 'Europe', 'APAC', 'LATAM'];
const OWNERS = ['Alice Chen', 'Bob Martinez', 'Carol Smith', 'David Kim', 'Emma Wilson', 'Frank Lee', 'Grace Park'];
const DEAL_NAMES = [
	'Project Nexus',
	'Atlas Platform',
	'Horizon Suite',
	'Vertex CRM',
	'Apex Analytics',
	'Synergy Hub',
	'Catalyst Cloud',
	'Prism Data',
	'Echo Framework',
	'Nova Stack',
];

function generateDeals(count: number): DealRow[] {
	return Array.from({ length: count }, (_, i) => {
		const stage = STAGES[i % STAGES.length];
		const closedDate = new Date(2024, Math.floor(i / 8) % 12, (i % 28) + 1);
		return {
			id: `DEAL-${String(i + 1).padStart(4, '0')}`,
			dealName: `${DEAL_NAMES[i % DEAL_NAMES.length]} ${Math.floor(i / DEAL_NAMES.length) + 1}`,
			stage,
			region: REGIONS[i % REGIONS.length],
			value: Math.round((10 + ((i * 37) % 490)) * 1000),
			probability: stage === 'Closed Won' ? 100 : stage === 'Closed Lost' ? 0 : 10 + ((i * 13) % 80),
			closeDate: closedDate.toISOString().slice(0, 10),
			owner: OWNERS[i % OWNERS.length],
		};
	});
}

// ── Stage badge colors ────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
	Lead: '#64748b',
	Qualified: '#3b82f6',
	Proposal: '#8b5cf6',
	Negotiation: '#f59e0b',
	'Closed Won': '#10b981',
	'Closed Lost': '#ef4444',
};

function StageBadgeRenderer({ value }: CellRendererProps<DealRow>) {
	const stage = String(value ?? '');
	const color = STAGE_COLORS[stage] ?? '#64748b';
	return (
		<span
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				padding: '2px 8px',
				borderRadius: 10,
				fontSize: 10,
				fontWeight: 700,
				background: `${color}22`,
				border: `1px solid ${color}55`,
				color,
				whiteSpace: 'nowrap',
			}}
		>
			{stage}
		</span>
	);
}

// ── Column definitions ────────────────────────────────────────────────────────

function buildColumns(): ColumnDef<DealRow>[] {
	return [
		{ field: 'id', header: 'Deal ID', width: 110, filterType: 'text' },
		{ field: 'dealName', header: 'Deal Name', width: 180, filterType: 'text' },
		{
			field: 'stage',
			header: 'Stage',
			width: 140,
			filterType: 'set',
			filterValues: STAGES as string[],
			renderer: { kind: 'react', component: StageBadgeRenderer },
		},
		{ field: 'region', header: 'Region', width: 140, filterType: 'set', filterValues: REGIONS as string[] },
		{
			field: 'value',
			header: 'Deal Value ($)',
			width: 140,
			filterType: 'number',
			valueFormatter: ({ value }) => `$${Number(value).toLocaleString()}`,
		},
		{ field: 'probability', header: 'Probability (%)', width: 155, filterType: 'number' },
		{ field: 'closeDate', header: 'Close Date', width: 130, filterType: 'date' },
		{ field: 'owner', header: 'Owner', width: 140, filterType: 'text' },
	];
}

// ── Main demo component ───────────────────────────────────────────────────────

interface FloatingFiltersDemoProps {
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	onGridReady?: (api: GridApi<any>) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function FloatingFiltersDemo({ onGridReady, pinLeftColumns }: FloatingFiltersDemoProps) {
	const [api, setApi] = useState<GridApi<DealRow> | null>(null);
	const [showFloating, setShowFloating] = useState(true);
	const [filterModel, setFilterModel] = useState<ColumnFilter[]>([]);

	const rows = useMemo(() => generateDeals(500), []);
	const columns = useMemo(() => buildColumns(), []);

	const handleGridReady = useCallback(
		(api: GridApi<DealRow>) => {
			setApi(api);
			setFilterModel(api.pipeline.getFilterModel() as ColumnFilter[]);
			onGridReady?.(api);
		},
		[onGridReady]
	);

	useEffect(() => {
		if (!api) return;
		return api.subscribe((event) => {
			if (event.type === 'pipeline.changed') {
				setFilterModel(api.pipeline.getFilterModel() as ColumnFilter[]);
			}
		});
	}, [api]);

	const clearAllFilters = useCallback(() => {
		api?.pipeline.setFilterModel([]);
	}, [api]);

	const removeFilter = useCallback(
		(field: string) => {
			const next = filterModel.filter((f) => f.field !== field);
			api?.pipeline.setFilterModel(next);
		},
		[api, filterModel]
	);

	const activeFilterCount = filterModel.length;

	return (
		<div className='flex flex-col h-full w-full gap-4 overflow-hidden'>
			{/* Header bar */}
			<div className='shrink-0 bg-slate-900/10 border border-slate-900 rounded-xl p-4 flex items-start gap-4'>
				<span className='p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 shrink-0 mt-0.5'>
					<Filter className='w-4.5 h-4.5' />
				</span>
				<div className='flex-1 min-w-0'>
					<h3 className='text-sm font-extrabold text-slate-200 uppercase tracking-wider'>Floating Filters</h3>
					<p className='text-[10px] text-slate-400 mt-0.5 leading-relaxed'>
						Always-visible inline filter row below column headers. Text, number, date, and set filter types.
					</p>
				</div>
				<div className='flex items-center gap-3 shrink-0'>
					{activeFilterCount > 0 && (
						<button
							onClick={clearAllFilters}
							className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[11px] font-semibold hover:bg-rose-500/20 transition-colors'
						>
							<X className='w-3 h-3' />
							Clear {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
						</button>
					)}
					<button
						onClick={() => setShowFloating((v) => !v)}
						className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
							showFloating
								? 'bg-violet-500/15 border-violet-500/30 text-violet-300 hover:bg-violet-500/25'
								: 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
						}`}
					>
						{showFloating ? <ToggleRight className='w-3.5 h-3.5' /> : <ToggleLeft className='w-3.5 h-3.5' />}
						Floating Filters {showFloating ? 'ON' : 'OFF'}
					</button>
				</div>
			</div>

			{/* Active filter chips */}
			{activeFilterCount > 0 && (
				<div className='shrink-0 flex flex-wrap gap-2 px-1'>
					{filterModel.map((filter) => {
						const opMap: Record<string, string> = {
							contains: 'contains',
							equals: '=',
							gte: '≥',
							lte: '≤',
							gt: '>',
							lt: '<',
							notEquals: '≠',
						};
						const desc = `${opMap[filter.operator] ?? filter.operator} ${filter.value ?? ''}`;
						return (
							<div
								key={filter.field}
								className='flex items-center gap-2 px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/25 text-[10px] font-semibold text-violet-300'
							>
								<span className='opacity-60'>{filter.field}:</span>
								<span>{desc}</span>
								<button
									onClick={() => removeFilter(filter.field)}
									className='ml-1 text-violet-400 hover:text-white transition-colors'
								>
									<X className='w-2.5 h-2.5' />
								</button>
							</div>
						);
					})}
				</div>
			)}

			{/* Grid */}
			<div className='flex-1 min-h-0 relative overflow-hidden'>
				<Grid<DealRow>
					rows={rows}
					columns={columns}
					getRowId={(row) => row.id}
					showFloatingFilters={showFloating}
					showFilterChipBar={true}
					pinLeftColumns={pinLeftColumns ?? 1}
					onGridReady={handleGridReady}
				/>
			</div>

			{/* Footer note */}
			<div className='shrink-0 p-3 bg-slate-900/10 border border-slate-900 rounded-xl flex items-start gap-2.5'>
				<Code2 className='w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5' />
				<p className='text-[9px] text-slate-500 leading-relaxed font-medium'>
					<span className='text-slate-400 font-bold'>Default inputs:</span> text → contains, number → equals, date → on date.{' '}
					<span className='text-slate-400 font-bold'>Toggle:</span> The ON/OFF button passes{' '}
					<code className='text-emerald-400 bg-emerald-500/10 px-1 rounded'>showFloatingFilters</code> as a prop — no API call needed.
				</p>
			</div>
		</div>
	);
}
