import React, { useEffect } from 'react';
import { GridProvider, OpenGrid, useClientGrid, createLocalStorageAdapter } from '@open-grid/react';
import type { AggregationDef, ColumnDef, CellRendererProps, GroupVisualRow } from '@open-grid/react';

// ── Data model ────────────────────────────────────────────────────────────────

interface SalesRow {
	id: string;
	region: string;
	country: string;
	category: string;
	product: string;
	rep: string;
	quarter: string;
	revenue: number;
	units: number;
	margin: number;
	status: 'Won' | 'Lost' | 'Pending';
}

const REGIONS = ['Americas', 'EMEA', 'APAC'];
const COUNTRIES: Record<string, string[]> = {
	Americas: ['USA', 'Canada', 'Brazil', 'Mexico'],
	EMEA: ['UK', 'Germany', 'France', 'Netherlands', 'Sweden'],
	APAC: ['Japan', 'Australia', 'Singapore', 'India', 'South Korea'],
};
const CATEGORIES = ['Hardware', 'Software', 'Services', 'Cloud'];
const PRODUCTS: Record<string, string[]> = {
	Hardware: ['Workstation Pro', 'Server Blade', 'Network Switch', 'SSD Array'],
	Software: ['Analytics Suite', 'DevOps Platform', 'Security Shield', 'ERP Core'],
	Services: ['Consulting Pack', 'Support Gold', 'Training Bundle', 'Migration Kit'],
	Cloud: ['Compute Flex', 'Storage Plus', 'CDN Accelerate', 'ML Pipeline'],
};
const REPS = ['Alice Chen', 'Ben Morris', 'Cara Singh', 'David Kim', 'Elena Voss', 'Felix Tan', 'Grace Park', 'Hiro Yamamoto'];
const QUARTERS = ['Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024'];
const STATUSES: SalesRow['status'][] = ['Won', 'Won', 'Won', 'Pending', 'Pending', 'Lost'];

function generateRows(count: number): SalesRow[] {
	return Array.from({ length: count }, (_, i) => {
		const region = REGIONS[i % REGIONS.length];
		const countryList = COUNTRIES[region];
		const country = countryList[Math.floor(i / REGIONS.length) % countryList.length];
		const category = CATEGORIES[(i * 3) % CATEGORIES.length];
		const productList = PRODUCTS[category];
		const product = productList[(i * 7) % productList.length];
		const rep = REPS[(i * 5) % REPS.length];
		const quarter = QUARTERS[(i * 2) % QUARTERS.length];
		const base = 20000 + ((i * 7919 + 13) % 180000);
		const revenue = Math.round(base / 100) * 100;
		const units = 1 + ((i * 11 + 3) % 49);
		const margin = Math.round((15 + ((i * 17) % 45)) * 10) / 10;
		const status = STATUSES[i % STATUSES.length];
		return { id: `sale-${i}`, region, country, category, product, rep, quarter, revenue, units, margin, status };
	});
}

// ── Aggregation definitions ───────────────────────────────────────────────────

const AGG_DEFS: AggregationDef<SalesRow>[] = [
	{ field: 'revenue', aggFunc: 'sum' },
	{ field: 'units', aggFunc: 'sum' },
	{ field: 'margin', aggFunc: 'avg' },
];

// ── Cell renderers ────────────────────────────────────────────────────────────

const CurrencyRenderer = ({ value }: CellRendererProps<SalesRow>) => (
	<span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>${Number(value).toLocaleString()}</span>
);

const MarginRenderer = ({ value }: CellRendererProps<SalesRow>) => {
	const v = Number(value);
	const color = v >= 40 ? '#34d399' : v >= 25 ? '#fbbf24' : '#f87171';
	return <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color }}>{v.toFixed(1)}%</span>;
};

const StatusRenderer = ({ value }: CellRendererProps<SalesRow>) => {
	const v = String(value);
	const s =
		v === 'Won'
			? { bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', color: '#34d399' }
			: v === 'Pending'
				? { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)', color: '#fbbf24' }
				: { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)', color: '#f87171' };
	return (
		<span
			style={{
				fontSize: 10,
				fontWeight: 700,
				textTransform: 'uppercase',
				letterSpacing: '0.05em',
				padding: '2px 7px',
				borderRadius: 4,
				background: s.bg,
				border: `1px solid ${s.border}`,
				color: s.color,
			}}
		>
			{v}
		</span>
	);
};

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMNS: ColumnDef<SalesRow>[] = [
	{ field: 'region', header: 'Region', width: 110, sortable: true, movable: true, enableRowGroup: true },
	{ field: 'country', header: 'Country', width: 120, sortable: true, movable: true, enableRowGroup: true },
	{ field: 'category', header: 'Category', width: 110, sortable: true, movable: true, enableRowGroup: true },
	{ field: 'product', header: 'Product', width: 160, sortable: true, movable: true, enableRowGroup: true },
	{ field: 'rep', header: 'Sales Rep', width: 145, sortable: true, movable: true, enableRowGroup: true },
	{ field: 'quarter', header: 'Quarter', width: 100, sortable: true, movable: true, enableRowGroup: true },
	{
		field: 'revenue',
		header: 'Revenue',
		width: 130,
		sortable: true,
		movable: true,
		enableRowGroup: false,
		renderer: { kind: 'react', component: CurrencyRenderer, capabilities: { scrollBehavior: 'live', estimatedCost: 'cheap' } },
	},
	{ field: 'units', header: 'Units', width: 75, sortable: true, movable: true, enableRowGroup: false },
	{
		field: 'margin',
		header: 'Margin %',
		width: 95,
		sortable: true,
		movable: true,
		enableRowGroup: false,
		renderer: { kind: 'react', component: MarginRenderer, capabilities: { scrollBehavior: 'live', estimatedCost: 'cheap' } },
	},
	{
		field: 'status',
		header: 'Status',
		width: 95,
		sortable: true,
		movable: true,
		enableRowGroup: true,
		renderer: { kind: 'react', component: StatusRenderer, capabilities: { scrollBehavior: 'live', estimatedCost: 'cheap' } },
	},
];

const ROWS = generateRows(500);

// ── Group row renderer ────────────────────────────────────────────────────────

function GroupRowRenderer({ visualRow, api }: { visualRow: GroupVisualRow<SalesRow>; api: ReturnType<typeof useClientGrid<SalesRow>> }) {
	const isExpanded = api.isGroupExpanded(visualRow.groupId);
	const agg = visualRow.aggregateValues;

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				height: '100%',
				paddingLeft: 8 + visualRow.depth * 16,
				gap: 10,
				cursor: 'pointer',
			}}
			onClick={() => api.toggleGroupExpanded(visualRow.groupId)}
		>
			<span
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: 16,
					height: 16,
					borderRadius: 3,
					background: 'rgba(167,139,250,0.15)',
					border: '1px solid rgba(167,139,250,0.3)',
					color: '#a78bfa',
					fontSize: 9,
					flexShrink: 0,
					transition: 'transform 0.15s',
					transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
				}}
			>
				▶
			</span>

			<span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.03em', minWidth: 80 }}>{visualRow.keyString}</span>

			<span
				style={{
					fontSize: 10,
					color: '#64748b',
					fontWeight: 500,
					padding: '1px 6px',
					borderRadius: 10,
					background: 'rgba(100,116,139,0.1)',
					border: '1px solid rgba(100,116,139,0.2)',
					flexShrink: 0,
				}}
			>
				{visualRow.leafCount} rows
			</span>

			{/* Aggregate chips */}
			{agg && (
				<div style={{ display: 'flex', gap: 6, marginLeft: 4 }}>
					{agg.revenue != null && (
						<span style={aggChip('#3b82f6')}>
							Rev: <strong>${Number(agg.revenue).toLocaleString()}</strong>
						</span>
					)}
					{agg.units != null && (
						<span style={aggChip('#10b981')}>
							Units: <strong>{Number(agg.units).toLocaleString()}</strong>
						</span>
					)}
					{agg.margin != null && (
						<span style={aggChip('#f59e0b')}>
							Avg Margin: <strong>{Number(agg.margin).toFixed(1)}%</strong>
						</span>
					)}
				</div>
			)}
		</div>
	);
}

function aggChip(color: string): React.CSSProperties {
	return {
		fontSize: 10,
		fontWeight: 500,
		padding: '1px 7px',
		borderRadius: 10,
		background: `${color}14`,
		border: `1px solid ${color}33`,
		color: `${color}cc`,
		whiteSpace: 'nowrap',
	};
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar({ api }: { api: ReturnType<typeof useClientGrid<SalesRow>> }) {
	return (
		<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
			<ToolBtn onClick={() => api.expandAllGroups()} title='Expand all groups'>
				Expand All
			</ToolBtn>
			<ToolBtn onClick={() => api.collapseAllGroups()} title='Collapse all groups'>
				Collapse All
			</ToolBtn>
			<div style={{ width: 1, height: 16, background: 'rgba(100,116,139,0.3)', margin: '0 2px' }} />
			<ToolBtn onClick={() => api.exportCsv({ fileName: 'sales-pipeline.csv' })} title='Download as CSV (Excel-compatible)' accent>
				Export CSV
			</ToolBtn>
		</div>
	);
}

function ToolBtn({ children, onClick, title, accent }: { children: React.ReactNode; onClick: () => void; title?: string; accent?: boolean }) {
	return (
		<button
			onClick={onClick}
			title={title}
			style={{
				height: 26,
				padding: '0 10px',
				fontSize: 10,
				fontWeight: 700,
				letterSpacing: '0.05em',
				textTransform: 'uppercase',
				borderRadius: 5,
				border: accent ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(30,41,59,0.8)',
				background: accent ? 'rgba(59,130,246,0.12)' : 'rgba(15,23,42,0.6)',
				color: accent ? '#60a5fa' : '#64748b',
				cursor: 'pointer',
				whiteSpace: 'nowrap',
			}}
		>
			{children}
		</button>
	);
}

// ── Inner component ───────────────────────────────────────────────────────────

function RealtimeGroupingDemoInner({ api }: { api: ReturnType<typeof useClientGrid<SalesRow>> }) {
	useEffect(() => {
		api.setRows(ROWS);
		api.setAggDefs(AGG_DEFS);
	}, [api]);

	return (
		<div style={{ display: 'flex', height: '100%', flexDirection: 'column', gap: 12 }}>
			{/* Intro strip */}
			<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
				<div className='flex items-center gap-2'>
					<span className='w-2 h-2 rounded-full bg-violet-500 animate-pulse' />
					<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>
						Sales Pipeline — 500 rows · 10 columns · Live Grouping + Aggregations
					</span>
				</div>
				<Toolbar api={api} />
			</div>

			{/* Grid */}
			<div className='flex-1 min-h-0 rounded-lg overflow-hidden border border-slate-800 shadow-2xl'>
				<OpenGrid<SalesRow>
					api={api}
					pinLeftColumns={1}
					enableContextMenu={true}
					groupRowRenderer={(props) => <GroupRowRenderer visualRow={props.visualRow as GroupVisualRow<SalesRow>} api={api} />}
					sidebar={{
						panels: ['columns', 'filters', 'sort'],
						defaultOpen: 'columns',
						position: 'right',
						width: 280,
					}}
				/>
			</div>
		</div>
	);
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function RealtimeGroupingDemo() {
	const api = useClientGrid<SalesRow>({
		columns: COLUMNS,
		rows: ROWS,
		persistence: createLocalStorageAdapter('open-grid-sales-demo'),
		initialState: {
			groupBy: ['region', 'category'],
			groupRowHeight: 40,
			showGroupFooter: true,
			enableStickyGroupRows: true,
		},
	});

	return (
		<GridProvider api={api}>
			<RealtimeGroupingDemoInner api={api} />
		</GridProvider>
	);
}
