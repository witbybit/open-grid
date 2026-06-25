import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid, type GridApi } from '@open-grid/react';
import { BookOpen, Calculator, RefreshCw, Sigma, Sparkles, TrendingUp } from 'lucide-react';
import { type SpreadsheetRow } from '../components/GridShared';
import { createSpreadsheetColumns, createSpreadsheetRows } from './demoGridConfigs';

interface SpreadsheetWorkspaceProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	onGridReady?: (api: GridApi<SpreadsheetRow>) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

const NUMERIC_FIELDS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function SpreadsheetWorkspace({
	editTrigger: _editTrigger,
	arrowKeyNavigationEdit: _arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: SpreadsheetWorkspaceProps) {
	const [api, setApi] = useState<GridApi<SpreadsheetRow> | null>(null);
	const [selectionSize, setSelectionSize] = useState(0);
	const [selectionSum, setSelectionSum] = useState(0);

	const rows = useMemo(() => createSpreadsheetRows(), []);
	const columns = useMemo(() => createSpreadsheetColumns(), []);

	useEffect(() => {
		if (!api) return;
		const recalcSelection = () => {
			const { selectedRowIds } = api.selection.getState();
			let sum = 0;
			for (const rowId of selectedRowIds) {
				for (const field of NUMERIC_FIELDS) {
					sum += parseFloat(String(api.cells.getField(rowId, field))) || 0;
				}
			}
			setSelectionSize(selectedRowIds.size);
			setSelectionSum(sum);
		};
		return api.subscribe((event) => {
			if (event.type === 'selection.changed' || event.type === 'cells.changed') recalcSelection();
		});
	}, [api]);

	const selectionAvg = selectionSize > 0 ? selectionSum / (selectionSize * NUMERIC_FIELDS.length) : 0;

	const [cagrInputs, setCagrInputs] = useState({ initial: 100, target: 250, periods: 5 });
	const calculatedCagr = useMemo(() => {
		if (cagrInputs.initial <= 0 || cagrInputs.periods <= 0) return 0;
		return (Math.pow(cagrInputs.target / cagrInputs.initial, 1 / cagrInputs.periods) - 1) * 100;
	}, [cagrInputs]);

	const [compoundInputs, setCompoundInputs] = useState({ principal: 1000, rate: 6, periods: 10 });
	const calculatedCompound = useMemo(
		() => compoundInputs.principal * Math.pow(1 + compoundInputs.rate / 100, compoundInputs.periods),
		[compoundInputs]
	);

	const handleApplyToSelection = useCallback(
		(mapValue: (value: number) => unknown, emptyValue?: unknown) => {
			if (!api) return;
			const { selectedRowIds } = api.selection.getState();
			if (selectedRowIds.size === 0) {
				alert('Please select rows first using click or Shift+Click.');
				return;
			}
			api.rows.update((currentRows) =>
				currentRows.map((row) => {
					if (!selectedRowIds.has(row.id)) return row;
					const nextRow = { ...row };
					for (const field of NUMERIC_FIELDS) {
						(nextRow as any)[field] = emptyValue !== undefined ? emptyValue : mapValue(parseFloat(String((row as any)[field])) || 0);
					}
					return nextRow;
				})
			);
		},
		[api]
	);

	const handleApplyCompoundToSelection = useCallback(() => {
		if (!api) return;
		const { selectedRowIds } = api.selection.getState();
		if (selectedRowIds.size === 0) {
			alert('Please select rows to populate compound projections.');
			return;
		}
		const rowIdArr = Array.from(selectedRowIds);
		api.rows.update((currentRows) =>
			currentRows.map((row) => {
				const idx = rowIdArr.indexOf(row.id as string);
				if (idx === -1) return row;
				const nextRow = { ...row };
				for (const field of NUMERIC_FIELDS) {
					(nextRow as any)[field] = (compoundInputs.principal * Math.pow(1 + compoundInputs.rate / 100, idx + 1)).toFixed(1);
				}
				return nextRow;
			})
		);
	}, [api, compoundInputs.principal, compoundInputs.rate]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-950/80 border border-slate-900 rounded-xl p-2.5 flex items-center gap-3 shrink-0 shadow-lg relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-400 font-mono text-[10px] font-bold tracking-wider shrink-0 flex items-center gap-1.5 min-w-[120px] justify-center'>
						<span className='w-1.5 h-1.5 rounded-full bg-indigo-500' />
						{selectionSize > 0 ? `${selectionSize} rows selected` : 'No Selection'}
					</div>
					<div className='text-xs font-mono font-extrabold italic text-slate-500 border-r border-slate-900 pr-3 select-none flex items-center gap-1 shrink-0'>
						<Sigma className='w-3.5 h-3.5' />
					</div>
					<div className='flex-1 flex items-center gap-2 text-[10px] font-mono text-slate-400'>
						{selectionSize > 0 ? (
							<>
								<span>
									Sum: <span className='text-emerald-400 font-bold'>{selectionSum.toFixed(1)}</span>
								</span>
								<span className='text-slate-700'>·</span>
								<span>
									Avg: <span className='text-indigo-400 font-bold'>{selectionAvg.toFixed(1)}</span>
								</span>
							</>
						) : (
							<span className='text-slate-600'>Select rows to see aggregates</span>
						)}
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
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Sigma className='w-4 h-4 text-indigo-400' />
						Range Analytics & Actions
					</h3>
					<div className='grid grid-cols-3 gap-2 mt-1'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Rows Selected</span>
							<span className='font-mono text-[11px] font-bold text-slate-200'>{selectionSize}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Sum Total</span>
							<span className='font-mono text-[11px] font-bold text-emerald-400'>{selectionSum.toFixed(1)}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Average</span>
							<span className='font-mono text-[11px] font-bold text-indigo-400'>{selectionAvg.toFixed(1)}</span>
						</div>
					</div>
					<div className='border-t border-slate-900/60 pt-3 mt-1 flex flex-col gap-2'>
						<div className='flex gap-2'>
							<button
								onClick={() => alert(`Selection sum: ${selectionSum.toFixed(2)}`)}
								className='flex-1 py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-300 border border-slate-800 hover:border-slate-700 bg-slate-950 hover:bg-slate-900 rounded transition-all flex items-center justify-center gap-1.5'
							>
								Show Sum
							</button>
							<button
								onClick={() => api?.rows.update((r) => r)}
								className='px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 border border-slate-800 hover:border-slate-750 bg-slate-950 hover:bg-slate-900 rounded transition-all flex items-center justify-center'
								title='Recalculate'
							>
								<RefreshCw className='w-3 h-3' />
							</button>
						</div>
						<div className='grid grid-cols-2 gap-2'>
							<button
								onClick={() => handleApplyToSelection((value) => (value * 1.1).toFixed(1))}
								className='py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-indigo-400 border border-indigo-950 hover:border-indigo-900 bg-indigo-950/20 hover:bg-indigo-950/40 rounded transition-all text-center'
							>
								Scale (+10%)
							</button>
							<button
								onClick={() => handleApplyToSelection((v) => v, '')}
								className='py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 border border-slate-900 hover:border-slate-800 bg-slate-950 hover:bg-slate-900 rounded transition-all text-center'
							>
								Clear Values
							</button>
						</div>
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<TrendingUp className='w-4 h-4 text-emerald-400' />
						Compound Vol Forecast Tool
					</h3>
					<div className='flex flex-col gap-2.5 mt-1'>
						<div className='flex flex-col gap-1'>
							<div className='flex justify-between text-[8px] font-extrabold uppercase text-slate-500'>
								<span>Principal ($)</span>
								<span className='font-mono text-slate-350'>${compoundInputs.principal}</span>
							</div>
							<input
								type='range'
								min='100'
								max='10000'
								step='100'
								className='w-full accent-emerald-500 bg-slate-950 h-1 rounded'
								value={compoundInputs.principal}
								onChange={(e) => setCompoundInputs((prev) => ({ ...prev, principal: parseInt(e.target.value) }))}
							/>
						</div>
						<div className='flex flex-col gap-1'>
							<div className='flex justify-between text-[8px] font-extrabold uppercase text-slate-500'>
								<span>Growth Rate (%)</span>
								<span className='font-mono text-emerald-400'>{compoundInputs.rate}%</span>
							</div>
							<input
								type='range'
								min='1'
								max='30'
								step='0.5'
								className='w-full accent-emerald-500 bg-slate-950 h-1 rounded'
								value={compoundInputs.rate}
								onChange={(e) => setCompoundInputs((prev) => ({ ...prev, rate: parseFloat(e.target.value) }))}
							/>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex items-center justify-between mt-1'>
							<div className='flex flex-col'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Future Yield (10 periods)</span>
								<span className='font-mono text-xs font-bold text-slate-200'>${calculatedCompound.toFixed(2)}</span>
							</div>
							<Sparkles className='w-5 h-5 text-emerald-400 animate-pulse' />
						</div>
						<button
							onClick={handleApplyCompoundToSelection}
							className='py-2 text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 border border-emerald-950 hover:border-emerald-900 bg-emerald-950/20 hover:bg-emerald-950/40 rounded transition-all text-center mt-1 flex items-center justify-center gap-1.5'
						>
							Apply Projection to Selection
						</button>
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Calculator className='w-4 h-4 text-purple-400' />
						CAGR Quant Module
					</h3>
					<div className='flex flex-col gap-2.5 mt-1'>
						<div className='grid grid-cols-2 gap-2'>
							<div className='flex flex-col gap-1'>
								<span className='text-[8px] font-extrabold uppercase text-slate-500'>Initial Value</span>
								<input
									type='number'
									className='bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-slate-200 font-mono text-xs outline-none'
									value={cagrInputs.initial}
									onChange={(e) => setCagrInputs((prev) => ({ ...prev, initial: parseFloat(e.target.value) || 0 }))}
								/>
							</div>
							<div className='flex flex-col gap-1'>
								<span className='text-[8px] font-extrabold uppercase text-slate-500'>Target Value</span>
								<input
									type='number'
									className='bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-slate-200 font-mono text-xs outline-none'
									value={cagrInputs.target}
									onChange={(e) => setCagrInputs((prev) => ({ ...prev, target: parseFloat(e.target.value) || 0 }))}
								/>
							</div>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex items-center justify-between'>
							<div className='flex flex-col'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Required CAGR (5 periods)</span>
								<span className='font-mono text-xs font-bold text-purple-400'>{calculatedCagr.toFixed(2)}%</span>
							</div>
							<BookOpen className='w-5 h-5 text-purple-400' />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
