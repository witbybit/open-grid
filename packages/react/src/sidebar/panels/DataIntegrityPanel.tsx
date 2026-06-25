import { useSyncExternalStore } from 'react';
import type { GridApi } from '@open-grid/core';

interface DataIntegrityPanelProps {
	api: GridApi<unknown>;
}

const severityColor: Record<string, string> = {
	error: '#d32f2f',
	warning: '#f57c00',
	info: '#0288d1',
};

const severityIcon: Record<string, string> = {
	error: '✕',
	warning: '⚠',
	info: 'ℹ',
};

export function DataIntegrityPanel({ api }: DataIntegrityPanelProps) {
	const issues = useSyncExternalStore(
		api.integrity.subscribe,
		() => api.integrity.getAllIssues(),
		() => api.integrity.getAllIssues()
	);

	const errors = issues.filter((i) => i.severity === 'error');
	const warnings = issues.filter((i) => i.severity === 'warning');
	const infos = issues.filter((i) => i.severity === 'info');

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px', gap: '4px', overflowY: 'auto', fontSize: '13px' }}>
			{/* Summary badges */}
			<div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
				{[
					{ label: 'Errors', count: errors.length, color: severityColor.error },
					{ label: 'Warnings', count: warnings.length, color: severityColor.warning },
					{ label: 'Info', count: infos.length, color: severityColor.info },
				].map(({ label, count, color }) => (
					<div
						key={label}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '4px',
							padding: '4px 8px',
							border: `1px solid ${color}`,
							borderRadius: '12px',
							fontSize: '12px',
							color,
						}}
					>
						<span style={{ fontWeight: 600 }}>{count}</span>
						<span>{label}</span>
					</div>
				))}
			</div>

			{/* Issue list */}
			{issues.length === 0 ? (
				<div style={{ textAlign: 'center', color: 'var(--og-cell-text-muted, #888)', paddingTop: '16px' }}>
					<div style={{ fontSize: '20px', marginBottom: '4px' }}>✓</div>
					No integrity issues
				</div>
			) : (
				issues.map((issue, i) => (
					<div
						key={i}
						style={{
							display: 'flex',
							gap: '8px',
							padding: '6px 8px',
							border: `1px solid ${severityColor[issue.severity] ?? '#ddd'}`,
							borderRadius: '4px',
							borderLeft: `3px solid ${severityColor[issue.severity] ?? '#ddd'}`,
							fontSize: '12px',
						}}
					>
						<span style={{ color: severityColor[issue.severity], flexShrink: 0 }}>{severityIcon[issue.severity]}</span>
						<div>
							{issue.field && (
								<div style={{ fontWeight: 600, marginBottom: '2px' }}>
									{issue.field} · row {String(issue.rowId)}
								</div>
							)}
							<div>{issue.message}</div>
						</div>
					</div>
				))
			)}

			{issues.length > 0 && (
				<button
					onClick={() => api.integrity.revalidate()}
					style={{
						marginTop: '8px',
						padding: '4px 8px',
						border: '1px solid var(--og-border, #ddd)',
						borderRadius: '4px',
						background: 'transparent',
						cursor: 'pointer',
						fontSize: '12px',
						alignSelf: 'flex-start',
						color: 'inherit',
					}}
				>
					Re-validate
				</button>
			)}
		</div>
	);
}
