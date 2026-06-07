import React, { useState } from 'react';
import type { GridApi, ColumnDef, SortModel } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const AscIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M5.5 9V2M2.5 5L5.5 2l3 3' />
	</svg>
);

const DescIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M5.5 2v7M2.5 6l3 3 3-3' />
	</svg>
);

const RemoveIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M1.5 1.5l8 8M9.5 1.5l-8 8' />
	</svg>
);

const AddIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M6 2v8M2 6h8' />
	</svg>
);

// ── Constants ─────────────────────────────────────────────────────────────────

const PANEL_BG = '#0b0d14';
const HEADER_BG = '#090a0f';
const BORDER = 'rgba(30, 41, 59, 0.7)';
const TEXT = '#cbd5e1';
const TEXT_MUTED = '#64748b';
const ACCENT = '#3b82f6';
const ACCENT_LIGHT = '#60a5fa';
const CHIP_BG = 'rgba(15, 23, 42, 0.9)';
const CHIP_BORDER = 'rgba(30, 41, 59, 0.9)';

// ── Component ─────────────────────────────────────────────────────────────────

interface SortPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

export function SortPanel({ api, onClose }: SortPanelProps) {
	const columns = useGridKeySelector<ColumnDef<any>[]>('columns', (s) => s.columns as ColumnDef<any>[]);
	const sortModel = useGridKeySelector<SortModel | null>('sortModel', (s) => s.sortModel);

	const [showAdd, setShowAdd] = useState(false);

	const activeItems = sortModel ?? [];
	const sortableColumns = columns.filter((c) => c.sortable !== false && !activeItems.find((s) => s.colId === c.field));

	const toggleDirection = (colId: string, current: 'asc' | 'desc') => {
		const next = (sortModel ?? []).map((item) =>
			item.colId === colId ? { ...item, sort: current === 'asc' ? ('desc' as const) : ('asc' as const) } : item
		);
		api.setSortModel(next);
	};

	const removeSort = (colId: string) => {
		const next = (sortModel ?? []).filter((item) => item.colId !== colId);
		api.setSortModel(next.length > 0 ? next : null);
	};

	const addSort = (colId: string) => {
		const next = [...(sortModel ?? []), { colId, sort: 'asc' as const }];
		api.setSortModel(next);
		setShowAdd(false);
	};

	const clearAll = () => {
		api.setSortModel(null);
		setShowAdd(false);
	};

	const getColLabel = (colId: string): string => {
		const col = columns.find((c) => c.field === colId);
		return col?.header || col?.field || colId;
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: PANEL_BG }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					padding: '0 12px',
					height: 44,
					flexShrink: 0,
					background: HEADER_BG,
					borderBottom: `1px solid ${BORDER}`,
					gap: 8,
				}}
			>
				<span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT }}>Sort</span>
				{activeItems.length > 0 && (
					<button
						onClick={clearAll}
						style={{
							fontSize: 10,
							fontWeight: 600,
							color: ACCENT_LIGHT,
							background: 'rgba(59,130,246,0.1)',
							border: '1px solid rgba(59,130,246,0.3)',
							borderRadius: 4,
							padding: '2px 7px',
							cursor: 'pointer',
							letterSpacing: '0.03em',
						}}
					>
						Clear all
					</button>
				)}
				<button onClick={onClose} style={iconBtnStyle}>
					<CloseIcon />
				</button>
			</div>

			{/* Body */}
			<div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
				{/* Empty state */}
				{activeItems.length === 0 && !showAdd && (
					<div
						style={{
							padding: '28px 0',
							textAlign: 'center',
							fontSize: 11,
							color: TEXT_MUTED,
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: 8,
						}}
					>
						<svg
							width='24'
							height='24'
							viewBox='0 0 24 24'
							fill='none'
							stroke='currentColor'
							strokeWidth='1.5'
							strokeLinecap='round'
							style={{ opacity: 0.3 }}
						>
							<path d='M3 6h18M7 12h10M11 18h2' />
						</svg>
						<span>No sort applied</span>
					</div>
				)}

				{/* Active sort chips */}
				{activeItems.map((item, idx) => (
					<div
						key={item.colId}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 6,
							padding: '6px 10px',
							borderRadius: 7,
							background: CHIP_BG,
							border: `1px solid ${CHIP_BORDER}`,
						}}
					>
						{/* Priority badge */}
						<span
							style={{
								width: 18,
								height: 18,
								flexShrink: 0,
								borderRadius: 4,
								background: 'rgba(59,130,246,0.14)',
								border: '1px solid rgba(59,130,246,0.3)',
								color: ACCENT_LIGHT,
								fontSize: 9,
								fontWeight: 800,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							{idx + 1}
						</span>

						{/* Column name */}
						<span
							style={{
								flex: 1,
								fontSize: 11,
								fontWeight: 600,
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
								color: TEXT,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
							}}
						>
							{getColLabel(item.colId)}
						</span>

						{/* Direction toggle */}
						<button
							onClick={() => toggleDirection(item.colId, item.sort)}
							title={`Sort ${item.sort === 'asc' ? 'ascending' : 'descending'} — click to toggle`}
							style={{
								width: 28,
								height: 24,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								gap: 3,
								borderRadius: 5,
								border: '1px solid rgba(59,130,246,0.35)',
								background: 'rgba(59,130,246,0.1)',
								color: ACCENT_LIGHT,
								cursor: 'pointer',
								padding: 0,
								fontSize: 9,
								fontWeight: 700,
								flexShrink: 0,
							}}
						>
							{item.sort === 'asc' ? <AscIcon /> : <DescIcon />}
						</button>

						{/* Direction label */}
						<span
							style={{
								fontSize: 9,
								fontWeight: 700,
								color: ACCENT_LIGHT,
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
								width: 22,
							}}
						>
							{item.sort === 'asc' ? 'ASC' : 'DESC'}
						</span>

						{/* Remove */}
						<button onClick={() => removeSort(item.colId)} style={{ ...iconBtnStyle, flexShrink: 0 }}>
							<RemoveIcon />
						</button>
					</div>
				))}

				{/* Add sort row */}
				{showAdd ? (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: 6,
							padding: '8px 10px',
							borderRadius: 7,
							background: 'rgba(59,130,246,0.05)',
							border: '1px solid rgba(59,130,246,0.25)',
						}}
					>
						<span style={{ fontSize: 10, fontWeight: 700, color: TEXT_MUTED, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
							Add sort by
						</span>
						<div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
							{sortableColumns.length === 0 && (
								<span style={{ fontSize: 11, color: TEXT_MUTED, padding: '4px 0' }}>All columns sorted</span>
							)}
							{sortableColumns.map((col) => (
								<button
									key={col.field}
									onClick={() => addSort(col.field)}
									style={{
										textAlign: 'left',
										padding: '6px 8px',
										fontSize: 11,
										fontWeight: 600,
										letterSpacing: '0.04em',
										textTransform: 'uppercase',
										color: TEXT,
										background: 'transparent',
										border: 'none',
										borderRadius: 5,
										cursor: 'pointer',
										transition: 'background 0.1s',
									}}
									onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.1)')}
									onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
								>
									{col.header || col.field}
								</button>
							))}
						</div>
						<button
							onClick={() => setShowAdd(false)}
							style={{
								fontSize: 10,
								fontWeight: 600,
								color: TEXT_MUTED,
								background: 'transparent',
								border: 'none',
								cursor: 'pointer',
								padding: '2px 0',
								textAlign: 'left',
								letterSpacing: '0.03em',
							}}
						>
							Cancel
						</button>
					</div>
				) : (
					sortableColumns.length > 0 && (
						<button
							onClick={() => setShowAdd(true)}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 7,
								padding: '7px 10px',
								borderRadius: 7,
								border: `1px dashed rgba(30,41,59,0.9)`,
								background: 'transparent',
								color: TEXT_MUTED,
								cursor: 'pointer',
								fontSize: 11,
								fontWeight: 600,
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
								transition: 'border-color 0.12s, color 0.12s',
							}}
							onMouseEnter={(e) => {
								(e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,0.5)';
								(e.currentTarget as HTMLElement).style.color = ACCENT_LIGHT;
							}}
							onMouseLeave={(e) => {
								(e.currentTarget as HTMLElement).style.borderColor = 'rgba(30,41,59,0.9)';
								(e.currentTarget as HTMLElement).style.color = TEXT_MUTED;
							}}
						>
							<AddIcon />
							Add sort
						</button>
					)
				)}

				{/* Multi-sort hint */}
				{activeItems.length > 1 && (
					<p style={{ fontSize: 10, color: TEXT_MUTED, margin: 0, padding: '4px 2px', lineHeight: 1.5 }}>
						Multi-sort active — rows are sorted by priority order above.
					</p>
				)}
			</div>
		</div>
	);
}

const iconBtnStyle: React.CSSProperties = {
	width: 24,
	height: 24,
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	borderRadius: 5,
	border: 'none',
	background: 'transparent',
	cursor: 'pointer',
	color: TEXT_MUTED,
	padding: 0,
};
