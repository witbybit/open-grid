/**
 * Row Multi-Select Demo
 *
 * Showcases row multi-select with the new GridApi:
 *   - api.selection.selectRows / clear
 *   - api.selection.getState().selectedRowIds
 *   - api.subscribe → selection.changed event
 *   - Bulk actions: delete, CSV export, tag
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Grid, type GridColumnDef, type GridApi } from '@open-grid/react';
import { CheckSquare, Trash2, Download, Tag, MousePointerClick, Info } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

interface OrderRow {
	id: string;
	orderId: string;
	customer: string;
	product: string;
	qty: number;
	unitPrice: number;
	status: 'Fulfilled' | 'Pending' | 'Cancelled';
	region: string;
}

const CUSTOMERS = ['Acme Corp', 'GlobalTech', 'NovaStar', 'ByteWave', 'PrimeLine', 'CoreLogic', 'SkyNet', 'DataFuse'];
const PRODUCTS = ['Widget Pro', 'Gadget X', 'Ultra Module', 'Nexus Kit', 'CorePack', 'Flex Unit', 'Spark One', 'Orbit Set'];
const STATUSES: OrderRow['status'][] = ['Fulfilled', 'Pending', 'Cancelled'];
const REGIONS = ['APAC', 'EMEA', 'AMER', 'LATAM'];

function generateOrders(count: number): OrderRow[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `ORD-${1000 + i}`,
		orderId: `ORD-${1000 + i}`,
		customer: CUSTOMERS[i % CUSTOMERS.length]!,
		product: PRODUCTS[i % PRODUCTS.length]!,
		qty: ((i * 7) % 20) + 1,
		unitPrice: ((i * 13) % 90) + 10,
		status: STATUSES[i % STATUSES.length]!,
		region: REGIONS[i % REGIONS.length]!,
	}));
}

// ─── Column definitions ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
	Fulfilled: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
	Pending: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
	Cancelled: 'bg-rose-500/10 border-rose-500/20 text-rose-400',
};

const StatusBadge = ({ value }: { value: unknown }) => {
	const v = String(value ?? '');
	return (
		<span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border leading-none inline-block ${STATUS_COLORS[v] ?? 'text-slate-400'}`}>
			{v}
		</span>
	);
};

const COLUMNS: GridColumnDef<OrderRow>[] = [
	{ id: 'orderId', field: 'orderId', header: 'Order ID', width: 110 },
	{ id: 'customer', field: 'customer', header: 'Customer', width: 130 },
	{ id: 'product', field: 'product', header: 'Product', width: 150 },
	{ id: 'qty', field: 'qty', header: 'Qty', width: 70 },
	{ id: 'unitPrice', field: 'unitPrice', header: 'Unit Price', width: 100, valueGetter: ({ row }) => `$${Number(row.unitPrice).toFixed(2)}` },
	{
		id: 'status', field: 'status', header: 'Status', width: 110,
		renderer: { kind: 'react', component: ({ value }: { value: unknown }) => <StatusBadge value={value} /> } as any,
	},
	{ id: 'region', field: 'region', header: 'Region', width: 90 },
];

function BulkActions({
	onDelete,
	onExport,
	onTag,
	onSelectAll,
	onClear,
	bulkTag,
	setBulkTag,
	selectedCount,
}: {
	onDelete: () => void;
	onExport: () => void;
	onTag: () => void;
	onSelectAll: () => void;
	onClear: () => void;
	bulkTag: string;
	setBulkTag: (v: string) => void;
	selectedCount: number;
}) {
	const hasSelection = selectedCount > 0;
	return (
		<>
			<div className='flex items-center gap-1.5'>
				<input
					type='text'
					value={bulkTag}
					onChange={(e) => setBulkTag(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && onTag()}
					placeholder='Tag label…'
					className='w-28 text-[11px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500 transition'
				/>
				<button
					onClick={onTag}
					disabled={!hasSelection || !bulkTag.trim()}
					className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition border border-slate-700'
				>
					<Tag className='w-3.5 h-3.5' /> Tag
				</button>
			</div>
			<button
				onClick={onExport}
				disabled={!hasSelection}
				className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition border border-slate-700'
			>
				<Download className='w-3.5 h-3.5' /> Export CSV
			</button>
			<button
				onClick={onDelete}
				disabled={!hasSelection}
				className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-900/50 hover:bg-rose-800/60 text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed transition border border-rose-800/50'
			>
				<Trash2 className='w-3.5 h-3.5' /> Delete
			</button>
			<button
				onClick={onSelectAll}
				className='px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-900/40 hover:bg-indigo-800/50 text-indigo-300 transition border border-indigo-800/50'
			>
				Select All
			</button>
			<button
				onClick={onClear}
				disabled={!hasSelection}
				className='px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition border border-slate-700'
			>
				Clear
			</button>
		</>
	);
}

// ─── Main demo ────────────────────────────────────────────────────────────────

interface RowMultiSelectDemoProps {
	onGridReady?: (api: GridApi<OrderRow>) => void;
}

export default function RowMultiSelectDemo({ onGridReady }: RowMultiSelectDemoProps) {
	const [rows, setRows] = useState<OrderRow[]>(() => generateOrders(120));
	const [lastEvent, setLastEvent] = useState<string>('—');
	const [bulkTag, setBulkTag] = useState<string>('');
	const [api, setApi] = useState<GridApi<OrderRow> | null>(null);
	const [selectedCount, setSelectedCount] = useState(0);

	useEffect(() => {
		if (!api) return;
		setSelectedCount(api.selection.getState().selectedRowIds.size);
		return api.subscribe((event) => {
			if (event.type === 'selection.changed') {
				const size = api.selection.getState().selectedRowIds.size;
				setSelectedCount(size);
				setLastEvent(`${size} row(s) selected`);
			}
		});
	}, [api]);

	const handleDeleteSelected = useCallback(() => {
		if (!api) return;
		const ids = api.selection.getState().selectedRowIds;
		if (ids.size === 0) return;
		setRows((prev) => prev.filter((r) => !ids.has(r.id)));
		api.selection.clear();
	}, [api]);

	const handleExportCSV = useCallback(() => {
		if (!api) return;
		const selectedIds = api.selection.getState().selectedRowIds;
		const checked = rows.filter((r) => selectedIds.has(r.id));
		if (checked.length === 0) return;
		const header = 'Order ID,Customer,Product,Qty,Unit Price,Status,Region';
		const lines = checked.map((r) => `${r.orderId},${r.customer},${r.product},${r.qty},${r.unitPrice},${r.status},${r.region}`);
		const csv = [header, ...lines].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'selected-orders.csv';
		a.click();
		URL.revokeObjectURL(url);
	}, [api, rows]);

	const handleTagSelected = useCallback(() => {
		if (!api) return;
		const tag = bulkTag.trim();
		if (!tag) return;
		const selectedIds = api.selection.getState().selectedRowIds;
		if (selectedIds.size === 0) return;
		setRows((prev) => prev.map((r) => (selectedIds.has(r.id) ? { ...r, product: `[${tag}] ${r.product}` } : r)));
		setBulkTag('');
	}, [api, bulkTag]);

	const handleSelectAll = useCallback(() => {
		if (!api) return;
		api.selection.selectRows(rows.map((r) => r.id));
	}, [api, rows]);

	return (
		<div className='flex flex-col gap-4 h-full min-h-0'>
			<div className='flex gap-3 shrink-0'>
				<div className='flex-1 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5'>
					<div className='flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-400'>
						<CheckSquare className='w-3.5 h-3.5' /> First-Class Row Selection
					</div>
					<p className='text-[11px] text-slate-400 leading-snug'>
						Use <code className='bg-slate-800 px-1 rounded text-indigo-300 font-mono text-[10px]'>api.selection.selectRows</code> and{' '}
						<code className='bg-slate-800 px-1 rounded text-indigo-300 font-mono text-[10px]'>api.selection.clear</code> for programmatic control.
					</p>
				</div>
				<div className='flex-1 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5'>
					<div className='flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-400'>
						<MousePointerClick className='w-3.5 h-3.5' /> Click to Select
					</div>
					<p className='text-[11px] text-slate-400 leading-snug'>
						Click rows to select them. Use the bulk actions above to operate on the selected set.
					</p>
				</div>
			</div>

			<div className='flex items-center gap-3 shrink-0 bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-2.5'>
				<div className='flex items-center gap-2 text-[11px] text-slate-500 font-medium'>
					<Info className='w-3.5 h-3.5 shrink-0' />
					{selectedCount > 0 ? `${selectedCount} row(s) selected` : 'No selection — click rows to select'}
				</div>
				<div className='flex-1' />
				<BulkActions
					api={api}
					selectedCount={selectedCount}
					onDelete={handleDeleteSelected}
					onExport={handleExportCSV}
					onTag={handleTagSelected}
					onSelectAll={handleSelectAll}
					onClear={() => api?.selection.clear()}
					bulkTag={bulkTag}
					setBulkTag={setBulkTag}
				/>
			</div>

			<div className='flex-1 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-slate-950 shadow-2xl flex flex-col'>
				<div className='flex-1 min-h-0'>
					<Grid<OrderRow>
						rows={rows}
						columns={COLUMNS}
						getRowId={(row) => row.id}
						showStatusBar
						onGridReady={(api) => {
							setApi(api);
							onGridReady?.(api);
						}}
					/>
				</div>
			</div>

			<div className='shrink-0 flex items-center gap-2 text-[10px] font-mono'>
				<span className='text-slate-600'>selection.changed →</span>
				<span className='text-slate-400'>{lastEvent}</span>
			</div>
		</div>
	);
}
