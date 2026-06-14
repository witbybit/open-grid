/**
 * CRUD + Validation Demo
 *
 * Demonstrates the full validation lifecycle:
 *   - Per-column valueValidator (sync and async)
 *   - api.validateCell()  →  single-cell inline check
 *   - api.validateGrid()  →  full-form sweep before submit
 *   - Red border (og-cell-invalid) persists after the editor closes
 *   - Mock server response with simulated server-side rejection
 *   - api.clearValidationErrors() on a clean submit
 *   - Sidebar "Submission Log" panel showing errors or success payload as JSON
 */
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Grid } from '@open-grid/react';
import type { ColumnDef, GridApi, GridReadyEvent, CellValidationError, SidebarPanelDef } from '@open-grid/react';
import { ShieldCheck, Send, RefreshCw, AlertTriangle, CheckCircle2, Loader2, Plus, FileJson } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

interface Employee {
	id: string;
	name: string;
	email: string;
	department: string;
	salary: number;
	startDate: string;
}

const DEPARTMENTS = ['Engineering', 'Design', 'Marketing', 'Sales', 'Finance', 'HR', 'Legal'];

let _nextId = 100;
function nextId() {
	return String(++_nextId);
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
	const id = nextId();
	return {
		id,
		name: `New Employee`,
		email: '',
		department: 'Engineering',
		salary: 60000,
		startDate: '2024-01-15',
		...overrides,
	};
}

const INITIAL_ROWS: Employee[] = [
	{ id: '1', name: 'Alice Chen', email: 'alice@company.com', department: 'Engineering', salary: 95000, startDate: '2021-03-01' },
	{ id: '2', name: 'Bob Smith', email: '', department: 'Design', salary: -5000, startDate: '2023-07-15' },
	{ id: '3', name: '', email: 'carol@company.com', department: 'Marketing', salary: 72000, startDate: '2022-11-20' },
	{ id: '4', name: 'David Park', email: 'david.park@company.com', department: 'Finance', salary: 88000, startDate: '2020-05-10' },
	{ id: '5', name: 'Eva Torres', email: 'not-an-email', department: 'HR', salary: 200000000, startDate: '2024-02-28' },
];

// ─── Validators ───────────────────────────────────────────────────────────────

function isValidEmail(s: string) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: ColumnDef<Employee>[] = [
	{
		field: 'name',
		header: 'Full Name',
		width: 170,
		valueValidator: async ({ value }) => {
			const s = String(value ?? '').trim();
			if (!s) return 'Name is required';
			if (s.length < 2) return 'Name must be at least 2 characters';
			return null;
		},
	},
	{
		field: 'email',
		header: 'Email',
		width: 210,
		valueValidator: async ({ value }) => {
			const s = String(value ?? '').trim();
			if (!s) return 'Email is required';
			if (!isValidEmail(s)) return 'Invalid email format (user@domain.com)';
			return null;
		},
	},
	{
		field: 'department',
		header: 'Department',
		width: 140,
		valueValidator: ({ value }) => {
			return DEPARTMENTS.includes(String(value ?? '')) ? null : `Must be one of: ${DEPARTMENTS.join(', ')}`;
		},
	},
	{
		field: 'salary',
		header: 'Salary ($)',
		width: 120,
		valueValidator: ({ value }) => {
			const n = Number(String(value ?? '').replace(/[$,]/g, ''));
			if (isNaN(n)) return 'Must be a number';
			if (n < 0) return 'Salary cannot be negative';
			if (n > 10_000_000) return 'Salary exceeds maximum ($10M)';
			return null;
		},
	},
	{
		field: 'startDate',
		header: 'Start Date',
		width: 120,
		valueValidator: ({ value }) => {
			const d = new Date(String(value ?? ''));
			if (isNaN(d.getTime())) return 'Invalid date (YYYY-MM-DD)';
			return null;
		},
	},
];

// ─── Submit state type ────────────────────────────────────────────────────────

type SubmitStatus = 'idle' | 'validating' | 'submitting' | 'success' | 'error';

type SubmissionLog = { kind: 'error'; errors: CellValidationError[] } | { kind: 'success'; rows: Employee[] } | null;

// ─── JSON syntax highlight helper ────────────────────────────────────────────

function JsonBlock({ value }: { value: unknown }) {
	const text = JSON.stringify(value, null, 2);
	// Minimal token colouring via regex replace on plain text
	const html = text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
			let cls = 'text-sky-300'; // number
			if (/^"/.test(match)) {
				cls = /:$/.test(match) ? 'text-violet-300' : 'text-emerald-300'; // key vs string
			} else if (/true|false/.test(match)) {
				cls = 'text-amber-300';
			} else if (/null/.test(match)) {
				cls = 'text-rose-400';
			}
			return `<span class="${cls}">${match}</span>`;
		});
	return <pre className='overflow-auto text-[10.5px] leading-[1.6] text-slate-300' dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Sidebar log panel content ────────────────────────────────────────────────

function SubmissionLogPanel({ log }: { log: SubmissionLog }) {
	if (!log) {
		return (
			<div className='flex h-full flex-col items-center justify-center gap-3 px-5 text-center'>
				<FileJson className='h-8 w-8 text-slate-600' />
				<p className='text-[11px] text-slate-500'>
					Run <span className='font-semibold text-slate-400'>Validate All</span> or{' '}
					<span className='font-semibold text-slate-400'>Submit Changes</span> to see the JSON payload here.
				</p>
			</div>
		);
	}

	if (log.kind === 'error') {
		return (
			<div className='flex h-full flex-col gap-3 overflow-hidden p-3'>
				<div className='flex items-center gap-2'>
					<AlertTriangle className='h-3.5 w-3.5 shrink-0 text-rose-400' />
					<span className='text-[10px] font-extrabold uppercase tracking-wider text-rose-400'>
						{log.errors.length} validation error{log.errors.length !== 1 ? 's' : ''}
					</span>
				</div>
				<div className='min-h-0 flex-1 overflow-auto rounded-lg bg-slate-950/60 p-3'>
					<JsonBlock value={log.errors} />
				</div>
			</div>
		);
	}

	return (
		<div className='flex h-full flex-col gap-3 overflow-hidden p-3'>
			<div className='flex items-center gap-2'>
				<CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-emerald-400' />
				<span className='text-[10px] font-extrabold uppercase tracking-wider text-emerald-400'>
					{log.rows.length} row{log.rows.length !== 1 ? 's' : ''} submitted
				</span>
			</div>
			<div className='min-h-0 flex-1 overflow-auto rounded-lg bg-slate-950/60 p-3'>
				<JsonBlock value={log.rows} />
			</div>
		</div>
	);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
	onGridReady?: (event: GridReadyEvent<any>) => void;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CrudValidationDemo({ onGridReady, editTrigger, arrowKeyNavigationEdit, pinLeftColumns, pinRightColumns }: Props) {
	const apiRef = useRef<GridApi<Employee> | null>(null);
	const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle');
	const [submitMessage, setSubmitMessage] = useState('');
	const [validationSummary, setValidationSummary] = useState<CellValidationError[]>([]);
	const [submissionLog, setSubmissionLog] = useState<SubmissionLog>(null);
	const [rows] = useState<Employee[]>(INITIAL_ROWS);

	const handleGridReady = useCallback(
		(event: GridReadyEvent<Employee>) => {
			apiRef.current = event.api;
			onGridReady?.(event as GridReadyEvent<any>);
		},
		[onGridReady]
	);

	const handleValidateAll = useCallback(async () => {
		const api = apiRef.current;
		if (!api) return;
		setSubmitStatus('validating');
		setSubmitMessage('');
		const errors = await api.validateGrid();
		setValidationSummary(errors);
		if (errors.length === 0) {
			setSubmitStatus('idle');
			setSubmitMessage('All cells passed validation!');
			setSubmissionLog(null);
		} else {
			setSubmitStatus('error');
			setSubmitMessage(`${errors.length} validation error${errors.length > 1 ? 's' : ''} found. Fix highlighted cells and retry.`);
			setSubmissionLog({ kind: 'error', errors });
			api.openPanel('submission-log');
		}
	}, []);

	const handleSubmit = useCallback(async () => {
		const api = apiRef.current;
		if (!api) return;

		// Step 1: client-side validation sweep
		setSubmitStatus('validating');
		setSubmitMessage('Validating…');
		setValidationSummary([]);
		const errors = await api.validateGrid();
		setValidationSummary(errors);

		if (errors.length > 0) {
			setSubmitStatus('error');
			setSubmitMessage(`${errors.length} error${errors.length > 1 ? 's' : ''} — fix highlighted cells before saving.`);
			setSubmissionLog({ kind: 'error', errors });
			api.openPanel('submission-log');
			return;
		}

		// Step 2: mock server roundtrip
		setSubmitStatus('submitting');
		setSubmitMessage('Sending to server…');
		await new Promise((r) => setTimeout(r, 900));

		// Simulate a 50% chance the server rejects row 4 for a domain policy reason
		const serverRejected = Math.random() > 0.5;
		if (serverRejected) {
			const serverErrors: CellValidationError[] = [
				{ rowId: '4', colField: 'email', error: 'Server: @company.com domain reserved for existing staff' },
			];
			setValidationSummary(serverErrors);
			setSubmitStatus('error');
			setSubmitMessage('Server rejected the request. See error below.');
			setSubmissionLog({ kind: 'error', errors: serverErrors });
			api.openPanel('submission-log');
			return;
		}

		// Step 3: success — collect all rows from the grid and log them
		const allRows = api.rows().getAll();
		api.clearValidationErrors();
		setValidationSummary([]);
		setSubmitStatus('success');
		setSubmitMessage('All changes saved successfully!');
		setSubmissionLog({ kind: 'success', rows: allRows });
		api.openPanel('submission-log');
	}, []);

	const handleAddRow = useCallback(() => {
		const api = apiRef.current;
		if (!api) return;
		const newRow = makeEmployee();
		api.applyTransaction({ add: [newRow] });
	}, []);

	const handleClearErrors = useCallback(() => {
		apiRef.current?.clearValidationErrors();
		setValidationSummary([]);
		setSubmitStatus('idle');
		setSubmitMessage('');
		setSubmissionLog(null);
	}, []);

	// Sidebar panel — recreated when submissionLog changes so the render closure captures the latest value
	const sidebarPanels = useMemo(
		(): SidebarPanelDef<Employee>[] => [
			{
				id: 'submission-log',
				label: 'Log',
				icon: <FileJson size={14} />,
				render: () => <SubmissionLogPanel log={submissionLog} />,
			},
		],
		[submissionLog]
	);

	return (
		<div className='flex h-full min-h-0 flex-col gap-3'>
			{/* Toolbar */}
			<div className='flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-900 bg-slate-900/30 px-4 py-3'>
				<span className='mr-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>Actions</span>

				<button
					onClick={handleValidateAll}
					disabled={submitStatus === 'validating' || submitStatus === 'submitting'}
					className='flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-40'
				>
					{submitStatus === 'validating' ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <ShieldCheck className='h-3.5 w-3.5' />}
					Validate All
				</button>

				<button
					onClick={handleSubmit}
					disabled={submitStatus === 'validating' || submitStatus === 'submitting'}
					className='flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-[11px] font-bold text-purple-300 transition-all hover:bg-purple-500/20 disabled:opacity-40'
				>
					{submitStatus === 'submitting' ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Send className='h-3.5 w-3.5' />}
					{submitStatus === 'submitting' ? 'Saving…' : 'Submit Changes'}
				</button>

				<button
					onClick={handleClearErrors}
					className='flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-1.5 text-[11px] font-bold text-slate-400 transition-all hover:bg-slate-800'
				>
					<RefreshCw className='h-3.5 w-3.5' />
					Clear Errors
				</button>

				<div className='ml-auto'>
					<button
						onClick={handleAddRow}
						className='flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300 transition-all hover:bg-emerald-500/20'
					>
						<Plus className='h-3.5 w-3.5' />
						Add Row
					</button>
				</div>
			</div>

			{/* Status banner */}
			{submitMessage && (
				<div
					className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-[11px] font-semibold ${
						submitStatus === 'success'
							? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
							: submitStatus === 'error'
								? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
								: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
					}`}
				>
					{submitStatus === 'success' ? (
						<CheckCircle2 className='h-4 w-4 shrink-0' />
					) : submitStatus === 'error' ? (
						<AlertTriangle className='h-4 w-4 shrink-0' />
					) : (
						<Loader2 className='h-4 w-4 shrink-0 animate-spin' />
					)}
					{submitMessage}
				</div>
			)}

			{/* Validation error list */}
			{validationSummary.length > 0 && (
				<div className='shrink-0 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3'>
					<p className='mb-2 text-[10px] font-extrabold uppercase tracking-wider text-rose-400'>
						{validationSummary.length} validation error{validationSummary.length > 1 ? 's' : ''}
					</p>
					<ul className='flex flex-col gap-1'>
						{validationSummary.map((e, i) => (
							<li key={i} className='flex items-start gap-2 text-[11px] text-rose-300/80'>
								<span className='mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400' />
								<span>
									<span className='font-semibold text-rose-300'>
										Row {e.rowId} / {e.colField}:
									</span>{' '}
									{e.error}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Grid */}
			<div className='min-h-0 flex-1'>
				<Grid<Employee>
					mode='client'
					columns={COLUMNS}
					rows={rows}
					getRowId={(r) => r.id}
					navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
					pinLeftColumns={pinLeftColumns}
					pinRightColumns={pinRightColumns}
					onGridReady={handleGridReady}
					initialState={{ defaultColWidth: 140 }}
					sidebar={{
						panels: sidebarPanels,
						position: 'right',
						width: 320,
					}}
				/>
			</div>

			{/* Legend */}
			<div className='flex shrink-0 flex-wrap items-center gap-3 px-1 pb-1 text-[10px] text-slate-500'>
				<span className='font-semibold uppercase tracking-wider'>How to use:</span>
				<span>Double-click any cell to edit</span>
				<span>·</span>
				<span>Red borders mark cells failing validation — errors persist after the editor closes</span>
				<span>·</span>
				<span>
					<strong className='text-slate-400'>Validate All</strong> or <strong className='text-slate-400'>Submit Changes</strong> opens the
					JSON log sidebar automatically
				</span>
			</div>
		</div>
	);
}
