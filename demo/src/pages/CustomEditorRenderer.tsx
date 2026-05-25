import React, { useState, useEffect, useMemo } from 'react';
import { GridProvider, useClientGrid, useGridKeySelector } from '@open-grid/react';
import { CustomShowcaseRow, GridView } from '../components/GridShared';
import { ShieldCheck, BarChart3, Star, AlertTriangle, Play, RefreshCw, Gauge } from 'lucide-react';

type ClientGrid = ReturnType<typeof useClientGrid<CustomShowcaseRow>>;

interface CustomEditorRendererProps {
	grid: ClientGrid;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

function CustomEditorRendererInner({
	grid,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: CustomEditorRendererProps) {
	const selectedRange = useGridKeySelector('selectedRange', (state) => state.selectedRange);

	const [telemetry, setTelemetry] = useState({
		totalAssets: 0,
		totalValuation: 0,
		avgRating: 0,
		lowDeploymentAlerts: 0,
		activeCount: 0,
		pendingCount: 0,
		inactiveCount: 0,
	});

	const calculateTelemetry = () => {
		const count = grid.api.getRowCount();
		let valSum = 0;
		let ratingSum = 0;
		let ratingCount = 0;
		let lowDep = 0;
		let active = 0;
		let pending = 0;
		let inactive = 0;

		for (let i = 0; i < count; i++) {
			const r = grid.api.getRow(i);
			if (r) {
				const priceNum = parseFloat(String(r.price).replace(/[^0-9.-]+/g, '')) || 0;
				valSum += priceNum;

				const ratingNum = parseFloat(String(r.rating)) || 0;
				if (ratingNum > 0) {
					ratingSum += ratingNum;
					ratingCount++;
				}

				const progressNum = parseFloat(String(r.progress)) || 0;
				if (progressNum < 30) {
					lowDep++;
				}

				if (r.status === 'Active') active++;
				else if (r.status === 'Pending') pending++;
				else inactive++;
			}
		}

		setTelemetry({
			totalAssets: count,
			totalValuation: valSum,
			avgRating: ratingCount > 0 ? ratingSum / ratingCount : 0,
			lowDeploymentAlerts: lowDep,
			activeCount: active,
			pendingCount: pending,
			inactiveCount: inactive,
		});
	};

	useEffect(() => {
		calculateTelemetry();
		const unsub = grid.api.addEventListener('cellValueChanged', calculateTelemetry);
		return () => unsub();
	}, [grid.api]);

	// Set selected asset row statuses to 'Active'
	const handleBatchActivate = () => {
		if (!selectedRange) {
			alert('Please select a range of cells or rows first.');
			return;
		}

		const startIdx = grid.api.getRowIndexById(selectedRange.start.rowId) ?? -1;
		const endIdx = grid.api.getRowIndexById(selectedRange.end.rowId) ?? -1;
		if (startIdx === -1 || endIdx === -1) return;

		const minRow = Math.min(startIdx, endIdx);
		const maxRow = Math.max(startIdx, endIdx);
		const rowIds: string[] = [];
		for (let i = minRow; i <= maxRow; i++) {
			const node = grid.api.getRowNode(i);
			if (node) rowIds.push(node.id);
		}

		grid.api.startTransaction();

		for (const rowId of rowIds) {
			grid.api.setCellValue(rowId, 'status', 'Active');
		}

		grid.api.endTransaction();
		calculateTelemetry();
	};

	// Increase selected asset row deployments
	const handleBatchBoostProgress = () => {
		if (!selectedRange) {
			alert('Please select a range of cells or rows first.');
			return;
		}

		const startIdx = grid.api.getRowIndexById(selectedRange.start.rowId) ?? -1;
		const endIdx = grid.api.getRowIndexById(selectedRange.end.rowId) ?? -1;
		if (startIdx === -1 || endIdx === -1) return;

		const minRow = Math.min(startIdx, endIdx);
		const maxRow = Math.max(startIdx, endIdx);
		const rowIds: string[] = [];
		for (let i = minRow; i <= maxRow; i++) {
			const node = grid.api.getRowNode(i);
			if (node) rowIds.push(node.id);
		}

		grid.api.startTransaction();

		for (const rowId of rowIds) {
			const rowIndex = grid.api.getRowIndexById(rowId) ?? -1;

			if (rowIndex === -1) continue;

			const row = grid.api.getRow(rowIndex);

			if (!row) continue;

			const curProg = parseFloat(String(row.progress)) || 0;
			const nextProg = Math.min(100, curProg + 10);

			grid.api.setCellValue(rowId, 'progress', nextProg.toString());
		}

		grid.api.endTransaction();
		calculateTelemetry();
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Grid Panel */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-indigo-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<ShieldCheck className='w-4 h-4 text-indigo-400' />
							Enterprise Asset Control Desk (Interactive Slide Editors)
						</span>
					</div>
					<div className='text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono bg-slate-950/60 border border-slate-900 px-2 py-0.5 rounded'>
						High Fidelity Custom Cell Editors
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<GridView
						api={grid.api}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						onCellValueChanged={onCellValueChanged}
						editTrigger={editTrigger}
						arrowKeyNavigationEdit={arrowKeyNavigationEdit}
					/>
				</div>
			</div>

			{/* Right Column: Inventory Analytics Sidebar */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* 1. ASSET ANALYTICS CARD */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<BarChart3 className='w-4 h-4 text-indigo-400' />
						Asset Value & Telemetry
					</h3>

					<div className='grid grid-cols-2 gap-2 mt-1'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5 col-span-2'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Total Value Assets</span>
							<span className='font-mono text-sm font-bold text-emerald-400 text-glow-emerald'>
								${telemetry.totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Total Inventory</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{telemetry.totalAssets} Units</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Average Rating</span>
							<span className='font-mono text-xs font-bold text-amber-400 text-glow-amber flex items-center gap-1'>
								<Star className='w-3.5 h-3.5 fill-amber-400 stroke-none' />
								{telemetry.avgRating.toFixed(2)}
							</span>
						</div>
					</div>

					<div className='border-t border-slate-900/60 pt-3 mt-1 flex flex-col gap-2'>
						<div className='flex items-center justify-between text-[9px] font-bold text-slate-500 uppercase tracking-wider'>
							<span>Low Deployment Alerts</span>
							<span
								className={
									telemetry.lowDeploymentAlerts > 0 ? 'text-rose-400 font-extrabold text-glow-rose animate-pulse' : 'text-slate-500'
								}
							>
								{telemetry.lowDeploymentAlerts} CRITICAL
							</span>
						</div>
						{telemetry.lowDeploymentAlerts > 0 && (
							<div className='flex items-center gap-1.5 bg-rose-950/20 border border-rose-950/60 p-2 rounded text-[9px] text-rose-400 font-medium leading-relaxed'>
								<AlertTriangle className='w-3.5 h-3.5 text-rose-400 shrink-0' />
								<span>
									Attention: {telemetry.lowDeploymentAlerts} assets are currently below 30% deployment. Adjust their progress
									slider!
								</span>
							</div>
						)}
					</div>
				</div>

				{/* 2. OPERATIONAL STATUS TELEMETRY (SVG CHART) */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Gauge className='w-4 h-4 text-purple-400' />
						Lifecycle Operations
					</h3>

					<div className='flex flex-col gap-2.5 mt-1'>
						{/* Active Status bar */}
						<div className='flex flex-col gap-1'>
							<div className='flex justify-between text-[8px] font-mono text-slate-400'>
								<span className='text-emerald-400 font-bold uppercase'>ACTIVE STATE</span>
								<span>{telemetry.activeCount} assets</span>
							</div>
							<div className='w-full bg-slate-950 border border-slate-900 h-2 rounded-full overflow-hidden'>
								<div
									className='h-full bg-emerald-500 rounded-full transition-all duration-500'
									style={{ width: `${(telemetry.activeCount / (telemetry.totalAssets || 1)) * 100}%` }}
								/>
							</div>
						</div>

						{/* Pending Status bar */}
						<div className='flex flex-col gap-1'>
							<div className='flex justify-between text-[8px] font-mono text-slate-400'>
								<span className='text-amber-400 font-bold uppercase'>PENDING REVIEW</span>
								<span>{telemetry.pendingCount} assets</span>
							</div>
							<div className='w-full bg-slate-950 border border-slate-900 h-2 rounded-full overflow-hidden'>
								<div
									className='h-full bg-amber-500 rounded-full transition-all duration-500'
									style={{ width: `${(telemetry.pendingCount / (telemetry.totalAssets || 1)) * 100}%` }}
								/>
							</div>
						</div>

						{/* Inactive Status bar */}
						<div className='flex flex-col gap-1'>
							<div className='flex justify-between text-[8px] font-mono text-slate-400'>
								<span className='text-rose-400 font-bold uppercase'>DECOMMISSIONED</span>
								<span>{telemetry.inactiveCount} assets</span>
							</div>
							<div className='w-full bg-slate-950 border border-slate-900 h-2 rounded-full overflow-hidden'>
								<div
									className='h-full bg-rose-500 rounded-full transition-all duration-500'
									style={{ width: `${(telemetry.inactiveCount / (telemetry.totalAssets || 1)) * 100}%` }}
								/>
							</div>
						</div>
					</div>
				</div>

				{/* 3. BATCH COMMAND CENTER */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Play className='w-4 h-4 text-emerald-400 animate-pulse' />
						Batch Operations Desk
					</h3>

					<div className='flex flex-col gap-2 mt-1'>
						<button
							onClick={handleBatchActivate}
							className='py-2 text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 border border-emerald-950 hover:border-emerald-900 bg-emerald-950/20 hover:bg-emerald-950/40 rounded transition-all text-center flex items-center justify-center gap-1.5'
						>
							Activate Selection Range
						</button>
						<button
							onClick={handleBatchBoostProgress}
							className='py-2 text-[9px] font-extrabold uppercase tracking-wider text-purple-400 border border-purple-950 hover:border-purple-900 bg-purple-950/20 hover:bg-purple-950/40 rounded transition-all text-center flex items-center justify-center gap-1.5'
						>
							Boost Deployment (+10%)
						</button>
					</div>

					<p className='text-[9px] text-slate-500 leading-normal mt-1'>
						Changes commit dynamically to the data controller and trigger state changes down to cellular renderers.
					</p>
				</div>
			</div>
		</div>
	);
}

export default function CustomEditorRenderer({ grid, ...props }: CustomEditorRendererProps) {
	return (
		<GridProvider grid={grid}>
			<CustomEditorRendererInner grid={grid} {...props} />
		</GridProvider>
	);
}
