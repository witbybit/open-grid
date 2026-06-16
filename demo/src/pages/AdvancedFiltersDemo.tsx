/**
 * Advanced Filters Demo — showcases all six ColumnFilterDef types:
 *   multi-select (static), single-select (static), async-multi-select,
 *   async-single-select, infinite-multi-select, custom renderer.
 *
 * Open the Sidebar Filters panel to see all filter types in action.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
	Grid,
	type ColumnDef,
	type GridApi,
	type GridReadyEvent,
	type FilterModel,
	type ColumnFilterDef,
	type FilterFetchParams,
	type FilterFetchResult,
	type FilterPageParams,
	type FilterPageResult,
	type CustomFilterRendererParams,
	type SelectFilterCondition,
} from '@open-grid/react';

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

// ── Fake async API (simulates server round-trip) ──────────────────────────────

function fakeDelay<T>(ms: number, value: T): Promise<T> {
	return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function fetchDepartmentOptions(params: FilterFetchParams, signal: AbortSignal): Promise<FilterFetchResult<string>> {
	await fakeDelay(400, null);
	if (signal.aborted) return { options: [] };
	const q = params.query.toLowerCase();
	const matched = DEPARTMENTS.filter((d) => d.toLowerCase().includes(q));
	return {
		options: matched.map((d) => ({ label: d, value: d, count: ALL_ROWS.filter((r) => r.department === d).length })),
		totalCount: matched.length,
	};
}

async function fetchSkillsPage(params: FilterPageParams, signal: AbortSignal): Promise<FilterPageResult<string>> {
	await fakeDelay(300, null);
	if (signal.aborted) return { options: [], hasMore: false };
	const q = params.query.toLowerCase();
	const matched = ALL_SKILLS.filter((s) => s.toLowerCase().includes(q));
	const page = matched.slice(params.page * params.pageSize, (params.page + 1) * params.pageSize);
	return {
		options: page.map((s) => ({ label: s, value: s })),
		hasMore: (params.page + 1) * params.pageSize < matched.length,
		totalCount: matched.length,
	};
}

// ── Custom salary range filter ────────────────────────────────────────────────

function SalaryRangeFilter({ params, theme }: { params: CustomFilterRendererParams; theme: any }) {
	const current = params.value?.type === 'select' ? (params.value as SelectFilterCondition) : null;
	const [min, setMin] = useState(current ? String(current.values[0] ?? '') : '');
	const [max, setMax] = useState(current ? String(current.values[1] ?? '') : '');

	const commit = (minVal: string, maxVal: string) => {
		const minN = minVal ? Number(minVal) : null;
		const maxN = maxVal ? Number(maxVal) : null;
		if (minN === null && maxN === null) {
			params.onCommit(null);
			return;
		}
		params.onCommit({ type: 'select', values: [minN, maxN], labels: [`$${minVal || 0}–$${maxVal || '∞'}`] });
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
			<div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
				<input
					type='number'
					placeholder='Min salary'
					value={min}
					onChange={(e) => setMin(e.target.value)}
					onBlur={() => commit(min, max)}
					style={{
						flex: 1,
						height: 26,
						padding: '0 8px',
						fontSize: 11,
						background: '#1e293b',
						border: '1px solid #334155',
						borderRadius: 4,
						color: '#e2e8f0',
						outline: 'none',
					}}
				/>
				<span style={{ fontSize: 10, color: '#64748b' }}>–</span>
				<input
					type='number'
					placeholder='Max'
					value={max}
					onChange={(e) => setMax(e.target.value)}
					onBlur={() => commit(min, max)}
					style={{
						flex: 1,
						height: 26,
						padding: '0 8px',
						fontSize: 11,
						background: '#1e293b',
						border: '1px solid #334155',
						borderRadius: 4,
						color: '#e2e8f0',
						outline: 'none',
					}}
				/>
			</div>
			{current && (
				<button
					onClick={() => {
						setMin('');
						setMax('');
						params.onCommit(null);
					}}
					style={{ fontSize: 10, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
				>
					Clear
				</button>
			)}
		</div>
	);
}

// ── Column definitions ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
	Active: '#22c55e',
	'On Leave': '#f59e0b',
	Contractor: '#60a5fa',
	Alumni: '#94a3b8',
};

function makeColumns(): ColumnDef<EmployeeRow>[] {
	return [
		{
			field: 'id',
			header: 'ID',
			width: 100,
			filterType: 'none',
		},
		{
			field: 'name',
			header: 'Name',
			width: 180,
			filterType: 'text',
		},
		{
			field: 'department',
			header: 'Department',
			width: 160,
			filterDef: {
				type: 'async-multi-select',
				fetchOptions: fetchDepartmentOptions,
				placeholder: 'Search departments…',
				showSelectAll: true,
				debounceMs: 200,
			} satisfies ColumnFilterDef<EmployeeRow, string>,
		},
		{
			field: 'location',
			header: 'Location',
			width: 150,
			filterDef: {
				type: 'multi-select',
				options: LOCATIONS.map((l) => ({ label: l, value: l })),
				searchable: true,
			} satisfies ColumnFilterDef<EmployeeRow, string>,
		},
		{
			field: 'status',
			header: 'Status',
			width: 130,
			renderer: {
				kind: 'react',
				component: ({ value }: { value: string }) => (
					<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
						<span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[value] ?? '#94a3b8', flexShrink: 0 }} />
						{value}
					</span>
				),
			},
			filterDef: {
				type: 'single-select',
				options: STATUSES.map((s) => ({ label: s, value: s, description: s === 'Active' ? 'Currently employed' : undefined })),
			} satisfies ColumnFilterDef<EmployeeRow, string>,
		},
		{
			field: 'level',
			header: 'Level',
			width: 100,
			filterDef: {
				type: 'multi-select',
				options: LEVELS.map((l) => ({ label: l, value: l })),
				showSelectAll: true,
			} satisfies ColumnFilterDef<EmployeeRow, string>,
		},
		{
			field: 'salary',
			header: 'Salary',
			width: 130,
			valueFormatter: ({ value }) => `$${Number(value).toLocaleString()}`,
			filterDef: {
				type: 'custom',
				renderFilter: (params) => <SalaryRangeFilter params={params as any} theme={null} />,
			} satisfies ColumnFilterDef<EmployeeRow, number>,
		},
		{
			field: 'startDate',
			header: 'Start Date',
			width: 130,
			filterType: 'date',
		},
		{
			field: 'skills',
			header: 'Skills',
			width: 220,
			filterDef: {
				type: 'infinite-multi-select',
				fetchPage: fetchSkillsPage,
				pageSize: 6,
				placeholder: 'Search skills…',
				debounceMs: 150,
			} satisfies ColumnFilterDef<EmployeeRow, string>,
		},
	];
}

// ── Demo page ─────────────────────────────────────────────────────────────────

export default function AdvancedFiltersDemo() {
	const apiRef = useRef<GridApi<EmployeeRow> | null>(null);
	const [filterModel, setFilterModel] = useState<FilterModel | null>(null);
	const columns = useMemo(() => makeColumns(), []);
	const rows = useMemo(() => ALL_ROWS, []);

	const onGridReady = useCallback((e: GridReadyEvent<EmployeeRow>) => {
		apiRef.current = e.api;
		// Subscribe to filter model changes
		e.api.subscribeToKey('filterModel', (state) => {
			setFilterModel((state as any).filterModel ?? null);
		});
	}, []);

	const activeFilters = filterModel ? Object.keys(filterModel).length : 0;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 12,
					padding: '0 4px',
					flexShrink: 0,
				}}
			>
				<div>
					<div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.01em' }}>Advanced Filters Demo</div>
					<div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
						Open sidebar → Filters tab to try multi-select, async, infinite-scroll, and custom filter components
					</div>
				</div>
				{activeFilters > 0 && (
					<button
						onClick={() => apiRef.current?.setFilterModel(null)}
						style={{
							marginLeft: 'auto',
							fontSize: 11,
							fontWeight: 600,
							color: '#60a5fa',
							background: 'rgba(59, 130, 246, 0.1)',
							border: '1px solid rgba(59, 130, 246, 0.3)',
							borderRadius: 6,
							padding: '4px 12px',
							cursor: 'pointer',
						}}
					>
						Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
					</button>
				)}
			</div>

			{/* Legend */}
			<div
				style={{
					display: 'flex',
					flexWrap: 'wrap',
					gap: 6,
					padding: '6px 10px',
					background: 'rgba(30, 41, 59, 0.5)',
					borderRadius: 8,
					border: '1px solid #1e293b',
					flexShrink: 0,
				}}
			>
				{[
					{ col: 'Department', type: 'async-multi-select', color: '#818cf8' },
					{ col: 'Location', type: 'multi-select', color: '#34d399' },
					{ col: 'Status', type: 'single-select', color: '#fbbf24' },
					{ col: 'Level', type: 'multi-select', color: '#34d399' },
					{ col: 'Salary', type: 'custom range', color: '#f472b6' },
					{ col: 'Skills', type: 'infinite-multi-select', color: '#60a5fa' },
				].map(({ col, type, color }) => (
					<div key={col} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
						<span
							style={{
								padding: '1px 6px',
								background: `${color}18`,
								border: `1px solid ${color}40`,
								borderRadius: 4,
								color,
								fontWeight: 600,
								fontFamily: 'monospace',
							}}
						>
							{type}
						</span>
						<span style={{ color: '#94a3b8' }}>{col}</span>
					</div>
				))}
			</div>

			{/* Grid */}
			<div style={{ flex: 1, minHeight: 0 }}>
				<Grid<EmployeeRow>
					mode='client'
					columns={columns}
					rows={rows}
					getRowId={(row) => row.id}
					onGridReady={onGridReady}
					showFilterChipBar={true}
					persistence='advancedfilters'
					sidebar={{ panels: ['columns', 'filters', 'sort', 'themes'], defaultOpen: 'filters' }}
				/>
			</div>
		</div>
	);
}
