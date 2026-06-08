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

const GroupIcon = () => (
	<svg width='13' height='13' viewBox='0 0 13 13' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<rect x='1' y='1' width='11' height='4' rx='1.2' />
		<rect x='3' y='8' width='7' height='4' rx='1.2' />
		<path d='M6.5 5v3' />
	</svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const PANEL_BG = '#0b0d14';
const HEADER_BG = '#090a0f';
const SECTION_BG = 'rgba(15, 23, 42, 0.6)';
const BORDER = 'rgba(30, 41, 59, 0.7)';
const TEXT = '#cbd5e1';
const TEXT_MUTED = '#64748b';
const ACCENT = '#3b82f6';
const ACCENT_LIGHT = '#60a5fa';
const GROUP_ACCENT = '#a78bfa';
const GROUP_ACCENT_BG = 'rgba(167,139,250,0.12)';
const GROUP_ACCENT_BORDER = 'rgba(167,139,250,0.35)';

// ── Component ─────────────────────────────────────────────────────────────────

interface ColumnsPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

export function ColumnsPanel({ api, onClose }: ColumnsPanelProps) {
	const stateColumns = useGridKeySelector<ColumnDef<any>[]>('columns', (s) => s.columns as ColumnDef<any>[]);
	const stateGroupBy = useGridKeySelector<string[]>('groupBy', (s) => (s.groupBy ?? []) as string[]);

	const allCols = api.getColumns();
	const groupBy: string[] = stateGroupBy ?? api.getGroupBy?.() ?? [];
	const visibleCount = allCols.filter((c) => !c.hide).length;

	// Drag-to-reorder for column list
	const dragFromIdx = useRef<number | null>(null);
	const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

	// Drag-to-reorder for group pills
	const groupDragFromIdx = useRef<number | null>(null);
	const [groupDropTargetIdx, setGroupDropTargetIdx] = useState<number | null>(null);
	// Drag from column list into group drop zone
	const [groupDropZoneActive, setGroupDropZoneActive] = useState(false);

	// ── Column list drag handlers ──────────────────────────────────────────────

	const handleDragStart = (e: React.DragEvent, index: number) => {
		dragFromIdx.current = index;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('column-field', allCols[index].field);
		(e.currentTarget as HTMLElement).style.opacity = '0.35';
	};

	const handleDragEnd = (e: React.DragEvent) => {
		(e.currentTarget as HTMLElement).style.opacity = '';
		dragFromIdx.current = null;
		setDropTargetIdx(null);
		setGroupDropZoneActive(false);
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

	// ── Visibility handlers ────────────────────────────────────────────────────

	const handleToggle = (field: string, isHidden: boolean) => {
		api.setColumnVisible(field, isHidden);
	};

	const handleShowAll = () =>
		api.setColumnsVisible(
			allCols.map((c) => c.field),
			true
		);
	const handleHideAll = () => {
		if (allCols.length > 1)
			api.setColumnsVisible(
				allCols.slice(1).map((c) => c.field),
				false
			);
	};

	// ── Grouping handlers ──────────────────────────────────────────────────────

	const isGrouped = (field: string) => groupBy.includes(field);

	const canGroup = (col: ColumnDef<any>) => col.enableRowGroup !== false;

	const toggleGroup = (field: string) => {
		const next = isGrouped(field) ? groupBy.filter((f) => f !== field) : [...groupBy, field];
		api.setGroupBy?.(next);
	};

	const removeGroup = (field: string) => {
		api.setGroupBy?.(groupBy.filter((f) => f !== field));
	};

	const clearAllGroups = () => api.setGroupBy?.([]);

	// Reorder group pills via drag
	const handleGroupPillDragStart = (e: React.DragEvent, index: number) => {
		groupDragFromIdx.current = index;
		e.dataTransfer.effectAllowed = 'move';
		e.stopPropagation();
	};

	const handleGroupPillDragOver = (e: React.DragEvent, index: number) => {
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';
		if (groupDropTargetIdx !== index) setGroupDropTargetIdx(index);
	};

	const handleGroupPillDrop = (e: React.DragEvent, toIndex: number) => {
		e.preventDefault();
		e.stopPropagation();
		const fromIndex = groupDragFromIdx.current;
		setGroupDropTargetIdx(null);
		if (fromIndex === null || fromIndex === toIndex) return;
		const next = [...groupBy];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		api.setGroupBy?.(next);
	};

	// Drop a column from the list into the group zone
	const handleGroupZoneDragOver = (e: React.DragEvent) => {
		if (dragFromIdx.current === null) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		setGroupDropZoneActive(true);
	};

	const handleGroupZoneDragLeave = () => setGroupDropZoneActive(false);

	const handleGroupZoneDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setGroupDropZoneActive(false);
		const field = e.dataTransfer.getData('column-field');
		if (!field || isGrouped(field)) return;
		const col = allCols.find((c) => c.field === field);
		if (!col || !canGroup(col)) return;
		api.setGroupBy?.([...groupBy, field]);
	};

	void stateColumns;

	const groupableCols = allCols.filter(canGroup);
	const hasGroups = groupBy.length > 0;

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

			{/* Scrollable body */}
			<div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
				{/* ── Row Groups Section ────────────────────────────────── */}
				{groupableCols.length > 0 && (
					<div style={{ flexShrink: 0 }}>
						{/* Section label */}
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								padding: '8px 12px 4px',
							}}
						>
							<span
								style={{
									fontSize: 10,
									fontWeight: 700,
									letterSpacing: '0.08em',
									textTransform: 'uppercase',
									color: GROUP_ACCENT,
									display: 'flex',
									alignItems: 'center',
									gap: 5,
								}}
							>
								<GroupIcon />
								Row Groups
							</span>
							{hasGroups && (
								<button
									onClick={clearAllGroups}
									style={{ ...iconBtnStyle, fontSize: 9, color: TEXT_MUTED, width: 'auto', padding: '0 4px' }}
									title='Clear all groups'
								>
									Clear
								</button>
							)}
						</div>

						{/* Drop zone / pills */}
						<div
							onDragOver={handleGroupZoneDragOver}
							onDragLeave={handleGroupZoneDragLeave}
							onDrop={handleGroupZoneDrop}
							style={{
								minHeight: 36,
								margin: '0 12px 8px',
								padding: hasGroups ? '4px' : '6px 8px',
								borderRadius: 6,
								border: groupDropZoneActive
									? `1.5px dashed ${GROUP_ACCENT}`
									: hasGroups
										? `1px solid ${GROUP_ACCENT_BORDER}`
										: `1.5px dashed rgba(167,139,250,0.2)`,
								background: groupDropZoneActive ? GROUP_ACCENT_BG : hasGroups ? 'rgba(167,139,250,0.05)' : 'transparent',
								transition: 'border-color 0.12s, background 0.12s',
								display: 'flex',
								flexWrap: 'wrap',
								gap: 4,
								alignItems: 'center',
							}}
						>
							{!hasGroups && !groupDropZoneActive && (
								<span style={{ fontSize: 10, color: TEXT_MUTED, userSelect: 'none' }}>Drag a column here to group</span>
							)}
							{groupBy.map((field, idx) => {
								const col = allCols.find((c) => c.field === field);
								const label = col?.header ?? field;
								const isDragTarget = groupDropTargetIdx === idx;
								return (
									<div
										key={field}
										draggable
										onDragStart={(e) => handleGroupPillDragStart(e, idx)}
										onDragOver={(e) => handleGroupPillDragOver(e, idx)}
										onDrop={(e) => handleGroupPillDrop(e, idx)}
										onDragEnd={() => {
											groupDragFromIdx.current = null;
											setGroupDropTargetIdx(null);
										}}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: 4,
											padding: '3px 6px 3px 4px',
											borderRadius: 4,
											background: isDragTarget ? 'rgba(167,139,250,0.25)' : 'rgba(167,139,250,0.15)',
											border: isDragTarget ? `1px solid ${GROUP_ACCENT}` : `1px solid ${GROUP_ACCENT_BORDER}`,
											cursor: 'grab',
											userSelect: 'none',
											transition: 'background 0.08s',
										}}
									>
										<span style={{ color: '#6b5fa0', display: 'flex', flexShrink: 0 }}>
											<GripIcon />
										</span>
										<span
											style={{
												fontSize: 10,
												fontWeight: 600,
												letterSpacing: '0.04em',
												textTransform: 'uppercase',
												color: GROUP_ACCENT,
												maxWidth: 80,
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											}}
										>
											{label}
										</span>
										<button
											onClick={() => removeGroup(field)}
											style={{
												...iconBtnStyle,
												width: 14,
												height: 14,
												color: GROUP_ACCENT,
												opacity: 0.7,
											}}
											title={`Remove ${label} group`}
										>
											<CloseIcon />
										</button>
									</div>
								);
							})}
						</div>

						<div style={{ height: 1, background: BORDER, margin: '0 0 4px' }} />
					</div>
				)}

				{/* ── Column list ───────────────────────────────────────── */}
				<div style={{ padding: '4px 0' }}>
					{allCols.map((col, index) => {
						const isHidden = !!col.hide;
						const isDragTarget = dropTargetIdx === index;
						const grouped = isGrouped(col.field);
						const groupable = canGroup(col);
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
									gap: 6,
									padding: '5px 12px',
									cursor: 'grab',
									userSelect: 'none',
									opacity: isHidden ? 0.42 : 1,
									background: isDragTarget ? 'rgba(59,130,246,0.07)' : grouped ? SECTION_BG : 'transparent',
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
										color: grouped ? GROUP_ACCENT : isHidden ? '#475569' : TEXT,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									}}
								>
									{col.header || col.field}
								</span>
								{groupable && (
									<button
										onClick={() => toggleGroup(col.field)}
										title={grouped ? `Remove "${col.header}" from groups` : `Group by "${col.header}"`}
										style={{
											...iconBtnStyle,
											color: grouped ? GROUP_ACCENT : TEXT_MUTED,
											background: grouped ? GROUP_ACCENT_BG : 'transparent',
											borderRadius: 4,
											border: grouped ? `1px solid ${GROUP_ACCENT_BORDER}` : '1px solid transparent',
										}}
									>
										<GroupIcon />
									</button>
								)}
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
