import React, { useState, useMemo, useCallback } from 'react';
import { Grid, type GridColumnDef, type CellRendererProps, type GridApi } from '@open-grid/react';
import { asColumnId } from '@open-grid/core';
import {
	Layers,
	FolderTree,
	ArrowDownWideNarrow,
	Folder,
	File,
	ChevronRight,
	ChevronDown,
	PackageOpen,
	CheckCircle,
	RefreshCw,
	Sparkles,
	Settings,
	ShieldAlert,
} from 'lucide-react';
import { LatencyProfiler, StatusBadgeRenderer, PriceBadgeRenderer } from '../components/GridShared';

// ============================================================================
// Types
// ============================================================================

interface EmployeeRow {
	id: string;
	name: string;
	department: string;
	title: string;
	rating: number;
	salary: number;
}

interface FileNodeRow {
	id: string;
	name: string;
	type: 'folder' | 'tsx' | 'json' | 'css' | 'md';
	size?: string;
	modifiedAt?: string;
	parentId?: string;
}

interface OrderRow {
	id: string;
	customerName: string;
	orderDate: string;
	totalAmount: number;
	status: 'Shipped' | 'Pending' | 'Cancelled';
}

interface OrderItemRow {
	id: string;
	itemName: string;
	price: number;
	quantity: number;
	subtotal: number;
}

// ============================================================================
// Mock Data
// ============================================================================

const groupRows: EmployeeRow[] = [
	{ id: 'EMP-01', name: 'Rishi Patel', department: 'Engineering', title: 'Principal Architect', rating: 5, salary: 185000 },
	{ id: 'EMP-02', name: 'Sarah Connor', department: 'Engineering', title: 'Staff Engineer', rating: 5, salary: 160000 },
	{ id: 'EMP-03', name: 'John Doe', department: 'Engineering', title: 'Senior Developer', rating: 4, salary: 120000 },
	{ id: 'EMP-04', name: 'Jane Smith', department: 'Design', title: 'Lead Designer', rating: 5, salary: 140000 },
	{ id: 'EMP-05', name: 'Alex Mercer', department: 'Design', title: 'Product Designer', rating: 4, salary: 95000 },
	{ id: 'EMP-06', name: 'David Miller', department: 'Product', title: 'Director of Product', rating: 5, salary: 165000 },
	{ id: 'EMP-07', name: 'Emily Vance', department: 'Product', title: 'Product Manager', rating: 4, salary: 110000 },
	{ id: 'EMP-08', name: 'Gordon Freeman', department: 'Research', title: 'Theoretical Physicist', rating: 5, salary: 250000 },
	{ id: 'EMP-09', name: 'Alyx Vance', department: 'Research', title: 'Field Researcher', rating: 5, salary: 130000 },
	{ id: 'EMP-10', name: 'Isaac Kleiner', department: 'Research', title: 'Lab Coordinator', rating: 4, salary: 155000 },
];

const treeRows: FileNodeRow[] = [
	{ id: 'root', name: 'open-grid-monorepo', type: 'folder' },
	{ id: 'packages', name: 'packages', type: 'folder', parentId: 'root' },
	{ id: 'core', name: 'core', type: 'folder', parentId: 'packages' },
	{ id: 'core-src', name: 'src', type: 'folder', parentId: 'core' },
	{ id: 'store-tsx', name: 'store.ts', type: 'tsx', size: '24.5 KB', modifiedAt: '2 hours ago', parentId: 'core-src' },
	{ id: 'rowmodel-tsx', name: 'rowModel.ts', type: 'tsx', size: '15.4 KB', modifiedAt: '1 day ago', parentId: 'core-src' },
	{ id: 'packages-json', name: 'package.json', type: 'json', size: '1.8 KB', modifiedAt: '3 days ago', parentId: 'core' },
	{ id: 'react', name: 'react', type: 'folder', parentId: 'packages' },
	{ id: 'react-src', name: 'src', type: 'folder', parentId: 'react' },
	{ id: 'grid-surface-tsx', name: 'GridSurface.tsx', type: 'tsx', size: '17.1 KB', modifiedAt: '5 mins ago', parentId: 'react-src' },
	{ id: 'gridportal-tsx', name: 'GridPortal.tsx', type: 'tsx', size: '8.4 KB', modifiedAt: '2 hours ago', parentId: 'react-src' },
	{ id: 'demo', name: 'demo', type: 'folder', parentId: 'root' },
	{ id: 'demo-src', name: 'src', type: 'folder', parentId: 'demo' },
	{ id: 'app-tsx', name: 'App.tsx', type: 'tsx', size: '11.2 KB', modifiedAt: 'Just now', parentId: 'demo-src' },
	{ id: 'nested-tsx', name: 'NestedTablesGrouping.tsx', type: 'tsx', size: '12.0 KB', modifiedAt: 'Just now', parentId: 'demo-src' },
	{ id: 'readme-md', name: 'README.md', type: 'md', size: '4.2 KB', modifiedAt: 'Last week', parentId: 'root' },
];

const masterRows: OrderRow[] = [
	{ id: 'ORD-101', customerName: 'Apex Capital', orderDate: '2026-05-28', totalAmount: 4950.0, status: 'Shipped' },
	{ id: 'ORD-102', customerName: 'Cyberdyne Systems', orderDate: '2026-05-27', totalAmount: 12400.0, status: 'Pending' },
	{ id: 'ORD-103', customerName: 'Umbrella Corp', orderDate: '2026-05-26', totalAmount: 3120.5, status: 'Shipped' },
	{ id: 'ORD-104', customerName: 'Weyland-Yutani', orderDate: '2026-05-25', totalAmount: 18450.0, status: 'Cancelled' },
	{ id: 'ORD-105', customerName: 'Initech Inc', orderDate: '2026-05-24', totalAmount: 150.0, status: 'Shipped' },
];

const orderItemsMap: Record<string, OrderItemRow[]> = {
	'ORD-101': [
		{ id: 'ITM-01', itemName: 'High-Freq Options Feed Sub', price: 2500, quantity: 1, subtotal: 2500 },
		{ id: 'ITM-02', itemName: 'Ultra-Low Latency Port licenses', price: 816.66, quantity: 3, subtotal: 2450 },
	],
	'ORD-102': [{ id: 'ITM-03', itemName: 'T-800 Neural Net CPU Module', price: 6200, quantity: 2, subtotal: 12400 }],
	'ORD-103': [{ id: 'ITM-04', itemName: 'T-Virus Containment Capsule', price: 1560.25, quantity: 2, subtotal: 3120.5 }],
	'ORD-104': [
		{ id: 'ITM-05', itemName: 'M41A Pulse Rifle Replica Pro', price: 2050, quantity: 5, subtotal: 10250 },
		{ id: 'ITM-06', itemName: 'Power Loader Hydraulic Core', price: 4100, quantity: 2, subtotal: 8200 },
	],
	'ORD-105': [{ id: 'ITM-07', itemName: 'Red Swingline Stapler (Special)', price: 75, quantity: 2, subtotal: 150 }],
};

const initialQuantities: Record<string, number> = {
	'ITM-01': 1, 'ITM-02': 3, 'ITM-03': 2, 'ITM-04': 2, 'ITM-05': 5, 'ITM-06': 2, 'ITM-07': 2,
};

// ============================================================================
// Custom Renderers
// ============================================================================

const SalaryRenderer = ({ value }: CellRendererProps<EmployeeRow>) => {
	const sal = parseFloat(String(value)) || 0;
	return <span className='font-mono font-bold text-slate-200'>${sal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>;
};

const RatingStarsRenderer = ({ value }: CellRendererProps<EmployeeRow>) => {
	const stars = Math.min(5, Math.max(0, Number(value) || 0));
	return (
		<div className='flex items-center text-amber-400 select-none h-full'>
			{Array.from({ length: 5 }).map((_, i) => (
				<span key={i} className='text-sm'>{i < stars ? '★' : '☆'}</span>
			))}
		</div>
	);
};

const TreeNameRenderer = ({ value, row, api }: CellRendererProps<FileNodeRow>) => {
	const isFolder = row.type === 'folder';
	const Icon = isFolder ? Folder : File;

	const handleToggle = (e: React.MouseEvent) => {
		if (!isFolder) return;
		e.stopPropagation();
		const start = performance.now();
		api.pipeline.toggleTreeNode(row.id);
		LatencyProfiler.record(performance.now() - start);
	};

	return (
		<div className='flex items-center h-full select-none'>
			<button
				type='button'
				onClick={handleToggle}
				className='w-4 h-4 mr-1 flex items-center justify-center rounded hover:bg-slate-800 transition-colors'
			>
				{isFolder ? <ChevronRight className='w-3.5 h-3.5 text-slate-400' /> : null}
			</button>
			<Icon className={`w-3.5 h-3.5 mr-2 shrink-0 ${isFolder ? 'text-amber-400' : 'text-slate-400'}`} />
			<span className={`${isFolder ? 'font-semibold text-slate-200' : 'text-slate-300'}`}>{String(value)}</span>
		</div>
	);
};

// ============================================================================
// Nested Order Items Grid (for detail tab — shown in sidebar on row click)
// ============================================================================

interface NestedOrderGridProps {
	orderId: string;
	parentApi: GridApi<OrderRow> | null;
}

const NestedOrderGrid = ({ orderId, parentApi }: NestedOrderGridProps) => {
	const [detailApi, setDetailApi] = useState<GridApi<OrderItemRow> | null>(null);
	const items = useMemo(() => [...(orderItemsMap[orderId] || [])], [orderId]);

	const detailColumns = useMemo<GridColumnDef<OrderItemRow>[]>(
		() => [
			{ id: 'id', field: 'id', header: 'Item ID', width: 100 },
			{ id: 'itemName', field: 'itemName', header: 'Product Item Name', width: 260 },
			{ id: 'price', field: 'price', header: 'Unit Price', width: 130, renderer: { kind: 'react', component: PriceBadgeRenderer } },
			{ id: 'quantity', field: 'quantity', header: 'Qty', width: 100 },
			{ id: 'subtotal', field: 'subtotal', header: 'Total Value', width: 140, renderer: { kind: 'react', component: PriceBadgeRenderer } },
		],
		[]
	);

	const handleChildCellValueChanged = useCallback((rowId: string, colField: string, val: unknown) => {
		const start = performance.now();
		if (colField === 'quantity' && detailApi) {
			const q = parseInt(String(val)) || 0;
			const row = detailApi.rows.getRow(rowId);
			if (row) {
				const newSubtotal = q * row.price;
				detailApi.cells.setField(rowId, 'subtotal', newSubtotal);
				const originalItem = items.find((itm) => itm.id === rowId);
				if (originalItem) { originalItem.quantity = q; originalItem.subtotal = newSubtotal; }
				setTimeout(() => {
					if (!parentApi) return;
					let parentSum = 0;
					detailApi.rows.getAll().forEach((item) => { parentSum += item.subtotal; });
					parentApi.cells.setField(orderId, 'totalAmount', parentSum);
				}, 0);
			}
		}
		LatencyProfiler.record(performance.now() - start);
	}, [detailApi, items, orderId, parentApi]);

	if (items.length === 0) return <div className='p-4 text-[10px] text-slate-500'>No line items for this order.</div>;

	return (
		<div className='w-full flex flex-col gap-2 font-sans'>
			<div className='flex items-center gap-2 text-[10px] text-slate-400 font-extrabold uppercase tracking-widest'>
				<PackageOpen className='w-4 h-4 text-purple-400' />
				<span>Order Line Items ({orderId})</span>
			</div>
			<div className='h-48 border border-slate-850 rounded-lg overflow-hidden bg-slate-950/70 shadow-inner'>
				<Grid
					rows={items}
					columns={detailColumns}
					getRowId={(row) => row.id}
					onCellValueChanged={handleChildCellValueChanged}
					onGridReady={(api) => setDetailApi(api)}
				/>
			</div>
		</div>
	);
};

// ============================================================================
// Page Component
// ============================================================================

interface NestedTablesGroupingProps {
	onGridReady?: (api: GridApi<any>) => void;
}

export default function NestedTablesGrouping({ onGridReady }: NestedTablesGroupingProps) {
	const [activeTab, setActiveTab] = useState<'group' | 'tree' | 'detail'>('group');
	const [gridVersion, setGridVersion] = useState(0);
	const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
	const [masterApi, setMasterApi] = useState<GridApi<OrderRow> | null>(null);

	const [telemetryResult, setTelemetryResult] = useState<{
		totalOrders: number;
		totalQuantity: number;
		grandTotal: number;
		highestItem: string;
		highestPrice: number;
		timestamp: string;
	} | null>(null);

	const handleCalculateTotals = () => {
		let totalQuantity = 0;
		let grandTotal = 0;
		let highestItem = '—';
		let highestPrice = 0;
		for (const orderId of Object.keys(orderItemsMap)) {
			const items = orderItemsMap[orderId] || [];
			for (const item of items) {
				totalQuantity += item.quantity;
				grandTotal += item.subtotal;
				if (item.price > highestPrice) { highestPrice = item.price; highestItem = item.itemName; }
			}
		}
		setTelemetryResult({ totalOrders: masterRows.length, totalQuantity, grandTotal, highestItem, highestPrice, timestamp: new Date().toLocaleTimeString() });
	};

	const groupingColumns = useMemo<GridColumnDef<EmployeeRow>[]>(
		() => [
			{ id: 'id', field: 'id', header: 'ID', width: 100 },
			{ id: 'name', field: 'name', header: 'Full Name', width: 180 },
			{ id: 'department', field: 'department', header: 'Department', width: 140 },
			{ id: 'title', field: 'title', header: 'Job Title', width: 180 },
			{ id: 'rating', field: 'rating', header: 'Rating', width: 120, renderer: { kind: 'react', component: RatingStarsRenderer } },
			{ id: 'salary', field: 'salary', header: 'Salary', width: 140, renderer: { kind: 'react', component: SalaryRenderer } },
		],
		[]
	);

	const treeColumns = useMemo<GridColumnDef<FileNodeRow>[]>(
		() => [
			{ id: 'name', field: 'name', header: 'Node Path / Name', width: 260, renderer: { kind: 'react', component: TreeNameRenderer } },
			{
				id: 'type', field: 'type', header: 'File Type', width: 110,
				renderer: { kind: 'react', component: ({ value }: CellRendererProps<any>) => (
					<span className='text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wide'>{String(value)}</span>
				)},
			},
			{
				id: 'size', field: 'size', header: 'Capacity Size', width: 120,
				renderer: { kind: 'react', component: ({ value }: CellRendererProps<any>) => (
					<span className='font-mono text-slate-400 text-xs'>{String(value ?? '—')}</span>
				)},
			},
			{ id: 'modifiedAt', field: 'modifiedAt', header: 'Last Edited', width: 140 },
		],
		[]
	);

	const masterColumns = useMemo<GridColumnDef<OrderRow>[]>(
		() => [
			{ id: 'id', field: 'id', header: 'Order ID', width: 110 },
			{ id: 'customerName', field: 'customerName', header: 'Client Corporation', width: 220 },
			{ id: 'orderDate', field: 'orderDate', header: 'Purchase Date', width: 150 },
			{ id: 'totalAmount', field: 'totalAmount', header: 'Transaction Value', width: 160, renderer: { kind: 'react', component: PriceBadgeRenderer } },
			{ id: 'status', field: 'status', header: 'Fulfillment Status', width: 140, renderer: { kind: 'react', component: StatusBadgeRenderer } },
		],
		[]
	);

	const handleTabChange = (tab: 'group' | 'tree' | 'detail') => {
		setActiveTab(tab);
		setGridVersion((v) => v + 1);
		setSelectedOrderId(null);
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden font-sans'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-purple-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-purple-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<Layers className='w-4 h-4 text-purple-400' />
							Hierarchical & Relational Layout Desk
						</span>
					</div>
					<div className='flex bg-slate-950 border border-slate-850 p-1 rounded-xl shadow-inner text-xs font-semibold gap-1'>
						<button
							onClick={() => handleTabChange('group')}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${activeTab === 'group' ? 'bg-purple-600 text-white shadow shadow-purple-600/20' : 'text-slate-400 hover:text-slate-200'}`}
						>
							<Layers className='w-3.5 h-3.5' />
							Row Grouping
						</button>
						<button
							onClick={() => handleTabChange('tree')}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${activeTab === 'tree' ? 'bg-amber-600 text-white shadow shadow-amber-600/20' : 'text-slate-400 hover:text-slate-200'}`}
						>
							<FolderTree className='w-3.5 h-3.5' />
							Tree Hierarchy
						</button>
						<button
							onClick={() => handleTabChange('detail')}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${activeTab === 'detail' ? 'bg-pink-600 text-white shadow shadow-pink-600/20' : 'text-slate-400 hover:text-slate-200'}`}
						>
							<PackageOpen className='w-3.5 h-3.5' />
							Master-Detail
						</button>
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0 border border-slate-900 rounded-lg overflow-hidden bg-slate-950 shadow-2xl relative'>
					{activeTab === 'group' && (
						<Grid<EmployeeRow>
							key={`group-${gridVersion}`}
							rows={groupRows}
							columns={groupingColumns}
							showGroupPanel
							onMount={(api) => {
								api.pipeline.setGroupBy([{ columnId: asColumnId('department'), field: 'department' }]);
							}}
							onGridReady={onGridReady}
						/>
					)}
					{activeTab === 'tree' && (
						<Grid<FileNodeRow>
							key={`tree-${gridVersion}`}
							rows={treeRows}
							columns={treeColumns}
							getRowId={(row) => row.id}
							onMount={(api) => {
								api.pipeline.setTreeData({ getParentId: (row) => row.parentId ?? null });
							}}
							onGridReady={onGridReady}
						/>
					)}
					{activeTab === 'detail' && (
						<Grid<OrderRow>
							key={`detail-${gridVersion}`}
							rows={masterRows}
							columns={masterColumns}
							getRowId={(row) => row.id}
							onCellClicked={({ rowId }) => setSelectedOrderId(String(rowId))}
							onGridReady={(api) => {
								setMasterApi(api);
								onGridReady?.(api);
							}}
						/>
					)}
				</div>
			</div>

			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5 leading-normal'>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Sparkles className='w-4 h-4 text-purple-400' />
						VisualRow Architecture
					</h3>
					<div className='text-xs text-slate-300 flex flex-col gap-2.5'>
						<p>Each visible row is a pipeline-driven <span className='font-mono text-purple-400'>VisualRow</span> discriminated union.</p>
						<p>This enables complex render hierarchies without mutating the original dataset.</p>
					</div>
					<div className='border-t border-slate-900/60 pt-3 flex flex-col gap-2 text-[10px]'>
						<div className='flex items-center gap-2 text-slate-400'>
							<CheckCircle className='w-4 h-4 text-emerald-400 shrink-0' />
							<span>Zero data-row mutation on expansion</span>
						</div>
						<div className='flex items-center gap-2 text-slate-400'>
							<CheckCircle className='w-4 h-4 text-emerald-400 shrink-0' />
							<span>Dynamic parent aggregate calculation</span>
						</div>
						<div className='flex items-center gap-2 text-slate-400'>
							<CheckCircle className='w-4 h-4 text-emerald-400 shrink-0' />
							<span>Infinite nested components via portals</span>
						</div>
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Settings className='w-4 h-4 text-indigo-400' />
						Layout Features
					</h3>
					{activeTab === 'group' && (
						<div className='text-xs text-slate-300 flex flex-col gap-2 leading-relaxed'>
							<span className='text-[10px] font-extrabold text-purple-400 uppercase tracking-wide'>📦 Row Grouping Mode</span>
							<p>Groups employee data on the fly by their <span className='font-semibold text-slate-200'>Department</span> column.</p>
							<p>Use the group panel to drag columns for ad-hoc grouping.</p>
						</div>
					)}
					{activeTab === 'tree' && (
						<div className='text-xs text-slate-300 flex flex-col gap-2 leading-relaxed'>
							<span className='text-[10px] font-extrabold text-amber-500 uppercase tracking-wide'>🌳 Tree Hierarchy Mode</span>
							<p>Uses a parent-child recursive tree structure to build directory files and folders.</p>
							<p>Click the chevron in the Name column to expand/collapse folder nodes.</p>
						</div>
					)}
					{activeTab === 'detail' && (
						<div className='text-xs text-slate-300 flex flex-col gap-2 leading-relaxed'>
							<span className='text-[10px] font-extrabold text-pink-400 uppercase tracking-wide'>🔍 Master-Detail Mode</span>
							<p>Click any order row to view its line items below. Edit the <span className='font-mono text-pink-300 text-[10px]'>Qty</span> column to update subtotals.</p>
						</div>
					)}
				</div>

				{activeTab === 'detail' && selectedOrderId && (
					<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 glass-card relative overflow-hidden shadow-lg border-purple-500/20'>
						<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none' />
						<NestedOrderGrid orderId={selectedOrderId} parentApi={masterApi} />
					</div>
				)}

				{activeTab === 'detail' && (
					<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 glass-card relative overflow-hidden shadow-lg border-purple-500/20'>
						<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none' />
						<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<RefreshCw className='w-4 h-4 text-purple-400 font-bold shrink-0 animate-pulse' />
							Cross-Grid Portfolio Ledger
						</h3>
						<button
							onClick={handleCalculateTotals}
							className='w-full py-2.5 px-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-xs shadow-md shadow-purple-600/20 active:scale-95 transition-transform duration-100 flex items-center justify-center gap-1.5 cursor-pointer'
						>
							<Sparkles className='w-3.5 h-3.5 animate-bounce' />
							Calculate Sub-Grid Summary
						</button>
						{telemetryResult ? (
							<div className='flex flex-col gap-2.5 mt-1 border-t border-slate-800/80 pt-2.5'>
								<div className='grid grid-cols-2 gap-2 text-[10px] font-mono'>
									<div className='p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col'>
										<span className='text-slate-500 text-[8px] uppercase font-sans font-extrabold'>Total Orders</span>
										<span className='text-purple-400 text-sm font-extrabold mt-0.5'>{telemetryResult.totalOrders}</span>
									</div>
									<div className='p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col'>
										<span className='text-slate-500 text-[8px] uppercase font-sans font-extrabold'>Total Items</span>
										<span className='text-pink-400 text-sm font-extrabold mt-0.5'>{telemetryResult.totalQuantity} qty</span>
									</div>
								</div>
								<div className='p-2.5 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col font-mono text-left'>
									<span className='text-slate-500 text-[8px] uppercase font-sans font-extrabold'>Grand Total</span>
									<span className='text-emerald-400 text-base font-extrabold mt-0.5'>
										${telemetryResult.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
									</span>
								</div>
								<div className='text-[8px] text-slate-500 text-center italic mt-0.5'>
									Calculated at {telemetryResult.timestamp}
								</div>
							</div>
						) : (
							<div className='text-[10px] text-slate-500 italic p-3 bg-slate-950/40 border border-slate-900/60 rounded-lg text-center leading-normal'>
								Click an order row to see its items, then calculate totals.
							</div>
						)}
					</div>
				)}

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<ShieldAlert className='w-4 h-4 text-rose-400' />
						Portal Mounting Performance
					</h3>
					<div className='flex items-center gap-2 mt-1'>
						<ArrowDownWideNarrow className='w-3.5 h-3.5 text-rose-400 shrink-0' />
						<div className='text-xs text-slate-400'>
							Active Portal Subsystems: <span className='font-mono text-slate-200 font-bold'>Wired</span>
						</div>
					</div>
					<p className='text-[10px] text-slate-500 leading-normal mt-1'>
						Visual portal mounts are batch-flushed to avoid layout thrashing, ensuring smooth performance even with deep sub-grid recursion.
					</p>
				</div>
			</div>
		</div>
	);
}
