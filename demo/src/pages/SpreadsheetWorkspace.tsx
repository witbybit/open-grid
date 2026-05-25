import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GridProvider, useClientGrid, useGridKeySelector } from '@open-grid/react';
import { SpreadsheetRow, GridView } from '../components/GridShared';
import { Calculator, Sparkles, TrendingUp, Layers, BookOpen, Sigma, RefreshCw } from 'lucide-react';

type ClientGrid = ReturnType<typeof useClientGrid<SpreadsheetRow>>;

interface SpreadsheetWorkspaceProps {
	grid: ClientGrid;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

// Inner component that can safely use useGridKeySelector
function SpreadsheetWorkspaceInner({
	grid,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: SpreadsheetWorkspaceProps) {
	const store = grid.store;
	const focusedCell = useGridKeySelector('focusedCell', (state) => state.focusedCell);
	const selectedRange = useGridKeySelector('selectedRange', (state) => state.selectedRange);

	const [formulaText, setFormulaText] = useState('');
	const isEditingRef = useRef(false);

	// Sync formula bar text with focused cell value
	useEffect(() => {
		if (focusedCell && !isEditingRef.current) {
			const cellValue = store.getCellValue(focusedCell.rowId, focusedCell.colField) ?? '';
			setFormulaText(String(cellValue));
		} else if (!focusedCell) {
			setFormulaText('');
		}
	}, [focusedCell, store]);

	// Listen to cell value changes to keep formula bar in sync if active cell changes externally
	useEffect(() => {
		const handleCellChanged = (event: any) => {
			const { rowId, colField, val } = event.detail || {};
			if (focusedCell && focusedCell.rowId === rowId && focusedCell.colField === colField) {
				if (!isEditingRef.current) {
					setFormulaText(String(val ?? ''));
				}
			}
		};
		const unsub = store.addEventListener('cellValueChanged' as any, handleCellChanged);
		return () => unsub();
	}, [store, focusedCell]);

	const handleCommitFormula = () => {
		if (focusedCell) {
			onCellValueChanged(focusedCell.rowId, focusedCell.colField, formulaText);
			isEditingRef.current = false;
		}
	};

	// Quantitative telemetry calculators
	const [cagrInputs, setCagrInputs] = useState({ initial: 100, target: 250, periods: 5 });
	const calculatedCagr = useMemo(() => {
		if (cagrInputs.initial <= 0 || cagrInputs.periods <= 0) return 0;
		return (Math.pow(cagrInputs.target / cagrInputs.initial, 1 / cagrInputs.periods) - 1) * 100;
	}, [cagrInputs]);

	const [compoundInputs, setCompoundInputs] = useState({ principal: 1000, rate: 6, periods: 10 });
	const calculatedCompound = useMemo(() => {
		return compoundInputs.principal * Math.pow(1 + compoundInputs.rate / 100, compoundInputs.periods);
	}, [compoundInputs]);

	// Compute selection range telemetry
	const rangeTelemetry = useMemo(() => {
		if (!selectedRange) return { count: 0, sum: 0, avg: 0 };
		const startIdx = grid.api.getRowIndexById(selectedRange.start.rowId) ?? -1;
		const endIdx = grid.api.getRowIndexById(selectedRange.end.rowId) ?? -1;
		const state = store.getState();
		const startColIdx = state.columns.findIndex((c) => c.field === selectedRange.start.colField);
		const endColIdx = state.columns.findIndex((c) => c.field === selectedRange.end.colField);

		if (startIdx === -1 || endIdx === -1 || startColIdx === -1 || endColIdx === -1) {
			return { count: 0, sum: 0, avg: 0 };
		}

		const minRow = Math.min(startIdx, endIdx);
		const maxRow = Math.max(startIdx, endIdx);
		const minCol = Math.min(startColIdx, endColIdx);
		const maxCol = Math.max(startColIdx, endColIdx);

		let count = 0;
		let sum = 0;

		for (let r = minRow; r <= maxRow; r++) {
			const node = grid.api.getRowNode(r);
			if (node) {
				for (let c = minCol; c <= maxCol; c++) {
					const field = state.columns[c].field;
					if (field === 'id') continue;
					const val = parseFloat(String(store.getCellValue(node.id, field))) || 0;
					sum += val;
					count++;
				}
			}
		}

		return {
			count,
			sum,
			avg: count > 0 ? sum / count : 0,
		};
	}, [selectedRange, store]);

	// Apply CAGR variables or Compound outcomes to selected cells
	const handleApplyCompoundToSelection = () => {
		if (!selectedRange) {
			alert('Please select a range of cells to populate compound projections.');
			return;
		}

		const startIdx = grid.api.getRowIndexById(selectedRange.start.rowId) ?? -1;
		const endIdx = grid.api.getRowIndexById(selectedRange.end.rowId) ?? -1;
		const state = store.getState();
		const startColIdx = state.columns.findIndex((c) => c.field === selectedRange.start.colField);
		const endColIdx = state.columns.findIndex((c) => c.field === selectedRange.end.colField);

		if (startIdx === -1 || endIdx === -1 || startColIdx === -1 || endColIdx === -1) return;

		const minRow = Math.min(startIdx, endIdx);
		const maxRow = Math.max(startIdx, endIdx);
		const minCol = Math.min(startColIdx, endColIdx);
		const maxCol = Math.max(startColIdx, endColIdx);

		const cols = state.columns.slice(minCol, maxCol + 1).map((c) => c.field);
		const rowIds: string[] = [];
		for (let i = minRow; i <= maxRow; i++) {
			const node = grid.api.getRowNode(i);
			if (node) rowIds.push(node.id);
		}

		grid.api.updateRows((rows) => {
			return rows.map((row) => {
				if (rowIds.includes(row.id)) {
					const updated = { ...row };
					cols.forEach((field) => {
						if (field === 'id') return;
						const idx = rowIds.indexOf(row.id);
						// Project compounded future value per cell in the sequence
						const projected = compoundInputs.principal * Math.pow(1 + compoundInputs.rate / 100, idx + 1);
						(updated as any)[field] = projected.toFixed(1);
					});
					return updated;
				}
				return row;
			});
		});
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Grid Panel */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				{/* Professional Formula Bar */}
				<div className='bg-slate-950/80 border border-slate-900 rounded-xl p-2.5 flex items-center gap-3 shrink-0 shadow-lg relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none' />

					{/* Active Cell Address Indicator */}
					<div className='bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-400 font-mono text-[10px] font-bold tracking-wider shrink-0 flex items-center gap-1.5 min-w-[100px] justify-center'>
						<span className='w-1.5 h-1.5 rounded-full bg-indigo-500' />
						{focusedCell ? `${focusedCell.rowId}:${focusedCell.colField}` : 'NO FOCUS'}
					</div>

					{/* Fx Symbol Badge */}
					<div className='text-xs font-mono font-extrabold italic text-slate-500 border-r border-slate-900 pr-3 select-none flex items-center gap-1 shrink-0'>
						<span>f</span>
						<span>x</span>
					</div>

					{/* Formula / Value Text Input */}
					<div className='flex-1 flex items-center gap-2'>
						<input
							type='text'
							className='w-full bg-slate-900/50 hover:bg-slate-900/80 focus:bg-slate-950 border border-slate-850 hover:border-slate-800 focus:border-indigo-500 rounded px-3 py-1 text-slate-200 font-mono text-xs outline-none transition-all duration-200'
							placeholder={
								focusedCell ? 'Enter value, equation, or formula, e.g. =SUM([S-1001:A],-[S-1001:B])' : 'Select a cell to enter values'
							}
							disabled={!focusedCell}
							value={formulaText}
							onChange={(e) => {
								isEditingRef.current = true;
								setFormulaText(e.target.value);
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter') handleCommitFormula();
								if (e.key === 'Escape') {
									isEditingRef.current = false;
									if (focusedCell) {
										setFormulaText(String(store.getCellValue(focusedCell.rowId, focusedCell.colField) ?? ''));
									}
								}
							}}
							onBlur={handleCommitFormula}
						/>
						{focusedCell && formulaText !== String(store.getCellValue(focusedCell.rowId, focusedCell.colField) ?? '') && (
							<button
								onClick={handleCommitFormula}
								className='px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider text-indigo-400 border border-indigo-500/30 hover:border-indigo-500 hover:text-white rounded bg-indigo-950/20 hover:bg-indigo-900/30 transition-all shrink-0'
							>
								Commit
							</button>
						)}
					</div>
				</div>

				{/* Grid Container */}
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

			{/* Right Column: Quantitative Sidebar */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* 1. SELECTION & RANGE ACTIONS */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Sigma className='w-4 h-4 text-indigo-400' />
						Range Analytics & Actions
					</h3>

					{/* Selected stats */}
					<div className='grid grid-cols-3 gap-2 mt-1'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Cell Count</span>
							<span className='font-mono text-[11px] font-bold text-slate-200'>{rangeTelemetry.count}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Sum Total</span>
							<span className='font-mono text-[11px] font-bold text-emerald-400 text-glow-emerald'>
								{rangeTelemetry.sum.toFixed(1)}
							</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Average</span>
							<span className='font-mono text-[11px] font-bold text-indigo-400 text-glow-indigo'>{rangeTelemetry.avg.toFixed(1)}</span>
						</div>
					</div>

					{/* Action Buttons */}
					<div className='border-t border-slate-900/60 pt-3 mt-1 flex flex-col gap-2'>
						<div className='flex gap-2'>
							<button
								onClick={() => store.dispatchEvent('sum' as any, null)} // Handled by useShowroomStores wrapper action
								className='flex-1 py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-300 border border-slate-800 hover:border-slate-700 bg-slate-950 hover:bg-slate-900 rounded transition-all flex items-center justify-center gap-1.5'
							>
								Range Sum
							</button>
							<button
								onClick={() => grid.api.updateRows((rows) => rows)} // Force calculation refresh
								className='px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 border border-slate-800 hover:border-slate-750 bg-slate-950 hover:bg-slate-900 rounded transition-all flex items-center justify-center'
								title='Recalculate Formulas'
							>
								<RefreshCw className='w-3 h-3' />
							</button>
						</div>

						<div className='grid grid-cols-2 gap-2'>
							<button
								onClick={() => {
									const action = 'addPercent';
									const state = store.getState();
									const range = state.selectedRange;
									if (range) {
										// Trigger store logic directly via props
										{
											const startIdx = grid.api.getRowIndexById(range.start.rowId) ?? -1;
											const endIdx = grid.api.getRowIndexById(range.end.rowId) ?? -1;
											const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
											const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);
											if (startIdx !== -1 && endIdx !== -1 && startColIdx !== -1 && endColIdx !== -1) {
												const minRow = Math.min(startIdx, endIdx);
												const maxRow = Math.max(startIdx, endIdx);
												const minCol = Math.min(startColIdx, endColIdx);
												const maxCol = Math.max(startColIdx, endColIdx);
												const colsToModify = state.columns.slice(minCol, maxCol + 1).map((c) => c.field);
												const rowIds: string[] = [];
												for (let i = minRow; i <= maxRow; i++) {
													const node = grid.api.getRowNode(i);
													if (node) rowIds.push(node.id);
												}
												grid.api.updateRows((rows) => {
													return rows.map((row) => {
														if (rowIds.includes(row.id)) {
															let nextRow = { ...row };
															for (const colField of colsToModify) {
																if (colField === 'id') continue;
																const valNum = parseFloat((row as any)[colField]) || 0;
																(nextRow as any)[colField] = (valNum * 1.1).toFixed(1);
															}
															return nextRow;
														}
														return row;
													});
												});
											}
										}
									} else {
										alert('Please select a range of cells first.');
									}
								}}
								className='py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-indigo-400 border border-indigo-950 hover:border-indigo-900 bg-indigo-950/20 hover:bg-indigo-950/40 rounded transition-all text-center'
							>
								Scale Selection (+10%)
							</button>
							<button
								onClick={() => {
									const state = store.getState();
									const range = state.selectedRange;
									if (range) {
										{
											const startIdx = grid.api.getRowIndexById(range.start.rowId) ?? -1;
											const endIdx = grid.api.getRowIndexById(range.end.rowId) ?? -1;
											const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
											const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);
											if (startIdx !== -1 && endIdx !== -1 && startColIdx !== -1 && endColIdx !== -1) {
												const minRow = Math.min(startIdx, endIdx);
												const maxRow = Math.max(startIdx, endIdx);
												const minCol = Math.min(startColIdx, endColIdx);
												const maxCol = Math.max(startColIdx, endColIdx);
												const colsToModify = state.columns.slice(minCol, maxCol + 1).map((c) => c.field);
												const rowIds: string[] = [];
												for (let i = minRow; i <= maxRow; i++) {
													const node = grid.api.getRowNode(i);
													if (node) rowIds.push(node.id);
												}
												grid.api.updateRows((rows) => {
													return rows.map((row) => {
														if (rowIds.includes(row.id)) {
															let nextRow = { ...row };
															for (const colField of colsToModify) {
																if (colField === 'id') continue;
																(nextRow as any)[colField] = '';
															}
															return nextRow;
														}
														return row;
													});
												});
											}
										}
									} else {
										alert('Please select a range of cells first.');
									}
								}}
								className='py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 border border-slate-900 hover:border-slate-800 bg-slate-950 hover:bg-slate-900 rounded transition-all text-center'
							>
								Clear Selection
							</button>
						</div>
					</div>
				</div>

				{/* 2. COMPOUND INTEREST FORECAST TOOLBOARD */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<TrendingUp className='w-4 h-4 text-emerald-400' />
						Compound Vol Forecast Tool
					</h3>

					<div className='flex flex-col gap-2.5 mt-1'>
						{/* Principal slider */}
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
								onChange={(e) => setCompoundInputs((p) => ({ ...p, principal: parseInt(e.target.value) }))}
							/>
						</div>

						{/* Rate slider */}
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
								onChange={(e) => setCompoundInputs((p) => ({ ...p, rate: parseFloat(e.target.value) }))}
							/>
						</div>

						{/* Future Yield output */}
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
							Apply Projection Sequence
						</button>
					</div>
				</div>

				{/* 3. CAGR CALCULATOR */}
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
									onChange={(e) => setCagrInputs((p) => ({ ...p, initial: parseFloat(e.target.value) || 0 }))}
								/>
							</div>
							<div className='flex flex-col gap-1'>
								<span className='text-[8px] font-extrabold uppercase text-slate-500'>Target Value</span>
								<input
									type='number'
									className='bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-slate-200 font-mono text-xs outline-none'
									value={cagrInputs.target}
									onChange={(e) => setCagrInputs((p) => ({ ...p, target: parseFloat(e.target.value) || 0 }))}
								/>
							</div>
						</div>

						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex items-center justify-between'>
							<div className='flex flex-col'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Required CAGR (5 periods)</span>
								<span className='font-mono text-xs font-bold text-purple-400 text-glow-purple'>{calculatedCagr.toFixed(2)}%</span>
							</div>
							<BookOpen className='w-5 h-5 text-purple-400' />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

// Main exported wrapper to provide GridProvider context
export default function SpreadsheetWorkspace({ grid, ...props }: SpreadsheetWorkspaceProps) {
	return (
		<GridProvider grid={grid}>
			<SpreadsheetWorkspaceInner grid={grid} {...props} />
		</GridProvider>
	);
}
