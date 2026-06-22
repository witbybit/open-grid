import React, { useState } from 'react';
import type { GridApi } from '../../types.js';
import type { GridCellConflict, GridIntegrityIssue, ResolveConflictOptions } from '@open-grid/core';

interface Props {
	api: GridApi<any>;
	onClose: () => void;
}

export function ConflictsPanel({ api, onClose }: Props) {
	const [, forceUpdate] = useState(0);
	const refresh = () => forceUpdate((n) => n + 1);

	const theme = api.getTheme();
	const bg = (theme as any).bgColor ?? '#0f172a';
	const borderColor = (theme as any).borderColor ?? '#1e293b';
	const text = (theme as any).text ?? '#e2e8f0';
	const mutedText = (theme as any).mutedText ?? '#64748b';

	// Real conflicts from the conflict module (have base/local/remote values)
	const realConflicts: readonly GridCellConflict[] = api.integrity.getConflicts();
	const realConflictsByCell = new Map(realConflicts.map((c) => [`${c.rowId}:${c.colField}`, c]));

	// Published conflict issues (injected externally via publishIssues)
	const allConflictIssues: readonly GridIntegrityIssue[] = api.integrity.getIssues({ source: 'conflict' });
	// Only show published issues that are NOT already covered by a real conflict
	const publishedIssues = allConflictIssues.filter((i) => !i.rowId || !i.colField || !realConflictsByCell.has(`${i.rowId}:${i.colField}`));

	const totalCount = realConflicts.length + publishedIssues.length;

	async function handleResolve(conflict: GridCellConflict, options: ResolveConflictOptions) {
		await api.integrity.resolveConflict(conflict.id, options);
		refresh();
	}

	function handleClearConflict(conflict: GridCellConflict) {
		api.integrity.clearConflict(conflict.id);
		refresh();
	}

	function handleDismissIssue(issue: GridIntegrityIssue) {
		// Remove this specific published issue by filtering it out
		const remaining = allConflictIssues.filter((i) => i.id !== issue.id);
		api.integrity.clearIssues({ source: 'conflict' });
		if (remaining.length > 0) {
			api.integrity.publishIssues('conflict', remaining);
		}
		refresh();
	}

	function handleClearAll() {
		// Clear all real conflicts
		for (const c of realConflicts) {
			api.integrity.clearConflict(c.id);
		}
		// Clear all published conflict issues
		api.integrity.clearIssues({ source: 'conflict' });
		refresh();
	}

	function handleFocus(rowId: string, colField: string) {
		api.selectCell({ rowId, colField });
	}

	const headerStyle: React.CSSProperties = {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		padding: '10px 12px',
		borderBottom: `1px solid ${borderColor}`,
		flexShrink: 0,
	};
	const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: text, textTransform: 'uppercase', letterSpacing: '0.04em' };
	const mutedStyle: React.CSSProperties = { fontSize: 11, color: mutedText };
	const sectionLabelStyle: React.CSSProperties = {
		fontSize: 10,
		fontWeight: 700,
		color: mutedText,
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		marginBottom: 4,
	};

	const sourceBadge: React.CSSProperties = {
		display: 'inline-block',
		padding: '0 5px',
		borderRadius: 3,
		fontSize: 9,
		fontWeight: 700,
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		background: 'rgba(99,102,241,0.15)',
		color: '#818cf8',
	};

	const conflictCard: React.CSSProperties = {
		fontSize: 11,
		color: text,
		padding: '7px 9px',
		background: 'rgba(239,68,68,0.06)',
		border: '1px solid rgba(239,68,68,0.2)',
		borderRadius: 5,
	};

	const issueCard: React.CSSProperties = {
		fontSize: 11,
		color: text,
		padding: '7px 9px',
		background: 'rgba(239,68,68,0.04)',
		border: '1px solid rgba(239,68,68,0.15)',
		borderRadius: 5,
	};

	const btnBase: React.CSSProperties = {
		fontSize: 10,
		padding: '1px 6px',
		borderRadius: 3,
		cursor: 'pointer',
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg, overflow: 'hidden' }}>
			<div style={headerStyle}>
				<span style={labelStyle}>Conflicts{totalCount > 0 ? ` (${totalCount})` : ''}</span>
				<button
					onClick={onClose}
					style={{ background: 'none', border: 'none', color: mutedText, cursor: 'pointer', padding: 2, fontSize: 14, lineHeight: 1 }}
				>
					✕
				</button>
			</div>

			<div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
				{totalCount === 0 ? (
					<div style={{ ...mutedStyle, textAlign: 'center', marginTop: 24 }}>
						No active conflicts.
						<br />
						Use liveStream with dirtyCellPolicy: 'markConflict' or publishIssues('conflict', …) to register conflicts.
					</div>
				) : (
					<>
						{/* Real conflicts — can be resolved with local/remote strategy */}
						{realConflicts.length > 0 && (
							<>
								<div style={sectionLabelStyle}>Live Conflicts ({realConflicts.length})</div>
								{realConflicts.map((c) => (
									<div key={c.id} style={conflictCard}>
										<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
											<span style={{ fontWeight: 600 }}>{c.colField}</span>
											<span style={sourceBadge}>{c.source}</span>
										</div>
										<div style={{ ...mutedStyle, marginBottom: 4 }}>{c.rowId}</div>
										<div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, marginBottom: 6 }}>
											<div>
												<span style={{ color: mutedText }}>Base: </span>
												<span>{String(c.baseValue ?? '—')}</span>
											</div>
											<div>
												<span style={{ color: mutedText }}>Local: </span>
												<span style={{ color: '#22c55e' }}>{String(c.localValue ?? '—')}</span>
											</div>
											<div>
												<span style={{ color: mutedText }}>Remote: </span>
												<span style={{ color: '#f59e0b' }}>{String(c.remoteValue ?? '—')}</span>
											</div>
										</div>
										<div style={{ display: 'flex', gap: 4 }}>
											{c.rowId && c.colField && (
												<button
													onClick={() => handleFocus(c.rowId, c.colField)}
													style={{ ...btnBase, border: `1px solid ${borderColor}`, background: 'none', color: mutedText }}
												>
													Focus
												</button>
											)}
											<button
												onClick={() => handleResolve(c, { strategy: 'local' })}
												style={{
													...btnBase,
													border: '1px solid rgba(34,197,94,0.4)',
													background: 'rgba(34,197,94,0.08)',
													color: '#22c55e',
												}}
											>
												Keep Local
											</button>
											<button
												onClick={() => handleResolve(c, { strategy: 'remote' })}
												style={{
													...btnBase,
													border: '1px solid rgba(245,158,11,0.4)',
													background: 'rgba(245,158,11,0.08)',
													color: '#f59e0b',
												}}
											>
												Use Remote
											</button>
										</div>
									</div>
								))}
							</>
						)}

						{/* Published conflict issues — can only be dismissed */}
						{publishedIssues.length > 0 && (
							<>
								<div style={sectionLabelStyle}>Conflict Issues ({publishedIssues.length})</div>
								{publishedIssues.map((issue) => (
									<div key={issue.id} style={issueCard}>
										<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
											<span style={{ fontWeight: 600 }}>{issue.colField ?? '—'}</span>
											<span style={sourceBadge}>conflict</span>
										</div>
										{issue.rowId && <div style={{ ...mutedStyle, marginBottom: 4 }}>{issue.rowId}</div>}
										<div style={{ fontSize: 10, color: text, marginBottom: 6, lineHeight: 1.4 }}>{issue.message}</div>
										<div style={{ display: 'flex', gap: 4 }}>
											{issue.rowId && issue.colField && (
												<button
													onClick={() => handleFocus(issue.rowId!, issue.colField!)}
													style={{ ...btnBase, border: `1px solid ${borderColor}`, background: 'none', color: mutedText }}
												>
													Focus
												</button>
											)}
											<button
												onClick={() => handleDismissIssue(issue)}
												style={{
													...btnBase,
													border: '1px solid rgba(239,68,68,0.4)',
													background: 'rgba(239,68,68,0.08)',
													color: '#f87171',
												}}
											>
												Dismiss
											</button>
										</div>
									</div>
								))}
							</>
						)}

						{totalCount > 1 && (
							<button
								onClick={handleClearAll}
								style={{
									marginTop: 4,
									padding: '5px 10px',
									borderRadius: 5,
									border: `1px solid ${borderColor}`,
									background: 'none',
									color: mutedText,
									cursor: 'pointer',
									fontSize: 11,
								}}
							>
								Clear All
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}
