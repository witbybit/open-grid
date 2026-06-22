import React, { useState, useCallback } from 'react';
import type { GridApi } from '../../types.js';
import type { GridIntegrityIssue } from '@open-grid/core';

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const ErrorDotIcon = () => (
	<svg width='8' height='8' viewBox='0 0 8 8' fill='none'>
		<circle cx='4' cy='4' r='3.5' fill='#f87171' />
	</svg>
);

const WarningDotIcon = () => (
	<svg width='8' height='8' viewBox='0 0 8 8' fill='none'>
		<circle cx='4' cy='4' r='3.5' fill='#fbbf24' />
	</svg>
);

const InfoDotIcon = () => (
	<svg width='8' height='8' viewBox='0 0 8 8' fill='none'>
		<circle cx='4' cy='4' r='3.5' fill='#38bdf8' />
	</svg>
);

const FocusIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M1 4V1.5h2.5M10 4V1.5H7.5M1 7v2.5h2.5M10 7v2.5H7.5' />
		<circle cx='5.5' cy='5.5' r='1.5' />
	</svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

const _ISSUE_TYPE_LABELS: Record<string, string> = {
	validation: 'Validation',
	missing: 'Missing',
	duplicate: 'Duplicate',
	outlier: 'Outlier',
	typeMismatch: 'Type Mismatch',
	formulaError: 'Formula Error',
	inconsistentFormat: 'Format',
	custom: 'Custom',
};

function SeverityDot({ severity }: { severity: 'info' | 'warning' | 'error' }) {
	if (severity === 'error') return <ErrorDotIcon />;
	if (severity === 'warning') return <WarningDotIcon />;
	return <InfoDotIcon />;
}

function IssueRow({ issue, onFocus, theme }: { issue: GridIntegrityIssue; onFocus: (issue: GridIntegrityIssue) => void; theme: any }) {
	const label = _ISSUE_TYPE_LABELS[issue.type] ?? issue.type;
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'flex-start',
				gap: 6,
				padding: '5px 8px',
				borderBottom: `1px solid ${theme?.borderColor ?? '#1e293b'}`,
				fontSize: 11,
			}}
		>
			<span style={{ marginTop: 3, flexShrink: 0 }}>
				<SeverityDot severity={issue.severity} />
			</span>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
					<span
						style={{
							fontSize: 9,
							fontWeight: 600,
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
							color: theme?.mutedText ?? '#64748b',
						}}
					>
						{label}
					</span>
					{issue.colField && (
						<span
							style={{
								fontSize: 9,
								fontFamily: 'monospace',
								color: theme?.mutedText ?? '#64748b',
								background: theme?.hoverBg ?? 'rgba(255,255,255,0.04)',
								borderRadius: 3,
								padding: '0 3px',
							}}
						>
							{issue.colField}
						</span>
					)}
				</div>
				<div style={{ color: theme?.text ?? '#e2e8f0', lineHeight: 1.4, wordBreak: 'break-word' }}>{issue.message}</div>
			</div>
			{issue.rowId && issue.colField && (
				<button
					onClick={() => onFocus(issue)}
					title='Focus cell'
					style={{
						flexShrink: 0,
						background: 'none',
						border: 'none',
						cursor: 'pointer',
						color: theme?.mutedText ?? '#64748b',
						padding: 2,
						marginTop: 1,
						borderRadius: 3,
						display: 'flex',
						alignItems: 'center',
					}}
				>
					<FocusIcon />
				</button>
			)}
		</div>
	);
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function DataQualityPanel({ api, onClose }: { api: GridApi<any>; onClose: () => void }) {
	const [running, setRunning] = useState(false);
	const [hasRun, setHasRun] = useState(false);
	const [issues, setIssues] = useState<readonly GridIntegrityIssue[]>([]);
	const [error, setError] = useState<string | null>(null);

	const theme = api.getTheme?.() ?? {};

	const handleRun = useCallback(async () => {
		setRunning(true);
		setError(null);
		try {
			await api.integrity.run({ modules: ['quality'] });
			setIssues(api.integrity.getIssues({ source: 'dataQuality' }));
			setHasRun(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setRunning(false);
		}
	}, [api]);

	const handleClear = useCallback(() => {
		api.integrity.clearIssues({ source: 'dataQuality' });
		setIssues([]);
		setHasRun(false);
		setError(null);
	}, [api]);

	const handleFocus = useCallback(
		(issue: GridIntegrityIssue) => {
			if (issue.rowId && issue.colField) {
				api.selectCell({ rowId: issue.rowId, colField: issue.colField });
			}
		},
		[api]
	);

	const panelBg = (theme as any).panelBg ?? '#0f172a';
	const borderColor = (theme as any).borderColor ?? '#1e293b';
	const text = (theme as any).text ?? '#e2e8f0';
	const mutedText = (theme as any).mutedText ?? '#64748b';
	const accentColor = (theme as any).accentColor ?? '#6366f1';

	const summary = hasRun ? api.integrity.getSummary() : null;

	// Group issues by type for display
	const missingIssues = issues.filter((i) => i.type === 'missingRequired');
	const duplicateIssues = issues.filter((i) => i.type === 'duplicate');
	const otherIssues = issues.filter((i) => !['missingRequired', 'duplicate'].includes(i.type as string));

	function Section({ title, items }: { title: string; items: GridIntegrityIssue[] }) {
		if (items.length === 0) return null;
		return (
			<div style={{ marginBottom: 8 }}>
				<div
					style={{
						padding: '4px 8px',
						fontSize: 10,
						fontWeight: 600,
						textTransform: 'uppercase',
						letterSpacing: '0.06em',
						color: mutedText,
						background: 'rgba(255,255,255,0.02)',
						borderBottom: `1px solid ${borderColor}`,
					}}
				>
					{title} ({items.length})
				</div>
				{items.map((issue) => (
					<IssueRow key={issue.id} issue={issue} onFocus={handleFocus} theme={{ borderColor, text, mutedText }} />
				))}
			</div>
		);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: panelBg, color: text, fontSize: 12 }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '10px 12px',
					borderBottom: `1px solid ${borderColor}`,
					flexShrink: 0,
				}}
			>
				<span style={{ fontWeight: 600, fontSize: 12 }}>Data Quality</span>
				<button
					onClick={onClose}
					style={{
						background: 'none',
						border: 'none',
						cursor: 'pointer',
						color: mutedText,
						padding: 2,
						display: 'flex',
						alignItems: 'center',
					}}
				>
					<CloseIcon />
				</button>
			</div>

			{/* Action bar */}
			<div
				style={{
					display: 'flex',
					gap: 6,
					padding: '8px 10px',
					borderBottom: `1px solid ${borderColor}`,
					flexShrink: 0,
				}}
			>
				<button
					onClick={handleRun}
					disabled={running}
					style={{
						flex: 1,
						padding: '5px 10px',
						background: accentColor,
						color: '#fff',
						border: 'none',
						borderRadius: 4,
						cursor: running ? 'not-allowed' : 'pointer',
						fontSize: 11,
						fontWeight: 600,
						opacity: running ? 0.7 : 1,
					}}
				>
					{running ? 'Running…' : 'Run Checks'}
				</button>
				{hasRun && (
					<button
						onClick={handleClear}
						style={{
							padding: '5px 10px',
							background: 'transparent',
							color: mutedText,
							border: `1px solid ${borderColor}`,
							borderRadius: 4,
							cursor: 'pointer',
							fontSize: 11,
						}}
					>
						Clear
					</button>
				)}
			</div>

			{/* Error */}
			{error && (
				<div
					style={{
						padding: '6px 10px',
						background: 'rgba(248,113,113,0.1)',
						color: '#f87171',
						fontSize: 11,
						borderBottom: `1px solid ${borderColor}`,
					}}
				>
					{error}
				</div>
			)}

			{/* Summary */}
			{summary && (
				<div
					style={{
						display: 'flex',
						gap: 8,
						padding: '8px 10px',
						borderBottom: `1px solid ${borderColor}`,
						flexShrink: 0,
					}}
				>
					{[
						{ label: 'Total', value: summary.totalIssues, color: text },
						{ label: 'Errors', value: summary.errors, color: '#f87171' },
						{ label: 'Warnings', value: summary.warnings, color: '#fbbf24' },
					].map(({ label, value, color }) => (
						<div key={label} style={{ flex: 1, textAlign: 'center' }}>
							<div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
							<div style={{ fontSize: 9, color: mutedText, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
						</div>
					))}
				</div>
			)}

			{/* Issue list */}
			<div style={{ flex: 1, overflowY: 'auto' }}>
				{!hasRun && !running && (
					<div style={{ padding: 16, color: mutedText, fontSize: 11, textAlign: 'center' }}>
						Click <strong>Run Checks</strong> to scan the dataset for quality issues.
					</div>
				)}
				{hasRun && issues.length === 0 && (
					<div style={{ padding: 16, color: mutedText, fontSize: 11, textAlign: 'center' }}>No issues found.</div>
				)}
				{hasRun && issues.length > 0 && (
					<>
						<Section title='Missing Values' items={missingIssues as GridIntegrityIssue[]} />
						<Section title='Duplicates' items={duplicateIssues as GridIntegrityIssue[]} />
						<Section title='Other Issues' items={otherIssues as GridIntegrityIssue[]} />
					</>
				)}
			</div>
		</div>
	);
}
