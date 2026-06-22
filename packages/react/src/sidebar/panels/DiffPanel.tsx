import React, { useState } from 'react';
import type { GridApi } from '../../types.js';
import type { GridDiffResult, GridCellDiff } from '@open-grid/core';

interface Props {
	api: GridApi<any>;
	onClose: () => void;
}

export function DiffPanel({ api, onClose }: Props) {
	const [, forceUpdate] = useState(0);
	const theme = api.getTheme();
	const bg = (theme as any).bgColor ?? '#0f172a';
	const borderColor = (theme as any).borderColor ?? '#1e293b';
	const text = (theme as any).text ?? '#e2e8f0';
	const mutedText = (theme as any).mutedText ?? '#64748b';
	const accentColor = (theme as any).accentColor ?? '#6366f1';

	const result: GridDiffResult | null = api.getDiffResult();
	const model = (api as any).engine?.diff?.getDiffModel?.() ?? null;

	function handleClear() {
		api.clearDiffModel();
		forceUpdate((n) => n + 1);
	}

	function handleFocus(cell: GridCellDiff) {
		api.selectCell({ rowId: cell.rowId, colField: cell.colField });
	}

	function handleAccept(cell: GridCellDiff) {
		api.acceptCellDiff(cell.rowId, cell.colField);
		forceUpdate((n) => n + 1);
	}

	function handleReject(cell: GridCellDiff) {
		api.rejectCellDiff(cell.rowId, cell.colField);
		forceUpdate((n) => n + 1);
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

	const chipStyle = (color: string): React.CSSProperties => ({
		display: 'inline-flex',
		alignItems: 'center',
		gap: 4,
		padding: '1px 6px',
		borderRadius: 4,
		background: `${color}22`,
		color,
		fontSize: 11,
		fontWeight: 600,
	});

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg, overflow: 'hidden' }}>
			<div style={headerStyle}>
				<span style={labelStyle}>Diff</span>
				<button
					onClick={onClose}
					style={{ background: 'none', border: 'none', color: mutedText, cursor: 'pointer', padding: 2, fontSize: 14, lineHeight: 1 }}
				>
					✕
				</button>
			</div>

			<div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
				{!result ? (
					<div style={{ ...mutedStyle, textAlign: 'center', marginTop: 24 }}>
						No diff active.
						<br />
						Use api.setDiffModel() to compare datasets.
					</div>
				) : (
					<>
						{model && (
							<div>
								<div style={sectionLabelStyle}>Comparing</div>
								<div style={{ fontSize: 12, color: text }}>
									{model.base.label} → {model.compare.label}
								</div>
							</div>
						)}

						<div>
							<div style={sectionLabelStyle}>Summary</div>
							<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
								<span style={chipStyle('#22c55e')}>{result.addedRows.length} added</span>
								<span style={chipStyle('#ef4444')}>{result.removedRows.length} removed</span>
								<span style={chipStyle('#f59e0b')}>{result.changedRows.length} changed rows</span>
								<span style={chipStyle('#6366f1')}>{result.changedCells.length} changed cells</span>
							</div>
						</div>

						{result.removedRows.length > 0 && (
							<div>
								<div style={sectionLabelStyle}>Removed Rows ({result.removedRows.length})</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
									{result.removedRows.map((id) => (
										<div
											key={id}
											style={{
												fontSize: 11,
												color: '#ef4444',
												padding: '2px 6px',
												background: 'rgba(239,68,68,0.08)',
												borderRadius: 4,
											}}
										>
											{id}
										</div>
									))}
								</div>
							</div>
						)}

						{result.changedCells.length > 0 && (
							<div>
								<div style={sectionLabelStyle}>Changed Cells ({result.changedCells.length})</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
									{result.changedCells.map((cell, i) => (
										<div
											key={i}
											style={{
												fontSize: 11,
												color: text,
												padding: '5px 7px',
												background: 'rgba(245,158,11,0.06)',
												border: `1px solid rgba(245,158,11,0.2)`,
												borderRadius: 5,
											}}
										>
											<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
												<span style={{ fontWeight: 600 }}>{cell.colField}</span>
												<span style={mutedStyle}>{cell.rowId}</span>
											</div>
											<div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: mutedText }}>
												<span style={{ color: '#ef4444', textDecoration: 'line-through' }}>
													{String(cell.oldValue ?? '—')}
												</span>
												<span>→</span>
												<span style={{ color: '#22c55e' }}>{String(cell.newValue ?? '—')}</span>
											</div>
											<div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
												<button
													onClick={() => handleFocus(cell)}
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
													onClick={() => handleAccept(cell)}
													style={{
														fontSize: 10,
														padding: '1px 6px',
														borderRadius: 3,
														border: `1px solid rgba(34,197,94,0.4)`,
														background: 'rgba(34,197,94,0.08)',
														color: '#22c55e',
														cursor: 'pointer',
													}}
												>
													Accept
												</button>
												<button
													onClick={() => handleReject(cell)}
													style={{
														fontSize: 10,
														padding: '1px 6px',
														borderRadius: 3,
														border: `1px solid rgba(239,68,68,0.4)`,
														background: 'rgba(239,68,68,0.08)',
														color: '#ef4444',
														cursor: 'pointer',
													}}
												>
													Reject
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{result.addedRows.length > 0 && (
							<div>
								<div style={sectionLabelStyle}>Added Rows ({result.addedRows.length})</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
									{result.addedRows.map((id) => (
										<div
											key={id}
											style={{
												fontSize: 11,
												color: '#22c55e',
												padding: '2px 6px',
												background: 'rgba(34,197,94,0.08)',
												borderRadius: 4,
											}}
										>
											{id}
										</div>
									))}
								</div>
							</div>
						)}

						<button
							onClick={handleClear}
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
							Clear Diff
						</button>
					</>
				)}
			</div>
		</div>
	);
}
