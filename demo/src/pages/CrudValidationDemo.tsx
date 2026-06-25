/**
 * CRUD + Validation Demo
 *
 * Demonstrates the full validation lifecycle using the new GridApi:
 *   - api.integrity.addColumnValidation / addRowRule (registered on mount)
 *   - api.integrity.revalidate() to trigger validation
 *   - api.integrity.getAllIssues() to read current issues
 *   - api.rows.applyTransaction for adding rows
 *   - api.sidebar.openPanel to reveal the log
 */
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Grid } from '@open-grid/react';
import type {
	ColumnDef,
	GridApi,
	SidebarPanelDef,
} from '@open-grid/react';
import { ShieldCheck, Send, RefreshCw, AlertTriangle, CheckCircle2, Loader2, Plus, FileJson, Scan } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

type EmployeeStatus = 'Active' | 'On Leave' | 'Terminated';

interface Employee {
	id: string;
	name: string;
	email: string;
	department: string;
	salary: number;
	bonus: number | null;
	status: EmployeeStatus;
	startDate: string;
}

const DEPARTMENTS = ['Engineering', 'Design', 'Marketing', 'Sales', 'Finance', 'HR', 'Legal'];
const STATUSES: EmployeeStatus[] = ['Active', 'On Leave', 'Terminated'];

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
		bonus: null,
		status: 'Active',
		startDate: '2024-01-15',
		...overrides,
	};
}

const INITIAL_ROWS: Employee[] = [
	{ id: '1', name: 'Alice Chen', email: 'alice@company.com', department: 'Engineering', salary: 95000, bonus: 12000, status: 'Active', startDate: '2021-03-01' },
	{ id: '2', name: 'Bob Smith', email: '', department: 'Design', salary: -5000, bonus: null, status: 'Terminated', startDate: '2023-07-15' },
	{ id: '3', name: '', email: 'carol@company.com', department: 'Marketing', salary: 72000, bonus: null, status: 'On Leave', startDate: '2022-11-20' },
	{ id: '4', name: 'David Park', email: 'david.park@company.com', department: 'Finance', salary: 88000, bonus: 9500, status: 'Active', startDate: '2020-05-10' },
	{ id: '5', name: 'Eva Torres', email: 'not-an-email', department: 'HR', salary: 200000000, bonus: null, status: 'Active', startDate: '2024-02-28' },
];

// ─── Validators ───────────────────────────────────────────────────────────────

function isValidEmail(s: string) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

const DEPT_MIN_SALARY: Record<string, number> = {
	Engineering: 70000, Finance: 65000, Legal: 80000, Design: 55000,
	Marketing: 50000, Sales: 45000, HR: 45000,
};

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: ColumnDef<Employee>[] = [
	{ field: 'name', header: 'Full Name', width: 160, minWidth: 100, maxWidth: 300, tooltip: ({ row }) => `ID: ${row.id}` },
	{ field: 'email', header: 'Email', width: 200, minWidth: 120 },
	{ field: 'department', header: 'Department', width: 130 },
	{
		field: 'status', header: 'Status', width: 110,
		tooltip: ({ row }) => {
			if (row.status === 'Terminated') return 'Salary and bonus are locked for terminated employees';
			if (row.status === 'On Leave') return 'Bonus is locked while on leave';
			return null;
		},
	},
	{
		field: 'salary', header: 'Salary ($)', width: 120, minWidth: 80, maxWidth: 200,
		canEdit: ({ row }) => row?.status !== 'Terminated',
		tooltip: ({ row }) => (row.status === 'Terminated' ? 'Salary locked — employee is terminated' : null),
	},
	{
		field: 'bonus', header: 'Bonus ($)', width: 110,
		canEdit: ({ row }) => row?.status === 'Active',
		tooltip: ({ row }) => {
			if (row.status === 'Active') return null;
			return `Bonus not applicable — status is "${row.status}"`;
		},
	},
	{ field: 'startDate', header: 'Start Date', width: 115 },
];

// ─── Submit state type ────────────────────────────────────────────────────────

type SubmitStatus = 'idle' | 'validating' | 'submitting' | 'success' | 'error';

type ValidationIssue = { rowId: string; colField: string; message: string };
type SubmissionLog = { kind: 'error'; errors: ValidationIssue[] } | { kind: 'success'; rows: Employee[] } | null;

// ─── JSON syntax highlight helper ────────────────────────────────────────────

function JsonBlock({ value }: { value: unknown }) {
	const text = JSON.stringify(value, null, 2);
	const html = text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
			let cls = 'text-sky-300';
			if (/^"/.test(match)) cls = /:$/.test(match) ? 'text-violet-300' : 'text-emerald-300';
			else if (/true|false/.test(match)) cls = 'text-amber-300';
			else if (/null/.test(match)) cls = 'text-rose-400';
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

// ─── Client-side validation ───────────────────────────────────────────────────

function validateRows(rows: Employee[]): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const row of rows) {
		const name = String(row.name ?? '').trim();
		if (!name) issues.push({ rowId: row.id, colField: 'name', message: 'Name is required' });
		else if (name.length < 2) issues.push({ rowId: row.id, colField: 'name', message: 'Name must be at least 2 characters' });

		const email = String(row.email ?? '').trim();
		if (!email) issues.push({ rowId: row.id, colField: 'email', message: 'Email is required' });
		else if (!isValidEmail(email)) issues.push({ rowId: row.id, colField: 'email', message: 'Invalid email format (user@domain.com)' });

		if (!DEPARTMENTS.includes(row.department)) issues.push({ rowId: row.id, colField: 'department', message: `Must be one of: ${DEPARTMENTS.join(', ')}` });
		if (!STATUSES.includes(row.status)) issues.push({ rowId: row.id, colField: 'status', message: `Must be one of: ${STATUSES.join(', ')}` });

		const salary = Number(String(row.salary ?? '').replace(/[$,]/g, ''));
		if (isNaN(salary)) issues.push({ rowId: row.id, colField: 'salary', message: 'Must be a number' });
		else if (salary < 0) issues.push({ rowId: row.id, colField: 'salary', message: 'Salary cannot be negative' });
		else if (salary > 10_000_000) issues.push({ rowId: row.id, colField: 'salary', message: 'Salary exceeds maximum ($10M)' });

		if (row.bonus !== null && row.bonus !== undefined) {
			const bonus = Number(String(row.bonus).replace(/[$,]/g, ''));
			if (isNaN(bonus)) issues.push({ rowId: row.id, colField: 'bonus', message: 'Must be a number' });
			else if (bonus < 0) issues.push({ rowId: row.id, colField: 'bonus', message: 'Bonus cannot be negative' });
			else if (bonus > 1_000_000) issues.push({ rowId: row.id, colField: 'bonus', message: 'Bonus exceeds maximum ($1M)' });
		}

		const d = new Date(String(row.startDate ?? ''));
		if (isNaN(d.getTime())) issues.push({ rowId: row.id, colField: 'startDate', message: 'Invalid date (YYYY-MM-DD)' });

		// Cross-field: dept min salary
		if (row.status !== 'Terminated') {
			const minSalary = DEPT_MIN_SALARY[row.department];
			if (minSalary !== undefined && !isNaN(salary) && salary >= 0 && salary < minSalary) {
				issues.push({ rowId: row.id, colField: 'salary', message: `${row.department} minimum salary is $${minSalary.toLocaleString()}` });
			}
		}

		// Cross-field: bonus eligibility
		if (row.status !== 'Active' && row.bonus !== null && row.bonus !== undefined) {
			issues.push({ rowId: row.id, colField: 'bonus', message: `Bonus not applicable for status "${row.status}"` });
		}
	}
	return issues;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
	onGridReady?: (api: GridApi<Employee>) => void;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CrudValidationDemo({ onGridReady, pinLeftColumns, pinRightColumns }: Props) {
	const apiRef = useRef<GridApi<Employee> | null>(null);
	const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle');
	const [submitMessage, setSubmitMessage] = useState('');
	const [validationSummary, setValidationSummary] = useState<ValidationIssue[]>([]);
	const [submissionLog, setSubmissionLog] = useState<SubmissionLog>(null);
	const [errorSnapshot, setErrorSnapshot] = useState<ValidationIssue[] | null>(null);
	const [rows] = useState<Employee[]>(INITIAL_ROWS);

	const handleGridReady = useCallback(
		(api: GridApi<Employee>) => {
			apiRef.current = api;
			onGridReady?.(api);
		},
		[onGridReady]
	);

	const handleValidateAll = useCallback(async () => {
		const api = apiRef.current;
		if (!api) return;
		setSubmitStatus('validating');
		setSubmitMessage('');
		const currentRows = api.rows.getAll();
		const errors = validateRows(currentRows);
		setValidationSummary(errors);
		if (errors.length === 0) {
			setSubmitStatus('idle');
			setSubmitMessage('All cells passed validation!');
			setSubmissionLog(null);
		} else {
			setSubmitStatus('error');
			setSubmitMessage(`${errors.length} validation error${errors.length > 1 ? 's' : ''} found. Fix highlighted cells and retry.`);
			setSubmissionLog({ kind: 'error', errors });
			api.sidebar.openPanel('submission-log');
		}
	}, []);

	const handleSubmit = useCallback(async () => {
		const api = apiRef.current;
		if (!api) return;

		setSubmitStatus('validating');
		setSubmitMessage('Validating…');
		setValidationSummary([]);
		const currentRows = api.rows.getAll();
		const errors = validateRows(currentRows);
		setValidationSummary(errors);

		if (errors.length > 0) {
			setSubmitStatus('error');
			setSubmitMessage(`${errors.length} error${errors.length > 1 ? 's' : ''} — fix highlighted cells before saving.`);
			setSubmissionLog({ kind: 'error', errors });
			api.sidebar.openPanel('submission-log');
			return;
		}

		setSubmitStatus('submitting');
		setSubmitMessage('Sending to server…');
		await new Promise((r) => setTimeout(r, 900));

		const allRows = api.rows.getAll();
		setValidationSummary([]);
		setSubmitStatus('success');
		setSubmitMessage('All changes saved successfully!');
		setSubmissionLog({ kind: 'success', rows: allRows });
		api.sidebar.openPanel('submission-log');
	}, []);

	const handleAddRow = useCallback(() => {
		const api = apiRef.current;
		if (!api) return;
		const newRow = makeEmployee();
		api.rows.applyTransaction({ add: [newRow] });
	}, []);

	const handleClearErrors = useCallback(() => {
		setValidationSummary([]);
		setSubmitStatus('idle');
		setSubmitMessage('');
		setSubmissionLog(null);
		setErrorSnapshot(null);
	}, []);

	const handleSnapshotErrors = useCallback(() => {
		const api = apiRef.current;
		if (!api) return;
		const currentRows = api.rows.getAll();
		setErrorSnapshot(validateRows(currentRows));
	}, []);

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

				<button
					onClick={handleSnapshotErrors}
					title='Validates current rows synchronously'
					className='flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] font-bold text-sky-300 transition-all hover:bg-sky-500/20'
				>
					<Scan className='h-3.5 w-3.5' />
					Snapshot Errors
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
									<span className='font-semibold text-rose-300'>Row {e.rowId} / {e.colField}:</span>{' '}
									{e.message}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Error snapshot panel */}
			{errorSnapshot !== null && (
				<div className='shrink-0 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3'>
					<div className='mb-2 flex items-center justify-between gap-2'>
						<div className='flex items-center gap-2'>
							<Scan className='h-3.5 w-3.5 text-sky-400' />
							<p className='text-[10px] font-extrabold uppercase tracking-wider text-sky-400'>
								Validation snapshot — {errorSnapshot.length} error{errorSnapshot.length !== 1 ? 's' : ''}
							</p>
						</div>
						<button onClick={() => setErrorSnapshot(null)} className='text-[10px] text-sky-600 hover:text-sky-400'>✕</button>
					</div>
					{errorSnapshot.length === 0 ? (
						<p className='text-[11px] text-sky-600 italic'>No errors — all rows are valid.</p>
					) : (
						<ul className='flex flex-col gap-1'>
							{errorSnapshot.map((e, i) => (
								<li key={i} className='flex items-start gap-2 text-[11px] text-sky-300/80'>
									<span className='mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400' />
									<span>
										<span className='font-semibold text-sky-300'>Row {e.rowId} / {e.colField}:</span>{' '}
										{e.message}
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			{/* Grid */}
			<div className='min-h-0 flex-1'>
				<Grid<Employee>
					columns={COLUMNS}
					rows={rows}
					getRowId={(r) => r.id}
					pinLeftColumns={pinLeftColumns}
					pinRightColumns={pinRightColumns}
					onGridReady={handleGridReady}
					showFilterChipBar
					sidebar={{
						panels: [...sidebarPanels, 'themes'],
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
				<span>
					<strong className='text-slate-400'>Salary</strong> is locked for <em>Terminated</em> employees —{' '}
					<strong className='text-slate-400'>Bonus</strong> is locked unless <em>Active</em>
				</span>
				<span>·</span>
				<span>Use <strong className='text-slate-400'>Validate All</strong> to run client-side rules</span>
			</div>
		</div>
	);
}
