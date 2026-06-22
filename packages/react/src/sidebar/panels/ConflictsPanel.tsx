import React, { useState } from 'react';
import type { GridApi } from '../../types.js';

// Local conflict types (mirrors GridCellConflict from core — avoids dist dep)
interface _GridCellConflict {
	id: string;
	rowId: string;
	colField: string;
	baseValue: unknown;
	localValue: unknown;
	remoteValue: unknown;
	source: string;
	createdAt: number;
	message?: string;
}
interface _ResolveOptions {
	strategy: 'local' | 'remote' | 'custom';
	value?: unknown;
}

interface Props {
	api: GridApi<any>;
	onClose: () => void;
}

export function ConflictsPanel({ api, onClose }: Props) {
	const [, forceUpdate] = useState(0);

	const theme = api.getTheme();
	const bg = (theme as any).bgColor ?? '#0f172a';
	const borderColor = (theme as any).borderColor ?? '#1e293b';
	const text = (theme as any).text ?? '#e2e8f0';
	const mutedText = (theme as any).mutedText ?? '#64748b';

	const api_ = api as any;
	const conflicts: readonly _GridCellConflict[] = api_.getConflicts?.() ?? [];

	function handleResolve(conflict: _GridCellConflict, options: _ResolveOptions) {
		api_.resolveConflict?.(conflict.id, options);
		forceUpdate((n) => n + 1);
	}

	function handleClearAll() {
		api_.clearAllConflicts?.();
		forceUpdate((n) => n + 1);
	}

	function handleFocus(conflict: _GridCellConflict) {
		api.selectCell({ rowId: conflict.rowId, colField: conflict.colField });
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

	const sourceBadge = (source: string): React.CSSProperties => ({
		display: 'inline-block',
		padding: '0 5px',
		borderRadius: 3,
		fontSize: 9,
		fontWeight: 700,
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		background: 'rgba(99,102,241,0.15)',
		color: '#818cf8',
	});

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg, overflow: 'hidden' }}>
			<div style={headerStyle}>
				<span style={labelStyle}>Conflicts{conflicts.length > 0 ? ` (${conflicts.length})` : ''}</span>
				<button
					onClick={onClose}
					style={{ background: 'none', border: 'none', color: mutedText, cursor: 'pointer', padding: 2, fontSize: 14, lineHeight: 1 }}
				>
					✕
				</button>
			</div>

			<div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
				{conflicts.length === 0 ? (
					<div style={{ ...mutedStyle, textAlign: 'center', marginTop: 24 }}>
						No active conflicts.
						<br />
						Use api.addConflict() to register one.
					</div>
				) : (
					<>
						<div style={sectionLabelStyle}>Active Conflicts ({conflicts.length})</div>
						{conflicts.map((c) => (
							<div
								key={c.id}
								style={{
									fontSize: 11,
									color: text,
									padding: '7px 9px',
									background: 'rgba(239,68,68,0.06)',
									border: '1px solid rgba(239,68,68,0.2)',
									borderRadius: 5,
								}}
							>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
									<span style={{ fontWeight: 600 }}>{c.colField}</span>
									<span style={sourceBadge(c.source)}>{c.source}</span>
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
									<button
										onClick={() => handleFocus(c)}
										style={{
											fontSize: 10,
											padding: '1px 6px',
											borderRadius: 3,
											border: `1px solid ${borderColor}`,
											background: 'none',
											color: mutedText,
											cursor: 'pointer',
										}}
									>
										Focus
									</button>
									<button
										onClick={() => handleResolve(c, { strategy: 'local' })}
										style={{
											fontSize: 10,
											padding: '1px 6px',
											borderRadius: 3,
											border: '1px solid rgba(34,197,94,0.4)',
											background: 'rgba(34,197,94,0.08)',
											color: '#22c55e',
											cursor: 'pointer',
										}}
									>
										Keep Local
									</button>
									<button
										onClick={() => handleResolve(c, { strategy: 'remote' })}
										style={{
											fontSize: 10,
											padding: '1px 6px',
											borderRadius: 3,
											border: '1px solid rgba(245,158,11,0.4)',
											background: 'rgba(245,158,11,0.08)',
											color: '#f59e0b',
											cursor: 'pointer',
										}}
									>
										Use Remote
									</button>
								</div>
							</div>
						))}
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
					</>
				)}
			</div>
		</div>
	);
}
