import React, { useState, useEffect, useMemo } from 'react';
import { GridProvider, useClientGrid } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';
import { Activity, ShieldAlert, BadgePercent, TrendingUp, Layers } from 'lucide-react';

type ClientGrid = ReturnType<typeof useClientGrid<PerformanceRow>>;
interface CalculationsArenaProps {
	grid: ClientGrid;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CalculationsArena({
	grid,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: CalculationsArenaProps) {
	const [telemetry, setTelemetry] = useState({
		totalContracts: 0,
		avgVol: 0,
		sumDelta: 0,
		maxGamma: 0,
		avgVega: 0,
		highRiskCount: 0,
	});

	// Register premium style slots for Option Greeks & Risk
	useEffect(() => {
		grid.api.setState({
			styleSlots: {
				rowClass: (row) => {
					const r = row as PerformanceRow;
					if (!r) return '';
					let base = 'transition-all duration-200 border-l-2 ';
					if (r.status === 'Inactive') {
						return base + 'border-rose-500/80 bg-rose-950/5 hover:bg-rose-900/10 text-rose-200/90';
					}
					if (r.status === 'Pending') {
						return base + 'border-amber-500/60 bg-amber-950/5 hover:bg-amber-900/10 text-amber-200/90';
					}
					return base + 'border-emerald-500/40 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-200/90';
				},
				cellClass: (col, row) => {
					const r = row as PerformanceRow;
					if (!r) return '';
					if (col.field === 'delta') {
						const vol = parseFloat(r.quantity) || 20;
						const strike = parseFloat(r.price) || 100;
						const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
						const delta = 0.5 + 0.5 * Math.tanh(d1);
						if (delta > 0.8) return 'text-emerald-400 font-extrabold font-mono';
						if (delta < 0.2) return 'text-rose-400 font-extrabold font-mono';
					}
					if (col.field === 'status') {
						if (r.status === 'Inactive') return 'text-rose-400 font-bold animate-pulse';
						if (r.status === 'Pending') return 'text-amber-400 font-bold';
						return 'text-emerald-400 font-bold';
					}
					return '';
				},
				headerCellClass: (col) => {
					if (['delta', 'gamma', 'vega', 'theta'].includes(col.field)) {
						return 'text-purple-350 font-extrabold bg-purple-950/10 border-b border-purple-900/20';
					}
					return 'font-semibold text-slate-400';
				},
			},
		});
	}, [grid.api]);

	useEffect(() => {
		const calculateTelemetry = () => {
			const count = grid.api.getRowCount();
			let volSum = 0;
			let deltaSum = 0;
			let maxG = 0;
			let vegaSum = 0;
			let highRisk = 0;

			for (let i = 0; i < count; i++) {
				const r = grid.api.getRow(i);
				if (r) {
					const vol = parseFloat(r.quantity) || 0;
					volSum += vol;

					// Compute Delta approximation inline for telemetry matching the valueGetter
					const strike = parseFloat(r.price) || 100;
					const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
					const delta = 0.5 + 0.5 * Math.tanh(d1);
					deltaSum += delta;

					// Compute Gamma approximation
					const gamma = Math.exp((-d1 * d1) / 2) / (100 * (vol / 100) * Math.sqrt(2 * Math.PI));
					if (gamma > maxG) maxG = gamma;

					// Compute Vega
					const vega = (100 * Math.exp((-d1 * d1) / 2)) / Math.sqrt(2 * Math.PI);
					vegaSum += vega / 100;

					if (r.status === 'Inactive') {
						// Represents 'HIGH' risk in our valueGetter
						highRisk++;
					}
				}
			}

			setTelemetry({
				totalContracts: count,
				avgVol: count > 0 ? volSum / count : 0,
				sumDelta: deltaSum,
				maxGamma: maxG,
				avgVega: count > 0 ? vegaSum / count : 0,
				highRiskCount: highRisk,
			});
		};

		// Initial load
		calculateTelemetry();

		// Subscribe to changes in the active grid values
		const unsubValue = grid.api.addEventListener('cellValueChanged', calculateTelemetry);
		return () => unsubValue();
	}, [grid.api]);

	// Visual stress metrics
	const stressScore = useMemo(() => {
		const ratio = telemetry.totalContracts > 0 ? telemetry.highRiskCount / telemetry.totalContracts : 0;
		return Math.min(100, Math.round(ratio * 300)); // normalized stress indicator
	}, [telemetry]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Grid Panel */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-emerald-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-purple-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>Real-Time Option Risk Grid</span>
					</div>
					<div className='text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono bg-slate-950/60 border border-slate-900 px-2 py-0.5 rounded'>
						O(1) Greeks Recalculator
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<GridProvider grid={grid}>
						<GridView
							api={grid.api}
							pinLeftColumns={pinLeftColumns}
							pinRightColumns={pinRightColumns}
							onCellValueChanged={onCellValueChanged}
							editTrigger={editTrigger}
							arrowKeyNavigationEdit={arrowKeyNavigationEdit}
						/>
					</GridProvider>
				</div>
			</div>

			{/* Right Column: Option Telemetry Sidebar */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* 1. SELECTION RISK ANALYTICS */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<ShieldAlert className='w-4 h-4 text-purple-400' />
						Greeks Risk Telemetry Hub
					</h3>

					<div className='grid grid-cols-2 gap-2 mt-1'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[9px] text-slate-500 uppercase tracking-wider font-extrabold'>Total Contracts</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{telemetry.totalContracts.toLocaleString()}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[9px] text-slate-500 uppercase tracking-wider font-extrabold'>High Risk Alerts</span>
							<span className='font-mono text-xs font-bold text-rose-400 text-glow-rose'>{telemetry.highRiskCount}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[9px] text-slate-500 uppercase tracking-wider font-extrabold'>Delta Drift (Σ)</span>
							<span className='font-mono text-xs font-bold text-emerald-400 text-glow-emerald'>+{telemetry.sumDelta.toFixed(2)}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[9px] text-slate-500 uppercase tracking-wider font-extrabold'>Avg Volatility</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{telemetry.avgVol.toFixed(1)}%</span>
						</div>
					</div>

					<div className='border-t border-slate-900/60 pt-3 mt-1 flex flex-col gap-2'>
						<div className='flex items-center justify-between text-[9px] font-bold text-slate-500 uppercase tracking-wider'>
							<span>Stress Index Meter</span>
							<span className={stressScore > 50 ? 'text-rose-400' : 'text-emerald-400'}>{stressScore}% LOAD</span>
						</div>
						<div className='w-full bg-slate-950 border border-slate-900 rounded-full h-2 overflow-hidden relative'>
							<div
								className={`h-full rounded-full transition-all duration-500 ${stressScore > 60 ? 'bg-rose-500' : stressScore > 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
								style={{ width: `${stressScore}%` }}
							/>
						</div>
					</div>
				</div>

				{/* 2. DYNAMIC GREEKS METER (SVG RADAR) */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative items-center justify-center text-center'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 self-start w-full text-left'>
						<Activity className='w-4 h-4 text-emerald-400' />
						Options System Volatility
					</h3>

					<div className='relative w-36 h-36 flex items-center justify-center mt-1'>
						{/* Rotational glow ring */}
						<div className='absolute inset-0 rounded-full border border-dashed border-emerald-500/25 animate-spin-slow' />
						<div className='absolute w-28 h-28 rounded-full border border-slate-900 bg-slate-950/60 flex flex-col items-center justify-center gap-0.5 shadow-inner'>
							<BadgePercent className='w-5 h-5 text-emerald-400 animate-bounce' />
							<span className='font-mono text-xs font-bold text-slate-200'>{telemetry.avgVega.toFixed(4)}</span>
							<span className='text-[8px] text-slate-500 font-extrabold uppercase tracking-wider'>Vega Weight</span>
						</div>
					</div>

					<p className='text-[9px] text-slate-500 leading-relaxed font-medium mt-1'>
						This Greeks stress-testing hub dynamically updates from cell changes using sibling evaluation mechanisms.
					</p>
				</div>
			</div>
		</div>
	);
}
