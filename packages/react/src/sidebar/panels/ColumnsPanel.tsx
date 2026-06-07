import React, { useRef, useState } from 'react';
import type { GridApi, ColumnDef } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';

// ── Icons ─────────────────────────────────────────────────────────────────────

const GripIcon = () => (
	<svg width='10' height='14' viewBox='0 0 10 14' fill='currentColor'>
		<circle cx='3' cy='2.5' r='1.2' />
		<circle cx='7' cy='2.5' r='1.2' />
		<circle cx='3' cy='7' r='1.2' />
		<circle cx='7' cy='7' r='1.2' />
		<circle cx='3' cy='11.5' r='1.2' />
		<circle cx='7' cy='11.5' r='1.2' />
	</svg>
);

const EyeOpenIcon = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round'>
		<path d='M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4Z' />
		<circle cx='7' cy='7' r='1.8' />
	</svg>
);

const EyeClosedIcon = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round'>
		<path d='M1.5 1.5l11 11' />
		<path d='M5.5 5.6A2 2 0 008.4 8.5' />
		<path d='M3 3.7C1.8 4.7 1 6 1 6s2 4 6 4c.8 0 1.6-.2 2.3-.4' />
		<path d='M7 3c.4 0 .9.1 1.3.2C11 4 13 6 13 6s-.5.9-1.3 1.7' />
	</svg>
);

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const PANEL_BG = '#0b0d14';
const HEADER_BG = '#090a0f';
const BORDER = 'rgba(30, 41, 59, 0.7)';
const TEXT = '#cbd5e1';
const TEXT_MUTED = '#64748b';
const ACCENT = '#3b82f6';
const ACCENT_LIGHT = '#60a5fa';

// ── Component ─────────────────────────────────────────────────────────────────

interface ColumnsPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

export function ColumnsPanel({ api, onClose }: ColumnsPanelProps) {
	// Subscribe to column changes so panel stays in sync with header drags, etc.
	const stateColumns = useGridKeySelector<ColumnDef<any>[]>('columns', (s) => s.columns as ColumnDef<any>[]);

	// Use api.getColumns() which returns all columns including hidden
	const allCols = api.getColumns();
	const visibleCount = allCols.filter((c) => !c.hide).length;

	// Drag-to-reorder state
	const dragFromIdx = useRef<number | null>(null);
	const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

	const handleDragStart = (e: React.DragEvent, index: number) => {
		dragFromIdx.current = index;
		e.dataTransfer.effectAllowed = 'move';
		// Subtle opacity on the source row
		(e.currentTarget as HTMLElement).style.opacity = '0.35';
	};

	const handleDragEnd = (e: React.DragEvent) => {
		(e.currentTarget as HTMLElement).style.opacity = '';
		dragFromIdx.current = null;
		setDropTargetIdx(null);
	};

	const handleDragOver = (e: React.DragEvent, index: number) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if (dropTargetIdx !== index) setDropTargetIdx(index);
	};

	const handleDrop = (e: React.DragEvent, toIndex: number) => {
		e.preventDefault();
		const fromIndex = dragFromIdx.current;
		setDropTargetIdx(null);
		if (fromIndex === null || fromIndex === toIndex) return;

		const cols = api.getColumns();
		const reordered = [...cols];
		const [moved] = reordered.splice(fromIndex, 1);
		reordered.splice(toIndex, 0, moved);
		api.setColumnOrder(reordered.map((c) => c.field));
	};

	const handleToggle = (field: string, isHidden: boolean) => {
		api.setColumnVisible(field, isHidden); // isHidden=true → make visible
	};

	const handleShowAll = () =>
		api.setColumnsVisible(
			allCols.map((c) => c.field),
			true
		);
	const handleHideAll = () => {
		// Always keep at least one column visible
		if (allCols.length > 1) {
			api.setColumnsVisible(
				allCols.slice(1).map((c) => c.field),
				false
			);
		}
	};

	// Suppress re-render noise — stateColumns dependency just triggers fresh allCols read
	void stateColumns;

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
				<span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT }}>
					Columns
				</span>
				<span style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 600 }}>
					{visibleCount}/{allCols.length}
				</span>
				<button onClick={onClose} style={iconBtnStyle}>
					<CloseIcon />
				</button>
			</div>

			{/* Quick-action bar */}
			<div
				style={{
					display: 'flex',
					gap: 6,
					padding: '7px 12px',
					borderBottom: `1px solid ${BORDER}`,
					flexShrink: 0,
				}}
			>
				<button onClick={handleShowAll} style={pillBtnStyle(false)}>
					Show all
				</button>
				<button onClick={handleHideAll} style={pillBtnStyle(false)}>
					Hide all
				</button>
			</div>

			{/* Scrollable column list */}
			<div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
				{allCols.map((col, index) => {
					const isHidden = !!col.hide;
					const isDragTarget = dropTargetIdx === index;
					return (
						<div
							key={col.field}
							draggable
							onDragStart={(e) => handleDragStart(e, index)}
							onDragEnd={handleDragEnd}
							onDragOver={(e) => handleDragOver(e, index)}
							onDrop={(e) => handleDrop(e, index)}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 8,
								padding: '5px 12px',
								cursor: 'grab',
								userSelect: 'none',
								opacity: isHidden ? 0.42 : 1,
								background: isDragTarget ? 'rgba(59,130,246,0.07)' : 'transparent',
								borderTop: isDragTarget ? `1.5px solid rgba(59,130,246,0.5)` : '1.5px solid transparent',
								transition: 'background 0.08s, opacity 0.1s',
							}}
						>
							<span style={{ color: '#2d3f55', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
								<GripIcon />
							</span>
							<span
								style={{
									flex: 1,
									fontSize: 11,
									fontWeight: 600,
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
									color: isHidden ? '#475569' : TEXT,
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
								}}
							>
								{col.header || col.field}
							</span>
							<button
								onClick={() => handleToggle(col.field, isHidden)}
								title={isHidden ? 'Show column' : 'Hide column'}
								style={{
									...iconBtnStyle,
									color: isHidden ? '#334155' : ACCENT_LIGHT,
								}}
							>
								{isHidden ? <EyeClosedIcon /> : <EyeOpenIcon />}
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── Shared mini-style helpers ─────────────────────────────────────────────────

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
	flexShrink: 0,
};

function pillBtnStyle(active: boolean): React.CSSProperties {
	return {
		flex: 1,
		height: 26,
		fontSize: 10,
		fontWeight: 600,
		letterSpacing: '0.04em',
		textTransform: 'uppercase',
		borderRadius: 5,
		border: active ? `1px solid rgba(59,130,246,0.5)` : '1px solid rgba(30,41,59,0.8)',
		background: active ? 'rgba(59,130,246,0.12)' : 'rgba(15,23,42,0.5)',
		color: active ? ACCENT_LIGHT : TEXT_MUTED,
		cursor: 'pointer',
		padding: 0,
	};
}
