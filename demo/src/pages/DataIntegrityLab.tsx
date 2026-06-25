/**
 * Data Integrity Lab
 *
 * Demonstrates the four integrity pipeline stages:
 *   1. Quality  — client-side row validation rules
 *   2. Diff     — compare two snapshots
 *   3. Stream   — simulated live price feed via applyTransaction
 *   4. Conflicts — injected conflict markers (stubbed)
 *
 * NOTE: The advanced kernel-level features (setDiffModel, createStream,
 * publishIssues) are not yet surfaced in GridApi. Each stage is implemented
 * with the available new API and the activity log documents what would change
 * once those kernel primitives are exposed.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Grid } from '@open-grid/react';
import type { ColumnDef, GridApi } from '@open-grid/react';

// ── Data model ────────────────────────────────────────────────────────────────

interface TradeRow {
	id: string;
	symbol: string;
	trader: string;
	quantity: number;
	price: number;
	notional: number;
	status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';
	desk: string;
	venue: string;
}

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM'];
const TRADERS = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];
const DESKS = ['Equity', 'Fixed Income', 'Derivatives', 'FX'];
const VENUES = ['NYSE', 'NASDAQ', 'CBOE', 'LSE'];
const STATUSES: TradeRow['status'][] = ['OPEN', 'FILLED', 'CANCELLED', 'REJECTED'];

function makeRow(i: number): TradeRow {
	const symbol = SYMBOLS[i % SYMBOLS.length];
	const qty = 100 + ((i * 37) % 900);
	const price = parseFloat((50 + ((i * 13) % 400)).toFixed(2));
	return {
		id: `T${String(i + 1).padStart(4, '0')}`,
		symbol,
		trader: TRADERS[i % TRADERS.length],
		quantity: qty,
		price,
		notional: qty * price,
		status: STATUSES[i % STATUSES.length],
		desk: DESKS[i % DESKS.length],
		venue: VENUES[i % VENUES.length],
	};
}

const BASE_ROWS: TradeRow[] = Array.from({ length: 30 }, (_, i) => makeRow(i));

// ── Client-side quality check ─────────────────────────────────────────────────

interface QualityIssue {
	rowId: string;
	colField: string;
	severity: 'error' | 'warning';
	message: string;
}

function runQualityCheck(rows: TradeRow[]): QualityIssue[] {
	const issues: QualityIssue[] = [];
	const symbolCounts: Record<string, number> = {};
	for (const r of rows) symbolCounts[r.symbol] = (symbolCounts[r.symbol] ?? 0) + 1;

	for (const row of rows) {
		if (symbolCounts[row.symbol] > 1) {
			issues.push({ rowId: row.id, colField: 'symbol', severity: 'warning', message: `Duplicate symbol: ${row.symbol}` });
		}
		if (row.notional < 5_000 || row.notional > 500_000) {
			issues.push({
				rowId: row.id,
				colField: 'notional',
				severity: 'error',
				message: `Notional $${row.notional.toLocaleString()} outside [$5k–$500k]`,
			});
		}
		if (row.quantity <= 0) {
			issues.push({ rowId: row.id, colField: 'quantity', severity: 'error', message: `Quantity must be positive` });
		}
		if (row.price <= 0) {
			issues.push({ rowId: row.id, colField: 'price', severity: 'error', message: `Price must be positive` });
		}
	}
	return issues;
}

// ── Columns ───────────────────────────────────────────────────────────────────

function StatusRenderer({ value }: { value: unknown }) {
	const color: Record<string, string> = {
		OPEN: '#22c55e',
		FILLED: '#6366f1',
		CANCELLED: '#f59e0b',
		REJECTED: '#ef4444',
	};
	const v = String(value ?? '');
	return (
		<span
			style={{
				fontSize: 10,
				fontWeight: 700,
				padding: '2px 7px',
				borderRadius: 4,
				background: `${color[v] ?? '#6b7280'}22`,
				color: color[v] ?? '#6b7280',
			}}
		>
			{v}
		</span>
	);
}

const COLUMNS: ColumnDef<TradeRow>[] = [
	{ field: 'id', header: 'Trade ID', width: 90 },
	{ field: 'symbol', header: 'Symbol', width: 80 },
	{ field: 'trader', header: 'Trader', width: 90 },
	{ field: 'desk', header: 'Desk', width: 100 },
	{ field: 'venue', header: 'Venue', width: 80 },
	{ field: 'quantity', header: 'Qty', width: 80, type: 'number' },
	{
		field: 'price',
		header: 'Price',
		width: 90,
		type: 'number',
		valueFormatter: (p) => (p.value != null ? `$${Number(p.value).toFixed(2)}` : ''),
	},
	{
		field: 'notional',
		header: 'Notional',
		width: 110,
		type: 'number',
		valueFormatter: (p) => (p.value != null ? `$${Number(p.value).toLocaleString()}` : ''),
	},
	{ field: 'status', header: 'Status', width: 95, renderer: { kind: 'react', component: StatusRenderer } },
];

// ── Panel button ──────────────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'amber' | 'green' | 'red' | 'indigo' | 'ghost';

function Btn({
	children,
	onClick,
	variant = 'ghost',
	disabled,
}: {
	children: React.ReactNode;
	onClick?: () => void;
	variant?: BtnVariant;
	disabled?: boolean;
}) {
	const colors: Record<BtnVariant, string> = {
		primary: 'bg-purple-600/20 border-purple-500/40 text-purple-300 hover:bg-purple-600/30',
		amber: 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30',
		green: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30',
		red: 'bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30',
		indigo: 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30',
		ghost: 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60',
	};
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition-all ${colors[variant]} disabled:opacity-40 disabled:cursor-not-allowed`}
		>
			{children}
		</button>
	);
}

// ── Stage badge ───────────────────────────────────────────────────────────────

function StageBadge({ label, active, done }: { label: string; active: boolean; done: boolean }) {
	return (
		<div
			className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition-all ${
				done
					? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
					: active
						? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
						: 'border-slate-800 bg-slate-900/20 text-slate-600'
			}`}
		>
			{done ? '✓' : active ? '◉' : '○'} {label}
		</div>
	);
}

// ── Main component ────────────────────────────────────────────────────────────

type Stage = 'quality' | 'diff' | 'stream' | 'conflict';

interface Props {
	onGridReady?: (api: GridApi<TradeRow>) => void;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function DataIntegrityLab({ onGridReady: onGridReadyProp, pinLeftColumns, pinRightColumns }: Props) {
	const apiRef = useRef<GridApi<TradeRow> | null>(null);
	const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [activeStage, setActiveStage] = useState<Stage>('quality');
	const [log, setLog] = useState<string[]>([]);
	const [qualityIssues, setQualityIssues] = useState<QualityIssue[] | null>(null);
	const [diffActive, setDiffActive] = useState(false);
	const [streamRunning, setStreamRunning] = useState(false);
	const [conflictCount, setConflictCount] = useState(0);

	function addLog(msg: string) {
		setLog((prev) => [`[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ${msg}`, ...prev].slice(0, 40));
	}

	const handleGridReady = useCallback(
		(api: GridApi<TradeRow>) => {
			apiRef.current = api;
			onGridReadyProp?.(api);
			addLog('Grid ready — 30 trade rows loaded');
		},
		[onGridReadyProp]
	);

	// ── Stage 1: Data Quality ─────────────────────────────────────────────────

	function handleRunQuality() {
		const api = apiRef.current;
		if (!api) return;
		addLog('Running client-side quality check…');
		const rows = api.rows.getAll();
		const issues = runQualityCheck(rows);
		setQualityIssues(issues);
		const errors = issues.filter((i) => i.severity === 'error').length;
		const warnings = issues.filter((i) => i.severity === 'warning').length;
		addLog(`Quality: ${issues.length} issues found (${errors} errors, ${warnings} warnings)`);
	}

	function handleClearQuality() {
		setQualityIssues(null);
		addLog('Quality report cleared');
	}

	// ── Stage 2: Data Diff ────────────────────────────────────────────────────

	function handleActivateDiff() {
		setDiffActive(true);
		addLog('Diff: comparing live rows vs EOD snapshot — kernel diff overlay pending kernel API exposure');
		addLog('NOTE: api.integrity.setDiffModel() not yet in GridApi — showing structural diff in log only');
		// Show which rows differ between BASE_ROWS and the compare set
		const compareIds = new Set(BASE_ROWS.filter((_, i) => i !== 3).map((r) => r.id));
		const removedRows = BASE_ROWS.filter((r) => !compareIds.has(r.id));
		addLog(`Structural diff: ${removedRows.length} removed row(s) — ${removedRows.map((r) => r.id).join(', ')}`);
		const changedCount = Math.floor(BASE_ROWS.length / 5) + Math.floor(BASE_ROWS.length / 7);
		addLog(`Structural diff: ~${changedCount} rows have price or status changes`);
	}

	function handleClearDiff() {
		setDiffActive(false);
		addLog('Diff cleared');
	}

	// ── Stage 3: Live Stream ──────────────────────────────────────────────────

	function scheduleStreamTick(api: GridApi<TradeRow>, tickRef: { n: number }) {
		if (!streamTimerRef.current) return;
		const n = 2 + (tickRef.n % 3);
		const updates: Array<{ id: string; price: number; notional: number }> = Array.from({ length: n }, (_, j) => {
			const row = BASE_ROWS[(tickRef.n * 7 + j * 13) % BASE_ROWS.length];
			const newPrice = parseFloat((row.price * (0.985 + ((tickRef.n + j) % 30) * 0.001)).toFixed(2));
			return { ...row, price: newPrice, notional: row.quantity * newPrice };
		});
		api.rows.applyTransaction({ update: updates });
		addLog(`Stream tick #${tickRef.n}: ${n} price update(s) — ${updates.map((u) => `${u.id}=$${u.price}`).join(', ')}`);
		tickRef.n++;
		streamTimerRef.current = setTimeout(() => scheduleStreamTick(api, tickRef), 800);
	}

	function handleStartStream() {
		const api = apiRef.current;
		if (!api || streamRunning) return;
		setStreamRunning(true);
		addLog('Live price feed started via api.rows.applyTransaction (cell flash requires kernel createStream)');
		const tickRef = { n: 0 };
		streamTimerRef.current = setTimeout(() => scheduleStreamTick(api, tickRef), 800);
	}

	function handleStopStream() {
		if (streamTimerRef.current) {
			clearTimeout(streamTimerRef.current);
			streamTimerRef.current = null;
		}
		setStreamRunning(false);
		addLog('Live price feed stopped');
	}

	// ── Stage 4: Conflicts ────────────────────────────────────────────────────

	function handleInjectConflicts() {
		setConflictCount(3);
		addLog('Conflict injection: api.integrity.publishIssues() not yet in GridApi');
		addLog('Would inject 3 conflicts: T0001.price, T0003.status, T0007.quantity');
		addLog('Conflict striping requires kernel-level publishIssues — logged for now');
	}

	function handleResolveAll() {
		setConflictCount(0);
		addLog('Conflicts cleared (api.integrity.clearIssues() pending kernel API exposure)');
	}

	// ── Cleanup ───────────────────────────────────────────────────────────────

	useEffect(() => {
		return () => {
			if (streamTimerRef.current) {
				clearTimeout(streamTimerRef.current);
				streamTimerRef.current = null;
			}
		};
	}, []);

	const stages: { id: Stage; label: string }[] = [
		{ id: 'quality', label: '1 · Quality' },
		{ id: 'diff', label: '2 · Diff' },
		{ id: 'stream', label: '3 · Stream' },
		{ id: 'conflict', label: '4 · Conflicts' },
	];

	const stageDone: Record<Stage, boolean> = {
		quality: qualityIssues !== null,
		diff: diffActive,
		stream: streamRunning,
		conflict: false,
	};

	return (
		<div className='flex h-full min-h-0 flex-col gap-3 overflow-hidden'>
			{/* Top control strip */}
			<div className='flex flex-col gap-2 rounded-xl border border-slate-800/60 bg-slate-900/30 p-3'>
				{/* Stage breadcrumb */}
				<div className='flex items-center gap-2 flex-wrap'>
					{stages.map((s) => (
						<button key={s.id} onClick={() => setActiveStage(s.id)}>
							<StageBadge label={s.label} active={activeStage === s.id} done={stageDone[s.id]} />
						</button>
					))}
					<div className='ml-auto text-[9px] font-bold uppercase tracking-widest text-slate-600'>Data Integrity Pipeline</div>
				</div>

				{/* Stage controls */}
				<div className='flex items-center gap-2 flex-wrap min-h-[28px]'>
					{activeStage === 'quality' && (
						<>
							<Btn variant='primary' onClick={handleRunQuality}>
								Run Quality Check
							</Btn>
							{qualityIssues !== null && (
								<>
									<span className='text-[10px] text-slate-400'>
										{qualityIssues.length} issues —{' '}
										<span className='text-red-400'>{qualityIssues.filter((i) => i.severity === 'error').length} errors</span>{' '}
										<span className='text-amber-400'>
											{qualityIssues.filter((i) => i.severity === 'warning').length} warnings
										</span>
									</span>
									<Btn onClick={handleClearQuality}>Clear</Btn>
								</>
							)}
						</>
					)}
					{activeStage === 'diff' && (
						<>
							{!diffActive ? (
								<Btn variant='amber' onClick={handleActivateDiff}>
									Activate EOD Diff
								</Btn>
							) : (
								<Btn onClick={handleClearDiff}>Clear Diff</Btn>
							)}
							<span className='text-[10px] text-slate-500'>
								{diffActive ? 'Structural diff logged — cell overlay pending kernel API' : 'Compares live data vs EOD snapshot'}
							</span>
						</>
					)}
					{activeStage === 'stream' && (
						<>
							{!streamRunning ? (
								<Btn variant='green' onClick={handleStartStream}>
									Start Live Feed
								</Btn>
							) : (
								<Btn variant='red' onClick={handleStopStream}>
									Stop Feed
								</Btn>
							)}
							<span className='text-[10px] text-slate-500'>
								{streamRunning
									? 'Streaming via applyTransaction — cell flash pending kernel createStream'
									: 'Click to stream live price ticks using applyTransaction'}
							</span>
						</>
					)}
					{activeStage === 'conflict' && (
						<>
							<Btn variant='indigo' onClick={handleInjectConflicts} disabled={conflictCount > 0}>
								Inject 3 Conflicts
							</Btn>
							{conflictCount > 0 && (
								<>
									<span className='text-[10px] text-red-400'>
										{conflictCount} conflict(s) — cell striping pending publishIssues API
									</span>
									<Btn variant='red' onClick={handleResolveAll}>
										Clear All
									</Btn>
								</>
							)}
							{conflictCount === 0 && (
								<span className='text-[10px] text-slate-500'>Simulates server-vs-local conflicts — logged to activity panel</span>
							)}
						</>
					)}
				</div>
			</div>

			{/* Quality issues panel */}
			{qualityIssues !== null && qualityIssues.length > 0 && (
				<div className='shrink-0 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3'>
					<p className='mb-2 text-[10px] font-extrabold uppercase tracking-wider text-rose-400'>
						{qualityIssues.length} quality issue{qualityIssues.length > 1 ? 's' : ''}
					</p>
					<ul className='flex flex-col gap-1'>
						{qualityIssues.map((issue, i) => (
							<li key={i} className='flex items-start gap-2 text-[11px] text-rose-300/80'>
								<span
									className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${issue.severity === 'error' ? 'bg-rose-400' : 'bg-amber-400'}`}
								/>
								<span>
									<span className={`font-semibold ${issue.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}`}>
										{issue.rowId} / {issue.colField}:
									</span>{' '}
									{issue.message}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Grid + log */}
			<div className='flex min-h-0 flex-1 gap-3 overflow-hidden'>
				{/* Grid */}
				<div className='flex-1 min-w-0 rounded-xl border border-slate-800/60 overflow-hidden'>
					<Grid<TradeRow>
						columns={COLUMNS}
						rows={BASE_ROWS}
						getRowId={(r) => r.id}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						showFilterChipBar
						sidebar={{ panels: ['columns', 'themes'], position: 'right' }}
						onGridReady={handleGridReady}
					/>
				</div>

				{/* Activity log */}
				<div className='w-56 shrink-0 rounded-xl border border-slate-800/60 bg-slate-900/30 flex flex-col overflow-hidden'>
					<div className='flex items-center justify-between px-3 py-2 border-b border-slate-800/60'>
						<span className='text-[9px] font-extrabold uppercase tracking-widest text-slate-500'>Activity Log</span>
						{log.length > 0 && (
							<button onClick={() => setLog([])} className='text-[9px] text-slate-600 hover:text-slate-400'>
								Clear
							</button>
						)}
					</div>
					<div className='flex-1 overflow-y-auto flex flex-col-reverse p-2 gap-1'>
						{log.length === 0 ? (
							<p className='text-[9px] text-slate-700 text-center mt-4'>No activity yet</p>
						) : (
							log.map((msg, i) => (
								<div key={i} className='text-[9px] text-slate-400 font-mono leading-tight'>
									{msg}
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
