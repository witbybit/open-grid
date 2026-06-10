import React from 'react';
import type { GridApi, ColumnDef, FilterModel, FilterModelItem } from '../../types.js';
import { useGridKeySelector } from '../../hooks.js';

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M2 2l8 8M10 2l-8 8' />
	</svg>
);

const ClearIcon = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round'>
		<path d='M1.5 1.5l8 8M9.5 1.5l-8 8' />
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
const INPUT_BG = 'rgba(15, 23, 42, 0.8)';
const INPUT_BORDER = 'rgba(30, 41, 59, 0.9)';
const INPUT_BORDER_FOCUS = 'rgba(59, 130, 246, 0.6)';

type FilterOp = 'contains' | 'equals' | 'startsWith' | 'gt' | 'lt';

const OPS: { value: FilterOp; label: string }[] = [
	{ value: 'contains', label: '≈ Contains' },
	{ value: 'equals', label: '= Equals' },
	{ value: 'startsWith', label: '↦ Starts' },
	{ value: 'gt', label: '> Greater' },
	{ value: 'lt', label: '< Less' },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface FiltersPanelProps {
	api: GridApi<any>;
	onClose: () => void;
}

export function FiltersPanel({ api, onClose }: FiltersPanelProps) {
	// Subscribe to both columns (to know what to filter) and filterModel (to show active values)
	const columns = useGridKeySelector<ColumnDef<any>[]>('columns', (s) => s.columns as ColumnDef<any>[]);
	const filterModel = useGridKeySelector<FilterModel | null>('filterModel', (s) => s.filterModel);

	const displayedCols = api.getDisplayedColumns();
	// Show filters for displayed columns only (hidden columns aren't filterable in UI)

	const activeCount = filterModel ? Object.keys(filterModel).length : 0;

	const getFilterValue = (field: string): string => {
		const item = filterModel?.[field];
		if (!item) return '';
		if (typeof item === 'object' && item !== null && 'filter' in item) {
			return String((item as FilterModelItem).filter ?? '');
		}
		return String(item ?? '');
	};

	const getFilterOp = (field: string): FilterOp => {
		const item = filterModel?.[field];
		if (typeof item === 'object' && item !== null && 'type' in item) {
			return ((item as FilterModelItem).type as FilterOp) ?? 'contains';
		}
		return 'contains';
	};

	const setFilter = (field: string, value: string, op: FilterOp) => {
		const next: FilterModel = { ...(filterModel ?? {}) };
		if (!value.trim()) {
			delete next[field];
		} else {
			next[field] = { type: op, filter: value };
		}
		api.setFilterModel(Object.keys(next).length > 0 ? next : null);
	};

	const clearFilter = (field: string) => {
		const next: FilterModel = { ...(filterModel ?? {}) };
		delete next[field];
		api.setFilterModel(Object.keys(next).length > 0 ? next : null);
	};

	const clearAll = () => api.setFilterModel(null);

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
					Filters
				</span>
				{activeCount > 0 && (
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
						Clear {activeCount}
					</button>
				)}
				<button onClick={onClose} style={iconBtnStyle}>
					<CloseIcon />
				</button>
			</div>

			{/* Filter inputs list */}
			<div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 12px' }}>
				{displayedCols.length === 0 && (
					<div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 11, color: TEXT_MUTED }}>No columns to filter</div>
				)}
				{displayedCols.map((col) => {
					const value = getFilterValue(col.field);
					const op = getFilterOp(col.field);
					const hasValue = value.trim().length > 0;

					return (
						<div key={col.field} style={{ padding: '4px 12px 8px' }}>
							<div
								style={{
									fontSize: 10,
									fontWeight: 700,
									letterSpacing: '0.06em',
									textTransform: 'uppercase',
									color: hasValue ? ACCENT_LIGHT : TEXT_MUTED,
									marginBottom: 5,
									display: 'flex',
									alignItems: 'center',
									gap: 5,
								}}
							>
								{col.header || col.field}
								{hasValue && (
									<span
										style={{
											width: 6,
											height: 6,
											borderRadius: '50%',
											background: ACCENT,
											display: 'inline-block',
											flexShrink: 0,
										}}
									/>
								)}
							</div>

							{/* Operator + input row */}
							<div style={{ display: 'flex', gap: 4 }}>
								<select
									value={op}
									onChange={(e) => setFilter(col.field, value, e.target.value as FilterOp)}
									style={{
										width: 80,
										flexShrink: 0,
										height: 28,
										fontSize: 10,
										fontWeight: 600,
										background: INPUT_BG,
										border: `1px solid ${hasValue ? 'rgba(59,130,246,0.4)' : INPUT_BORDER}`,
										borderRadius: 5,
										color: hasValue ? TEXT : TEXT_MUTED,
										padding: '0 4px',
										outline: 'none',
										cursor: 'pointer',
									}}
								>
									{OPS.map((o) => (
										<option key={o.value} value={o.value} style={{ background: '#0f172a', color: '#f1f5f9' }}>
											{o.label}
										</option>
									))}
								</select>

								<div style={{ flex: 1, position: 'relative' }}>
									<FilterInput value={value} hasValue={hasValue} onChange={(v) => setFilter(col.field, v, op)} />
									{hasValue && (
										<button
											onClick={() => clearFilter(col.field)}
											style={{
												position: 'absolute',
												right: 5,
												top: '50%',
												transform: 'translateY(-50%)',
												width: 18,
												height: 18,
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												borderRadius: 3,
												border: 'none',
												background: 'transparent',
												color: TEXT_MUTED,
												cursor: 'pointer',
												padding: 0,
											}}
										>
											<ClearIcon />
										</button>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── Sub-component: controlled input with focus ring ───────────────────────────

function FilterInput({ value, hasValue, onChange }: { value: string; hasValue: boolean; onChange: (v: string) => void }) {
	const [focused, setFocused] = React.useState(false);
	return (
		<input
			type='text'
			value={value}
			placeholder='Filter…'
			onChange={(e) => onChange(e.target.value)}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			style={{
				width: '100%',
				height: 28,
				fontSize: 11,
				background: INPUT_BG,
				border: `1px solid ${focused ? INPUT_BORDER_FOCUS : hasValue ? 'rgba(59,130,246,0.35)' : INPUT_BORDER}`,
				borderRadius: 5,
				color: TEXT,
				padding: '0 24px 0 8px',
				outline: 'none',
				boxSizing: 'border-box',
				transition: 'border-color 0.12s',
			}}
		/>
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
	flexShrink: 0,
};
