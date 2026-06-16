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

// ── Component ─────────────────────────────────────────────────────────────────

interface SortPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

export function SortPanel({ api, onClose }: SortPanelProps) {
	const columns = useGridKeySelector<ColumnDef<any>[]>('columns', (s) => s.columns as ColumnDef<any>[]);
	const sortModel = useGridKeySelector<SortModel | null>('sortModel', (s) => s.sortModel);
	// Subscribe to themeName so the panel re-renders when the theme changes.
	useGridKeySelector('themeName', (s) => s.themeName);
	const theme = api.getTheme();

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
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: theme.bgColor }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					padding: '0 12px',
					height: 44,
					flexShrink: 0,
					background: theme.headerBg,
					borderBottom: `1px solid ${theme.borderColor}`,
					gap: 8,
				}}
			>
				<span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.textColor }}>
					Sort
				</span>
				{activeItems.length > 0 && (
					<button
						onClick={clearAll}
						style={{
							fontSize: 10,
							fontWeight: 600,
							color: theme.focusRing,
							background: theme.selectionBg,
							border: `1px solid ${theme.selectionBorder}`,
							borderRadius: 4,
							padding: '2px 7px',
							cursor: 'pointer',
							letterSpacing: '0.03em',
						}}
					>
						Clear all
					</button>
				)}
				<button onClick={onClose} style={makeIconBtnStyle(theme.headerText)}>
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
							color: theme.headerText,
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
							background: theme.headerBg,
							border: `1px solid ${theme.borderColor}`,
						}}
					>
						{/* Priority badge */}
						<span
							style={{
								width: 18,
								height: 18,
								flexShrink: 0,
								borderRadius: 4,
								background: theme.selectionBg,
								border: `1px solid ${theme.selectionBorder}`,
								color: theme.focusRing,
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
								color: theme.textColor,
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
								border: `1px solid ${theme.selectionBorder}`,
								background: theme.selectionBg,
								color: theme.focusRing,
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
								color: theme.focusRing,
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
								width: 22,
							}}
						>
							{item.sort === 'asc' ? 'ASC' : 'DESC'}
						</span>

						{/* Remove */}
						<button onClick={() => removeSort(item.colId)} style={{ ...makeIconBtnStyle(theme.headerText), flexShrink: 0 }}>
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
							background: theme.selectionBg,
							border: `1px solid ${theme.selectionBorder}`,
						}}
					>
						<span style={{ fontSize: 10, fontWeight: 700, color: theme.headerText, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
							Add sort by
						</span>
						<div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
							{sortableColumns.length === 0 && (
								<span style={{ fontSize: 11, color: theme.headerText, padding: '4px 0' }}>All columns sorted</span>
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
										color: theme.textColor,
										background: 'transparent',
										border: 'none',
										borderRadius: 5,
										cursor: 'pointer',
										transition: 'background 0.1s',
									}}
									onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = theme.rowHoverBg)}
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
								color: theme.headerText,
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
								border: `1px dashed ${theme.borderColor}`,
								background: 'transparent',
								color: theme.headerText,
								cursor: 'pointer',
								fontSize: 11,
								fontWeight: 600,
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
								transition: 'border-color 0.12s, color 0.12s',
							}}
							onMouseEnter={(e) => {
								(e.currentTarget as HTMLElement).style.borderColor = theme.focusRing;
								(e.currentTarget as HTMLElement).style.color = theme.focusRing;
							}}
							onMouseLeave={(e) => {
								(e.currentTarget as HTMLElement).style.borderColor = theme.borderColor;
								(e.currentTarget as HTMLElement).style.color = theme.headerText;
							}}
						>
							<AddIcon />
							Add sort
						</button>
					)
				)}

				{/* Multi-sort hint */}
				{activeItems.length > 1 && (
					<p style={{ fontSize: 10, color: theme.headerText, margin: 0, padding: '4px 2px', lineHeight: 1.5 }}>
						Multi-sort active — rows are sorted by priority order above.
					</p>
				)}
			</div>
		</div>
	);
}

function makeIconBtnStyle(color: string): React.CSSProperties {
	return {
		width: 24,
		height: 24,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 5,
		border: 'none',
		background: 'transparent',
		cursor: 'pointer',
		color,
		padding: 0,
	};
}
