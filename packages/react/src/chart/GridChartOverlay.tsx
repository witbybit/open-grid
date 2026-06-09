import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { GridApi } from '../types.js';
import { useGridKeySelector } from '../hooks.js';
import { getInternalApiFromApi } from '@open-grid/core/internal';

// ── Public types ───────────────────────────────────────────────────────────────

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter';
export type ChartTheme = 'cyberpunk' | 'emerald' | 'plasma' | 'gold' | 'ocean' | 'rose';
export type ValueFormat = 'auto' | 'km' | 'pct' | '2dp';

// ── Internal types ─────────────────────────────────────────────────────────────

interface ChartSeries {
	name: string;
	field: string;
	data: number[];
}

interface ExtractedData {
	categories: string[];
	series: ChartSeries[];
	allSeries: ChartSeries[];
}

// ── Theme registry ─────────────────────────────────────────────────────────────

const THEMES: Record<ChartTheme, string[]> = {
	cyberpunk: ['#06b6d4', '#ec4899', '#3b82f6', '#a855f7', '#f43f5e', '#10b981'],
	emerald: ['#10b981', '#34d399', '#059669', '#6ee7b7', '#047857', '#a7f3d0'],
	plasma: ['#8b5cf6', '#f59e0b', '#c084fc', '#fbbf24', '#7c3aed', '#d97706'],
	gold: ['#f59e0b', '#facc15', '#b45309', '#ca8a04', '#fef08a', '#d97706'],
	ocean: ['#0ea5e9', '#38bdf8', '#0284c7', '#7dd3fc', '#0369a1', '#bae6fd'],
	rose: ['#f43f5e', '#fb7185', '#e11d48', '#fda4af', '#be123c', '#fecdd3'],
};

// ── Value formatter ────────────────────────────────────────────────────────────

function fmtVal(val: number, fmt: ValueFormat): string {
	if (!isFinite(val)) return '—';
	switch (fmt) {
		case 'pct':
			return `${val.toFixed(1)}%`;
		case '2dp':
			return val.toFixed(2);
		case 'km': {
			const abs = Math.abs(val);
			if (abs >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
			if (abs >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
			if (abs >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
			return val.toFixed(0);
		}
		default: {
			const abs = Math.abs(val);
			if (abs >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
			if (abs >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
			return Number.isInteger(val) ? String(val) : val.toFixed(2);
		}
	}
}

// ── Smooth bezier curve ────────────────────────────────────────────────────────

function smoothPath(pts: [number, number][]): string {
	if (pts.length === 0) return '';
	if (pts.length === 1) return `M ${pts[0][0]},${pts[0][1]}`;
	let d = `M ${pts[0][0]},${pts[0][1]}`;
	for (let i = 1; i < pts.length; i++) {
		const [x0, y0] = pts[i - 1];
		const [x1, y1] = pts[i];
		const cpx = (x0 + x1) / 2;
		d += ` C ${cpx},${y0} ${cpx},${y1} ${x1},${y1}`;
	}
	return d;
}

// ── Data extraction ────────────────────────────────────────────────────────────

function extractData(
	api: GridApi<any>,
	bounds: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null | undefined,
	transposed: boolean,
	disabledSeries: Record<string, boolean>
): ExtractedData {
	if (!bounds) return { categories: [], series: [], allSeries: [] };

	const columns = api.getState().columns || [];

	const internalApi = getInternalApiFromApi(api);
	const selectedRows: { id: string; label: string }[] = [];
	for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
		const vr = internalApi.getVisualRow(r);
		if (vr?.kind === 'data') {
			const rd = api.getDataRowAtVisualIndex(r);
			if (rd) selectedRows.push({ id: vr.rowId, label: `R${r + 1}` });
		}
	}
	const selectedCols: { field: string; header: string }[] = [];
	for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
		const col = columns[c];
		if (col) selectedCols.push({ field: col.field, header: String(col.header ?? col.field) });
	}
	if (selectedRows.length === 0 || selectedCols.length === 0) return { categories: [], series: [], allSeries: [] };

	// Auto-detect text category column
	const firstField = selectedCols[0].field;
	let isFirstText = false;
	for (const row of selectedRows) {
		const val = api.getCellValue(row.id, firstField);
		if (val != null && val !== '' && isNaN(Number(val))) {
			isFirstText = true;
			break;
		}
	}

	let categoryField = '';
	const dataCols = [...selectedCols];
	let categoryLabels: string[];

	if (isFirstText && selectedCols.length > 1) {
		categoryField = firstField;
		dataCols.shift();
		categoryLabels = selectedRows.map((row) => String(api.getCellValue(row.id, categoryField) ?? ''));
	} else {
		categoryLabels = selectedRows.map((_, i) => `R${i + 1}`);
	}

	let categories: string[];
	let allSeries: ChartSeries[];

	if (!transposed) {
		categories = categoryLabels;
		allSeries = dataCols.map((col) => ({
			name: col.header,
			field: col.field,
			data: selectedRows.map((row) => {
				const val = api.getCellValue(row.id, col.field);
				const n = Number(val);
				return isNaN(n) || val == null || val === '' ? 0 : n;
			}),
		}));
	} else {
		categories = dataCols.map((c) => c.header);
		allSeries = selectedRows.map((row, ri) => {
			const nameVal = categoryField ? String(api.getCellValue(row.id, categoryField) ?? '') : row.label;
			return {
				name: nameVal || row.label,
				field: `row-${ri}`,
				data: dataCols.map((col) => {
					const val = api.getCellValue(row.id, col.field);
					const n = Number(val);
					return isNaN(n) || val == null || val === '' ? 0 : n;
				}),
			};
		});
	}

	const series = allSeries.filter((s) => !disabledSeries[s.field]);
	return { categories, series, allSeries };
}

// ── Inline SVG icons (no external deps) ───────────────────────────────────────

const IBar = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='currentColor'>
		<rect x='1' y='6' width='3' height='7' rx='0.5' />
		<rect x='5.5' y='3' width='3' height='10' rx='0.5' />
		<rect x='10' y='8' width='3' height='5' rx='0.5' />
	</svg>
);
const ILine = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<polyline points='1,11 4,6 7,8 10,3 13,5' />
	</svg>
);
const IArea = () => (
	<svg width='14' height='14' viewBox='0 0 14 14'>
		<polygon fill='currentColor' fillOpacity='0.45' points='1,13 1,8 5,4 9,7 13,3 13,13' />
		<polyline fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' points='1,8 5,4 9,7 13,3' />
	</svg>
);
const IPie = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
		<circle cx='7' cy='7' r='5.5' stroke='currentColor' strokeWidth='1.5' />
		<path d='M7 7 L7 1.5 A5.5 5.5 0 0 1 12.5 7 Z' fill='currentColor' fillOpacity='0.7' />
	</svg>
);
const IScatter = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='currentColor'>
		<circle cx='2.5' cy='10.5' r='1.5' />
		<circle cx='5' cy='5' r='1.5' />
		<circle cx='9' cy='8' r='1.5' />
		<circle cx='12' cy='3' r='1.5' />
	</svg>
);
const IMove = () => (
	<svg width='13' height='13' viewBox='0 0 13 13' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'>
		<line x1='6.5' y1='1' x2='6.5' y2='12' />
		<line x1='1' y1='6.5' x2='12' y2='6.5' />
		<polyline points='4.5,3.5 6.5,1 8.5,3.5' />
		<polyline points='4.5,9.5 6.5,12 8.5,9.5' />
		<polyline points='3.5,4.5 1,6.5 3.5,8.5' />
		<polyline points='9.5,4.5 12,6.5 9.5,8.5' />
	</svg>
);
const IClose = () => (
	<svg width='11' height='11' viewBox='0 0 11 11' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<line x1='1.5' y1='1.5' x2='9.5' y2='9.5' />
		<line x1='9.5' y1='1.5' x2='1.5' y2='9.5' />
	</svg>
);
const IShuffle = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M2 4.5h2.5l5 5H12' />
		<path d='M2 9.5h2.5l5-5H12' />
		<polyline points='10,2.5 12,4.5 10,6.5' />
		<polyline points='10,7.5 12,9.5 10,11.5' />
	</svg>
);
const IStack = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='currentColor'>
		<rect x='1' y='8' width='3' height='5' rx='0.5' />
		<rect x='1' y='4' width='3' height='3.5' rx='0.5' opacity='0.45' />
		<rect x='5.5' y='6' width='3' height='7' rx='0.5' />
		<rect x='5.5' y='3' width='3' height='2.5' rx='0.5' opacity='0.45' />
		<rect x='10' y='10' width='3' height='3' rx='0.5' />
		<rect x='10' y='3' width='3' height='6.5' rx='0.5' opacity='0.45' />
	</svg>
);
const ISmooth = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M1 10 C3.5 10 3.5 4 7 4 C10.5 4 10.5 10 13 10' />
	</svg>
);
const ILabel = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<rect x='1' y='5' width='12' height='6' rx='1.5' />
		<line x1='4' y1='5' x2='4' y2='2' />
		<line x1='10' y1='5' x2='10' y2='2' />
	</svg>
);
const ILegend = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
		<rect x='1' y='4' width='4' height='2' rx='0.5' fill='currentColor' fillOpacity='0.65' />
		<line x1='7' y1='5' x2='13' y2='5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
		<rect x='1' y='8' width='4' height='2' rx='0.5' fill='currentColor' fillOpacity='0.65' />
		<line x1='7' y1='9' x2='13' y2='9' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
	</svg>
);
const IZero = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<line x1='1' y1='11' x2='13' y2='11' />
		<polyline points='5,8 7,5 9,8' />
		<line x1='7' y1='5' x2='7' y2='11' />
	</svg>
);
const IResize = () => (
	<svg width='10' height='10' viewBox='0 0 10 10' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round'>
		<line x1='9' y1='1' x2='1' y2='9' />
		<line x1='9' y1='5' x2='5' y2='9' />
	</svg>
);
const IPalette = () => (
	<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round'>
		<circle cx='6' cy='6' r='4.5' />
		<circle cx='4' cy='4.5' r='1' fill='currentColor' />
		<circle cx='7.5' cy='3.5' r='1' fill='currentColor' />
		<circle cx='8.5' cy='7' r='1' fill='currentColor' />
	</svg>
);
const IChevron = () => (
	<svg width='10' height='10' viewBox='0 0 10 10' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<polyline points='2,3.5 5,6.5 8,3.5' />
	</svg>
);

// ── Layout constants ───────────────────────────────────────────────────────────

const PANEL_W = 168;
const TITLE_H = 44;
const STATS_H = 32;
const SVG_PAD = { top: 20, right: 14, bottom: 44, left: 54 };
const MIN_W = 480;
const MIN_H = 320;

// ── Control button ─────────────────────────────────────────────────────────────

function CtrlBtn({
	active,
	onClick,
	title,
	children,
	small,
}: {
	active?: boolean;
	onClick: () => void;
	title: string;
	children: React.ReactNode;
	small?: boolean;
}) {
	return (
		<button
			title={title}
			onClick={onClick}
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: small ? '4px 6px' : '5px 7px',
				borderRadius: 6,
				border: active ? '1px solid rgba(139,92,246,0.55)' : '1px solid rgba(30,41,59,0.7)',
				background: active ? 'rgba(139,92,246,0.12)' : 'rgba(9,10,15,0.6)',
				color: active ? '#a78bfa' : '#475569',
				cursor: 'pointer',
				fontSize: 9,
				fontWeight: 700,
				transition: 'color 0.12s, background 0.12s, border-color 0.12s',
				gap: 4,
				whiteSpace: 'nowrap',
			}}
		>
			{children}
		</button>
	);
}

// ── Section label ──────────────────────────────────────────────────────────────

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 4,
				fontSize: 8,
				fontWeight: 900,
				color: '#475569',
				textTransform: 'uppercase',
				letterSpacing: '0.08em',
				marginBottom: 5,
			}}
		>
			<span style={{ color: '#7c3aed' }}>{icon}</span>
			{text}
		</div>
	);
}

// ── GridChartOverlay ───────────────────────────────────────────────────────────

export function GridChartOverlay<TRowData>({ api }: { api: GridApi<TRowData> }) {
	// ── Visibility from grid state ──────────────────────────────────────────
	const chartOpen = useGridKeySelector<boolean>('chartOpen', (s) => s.chartOpen ?? false);

	// ── Window position / size ──────────────────────────────────────────────
	const [pos, setPos] = useState({ x: 100, y: 80 });
	const [size, setSize] = useState({ w: 740, h: 460 });

	// ── Chart configuration ─────────────────────────────────────────────────
	const [chartType, setChartType] = useState<ChartType>('bar');
	const [theme, setTheme] = useState<ChartTheme>('cyberpunk');
	const [stacked, setStacked] = useState(false);
	const [smooth, setSmooth] = useState(false);
	const [showLabels, setShowLabels] = useState(false);
	const [showLegend, setShowLegend] = useState(true);
	const [valueFormat, setValueFormat] = useState<ValueFormat>('auto');
	const [transposed, setTransposed] = useState(false);
	const [disabledSeries, setDisabledSeries] = useState<Record<string, boolean>>({});
	const [forceZero, setForceZero] = useState(true);
	const [title, setTitle] = useState('Selection Chart');

	// ── Drag / resize refs ──────────────────────────────────────────────────
	const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
	const resizeRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);

	// ── Selection state ─────────────────────────────────────────────────────
	const selection = useGridKeySelector('selection', (s) => s.selection);
	const bounds = selection?.bounds;

	// ── Live data version ───────────────────────────────────────────────────
	// bounds reference is now stable during live updates (no longer jumps on
	// dataVersion change). Subscribe to dataVersion so the chart re-extracts
	// fresh cell values from the fixed window on every 10hz tick.
	const dataVersion = useGridKeySelector('dataVersion', (s) => s.dataVersion);

	// ── Extract chart data ──────────────────────────────────────────────────
	const { categories, series, allSeries } = useMemo(
		() => {
			if (!chartOpen) return { categories: [], series: [], allSeries: [] };
			return extractData(api, bounds, transposed, disabledSeries);
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[api, bounds, transposed, disabledSeries, dataVersion, chartOpen]
	);

	const colors = THEMES[theme];

	// ── Scale computation ───────────────────────────────────────────────────
	const { minVal, maxVal } = useMemo(() => {
		if (series.length === 0 || categories.length === 0) return { minVal: 0, maxVal: 100 };
		if (chartType === 'pie') return { minVal: 0, maxVal: 1 };

		if (stacked && (chartType === 'bar' || chartType === 'area')) {
			// Stacked: max = max cumulative sum per category
			let maxStack = 0;
			let minStack = 0;
			for (let ci = 0; ci < categories.length; ci++) {
				let posSum = 0,
					negSum = 0;
				for (const s of series) {
					const v = s.data[ci] ?? 0;
					if (v >= 0) posSum += v;
					else negSum += v;
				}
				maxStack = Math.max(maxStack, posSum);
				minStack = Math.min(minStack, negSum);
			}
			return { minVal: forceZero ? Math.min(0, minStack) : minStack, maxVal: Math.ceil(maxStack * 1.08) };
		}

		let max = -Infinity,
			min = Infinity;
		series.forEach((s) =>
			s.data.forEach((v) => {
				if (v > max) max = v;
				if (v < min) min = v;
			})
		);
		if (!isFinite(min)) min = 0;
		if (!isFinite(max)) max = 100;
		const lo = forceZero ? Math.min(0, min) : min;
		const hi = max <= lo ? lo + 100 : Math.ceil(max * 1.08);
		return { minVal: lo, maxVal: hi };
	}, [series, categories, chartType, stacked, forceZero]);

	const valRange = maxVal - minVal || 1;

	// ── SVG dimensions (responsive to overlay size) ─────────────────────────
	const svgW = Math.max(80, size.w - PANEL_W - 28);
	const svgH = Math.max(60, size.h - TITLE_H - STATS_H - 20);
	const chartW = svgW - SVG_PAD.left - SVG_PAD.right;
	const chartH = svgH - SVG_PAD.top - SVG_PAD.bottom;

	// ── Scale helpers ───────────────────────────────────────────────────────
	const getX = useCallback(
		(idx: number) => {
			if (categories.length <= 1) return SVG_PAD.left + chartW / 2;
			return SVG_PAD.left + (idx / (categories.length - 1)) * chartW;
		},
		[categories.length, chartW]
	);
	const getBarX = useCallback(
		(cIdx: number, sIdx: number, nSeries: number) => {
			const slotW = chartW / Math.max(1, categories.length);
			const pad = slotW * 0.15;
			const innerW = slotW - pad;
			const barW = innerW / nSeries;
			return SVG_PAD.left + cIdx * slotW + pad / 2 + sIdx * barW;
		},
		[chartW, categories.length]
	);
	const getBarWidth = useCallback(
		(nSeries: number) => {
			const slotW = chartW / Math.max(1, categories.length);
			const innerW = slotW - slotW * 0.15;
			return Math.max(2, innerW / nSeries - 1.5);
		},
		[chartW, categories.length]
	);
	const getY = useCallback((val: number) => SVG_PAD.top + chartH - ((val - minVal) / valRange) * chartH, [chartH, minVal, valRange]);
	const zeroY = getY(0);

	// ── Drag: title bar ─────────────────────────────────────────────────────
	const onHeaderMouseDown = useCallback(
		(e: React.MouseEvent) => {
			const el = e.target as HTMLElement;
			if (el.closest('button') || el.closest('input')) return;
			e.preventDefault();
			dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };

			const onMove = (ev: MouseEvent) => {
				if (!dragRef.current) return;
				setPos({ x: dragRef.current.px + ev.clientX - dragRef.current.sx, y: dragRef.current.py + ev.clientY - dragRef.current.sy });
			};
			const onUp = () => {
				dragRef.current = null;
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[pos]
	);

	// ── Resize: bottom-right corner ─────────────────────────────────────────
	const onResizeMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			resizeRef.current = { sx: e.clientX, sy: e.clientY, sw: size.w, sh: size.h };

			const onMove = (ev: MouseEvent) => {
				if (!resizeRef.current) return;
				const w = Math.max(MIN_W, resizeRef.current.sw + ev.clientX - resizeRef.current.sx);
				const h = Math.max(MIN_H, resizeRef.current.sh + ev.clientY - resizeRef.current.sy);
				setSize({ w, h });
			};
			const onUp = () => {
				resizeRef.current = null;
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		},
		[size]
	);

	// ── Stats ───────────────────────────────────────────────────────────────
	const stats = useMemo(() => {
		const all = series.flatMap((s) => s.data);
		if (all.length === 0) return null;
		const sum = all.reduce((a, b) => a + b, 0);
		return { sum, avg: sum / all.length, min: Math.min(...all), max: Math.max(...all), count: all.length };
	}, [series]);

	// ── Chart renderers ─────────────────────────────────────────────────────

	const renderEmpty = () => (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: svgW,
				height: svgH,
				color: '#334155',
				fontSize: 11,
				fontWeight: 600,
				border: '1px dashed rgba(30,41,59,0.4)',
				borderRadius: 10,
			}}
		>
			Select cells in the grid to render chart
		</div>
	);

	const renderAxes = () => (
		<g>
			{/* Horizontal grid lines + Y labels */}
			{[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
				const y = SVG_PAD.top + p * chartH;
				const v = maxVal - p * valRange;
				return (
					<g key={i}>
						<line x1={SVG_PAD.left} y1={y} x2={svgW - SVG_PAD.right} y2={y} stroke='rgba(30,41,59,0.35)' strokeWidth='1' />
						<text x={SVG_PAD.left - 6} y={y + 3.5} fill='#475569' fontSize='9' fontWeight='700' textAnchor='end'>
							{fmtVal(v, valueFormat)}
						</text>
					</g>
				);
			})}
			{/* Axis lines */}
			<line x1={SVG_PAD.left} y1={SVG_PAD.top} x2={SVG_PAD.left} y2={SVG_PAD.top + chartH} stroke='#1e293b' strokeWidth='1.5' />
			<line x1={SVG_PAD.left} y1={zeroY} x2={svgW - SVG_PAD.right} y2={zeroY} stroke='#334155' strokeWidth='1.5' />
		</g>
	);

	const renderXLabels = () => (
		<g fill='#475569' fontSize='9' fontWeight='700' textAnchor='middle'>
			{categories.map((cat, i) => {
				const x = chartType === 'bar' ? SVG_PAD.left + (i + 0.5) * (chartW / Math.max(1, categories.length)) : getX(i);
				const label = cat.length > 9 ? `${cat.slice(0, 7)}…` : cat;
				return (
					<text key={i} x={x} y={svgH - SVG_PAD.bottom + 16}>
						{label}
					</text>
				);
			})}
		</g>
	);

	const renderGradDefs = () => (
		<defs>
			{series.map((s, si) => {
				const c = colors[si % colors.length];
				return (
					<linearGradient key={s.field} id={`gg-${s.field}`} x1='0' y1='0' x2='0' y2='1'>
						<stop offset='0%' stopColor={c} stopOpacity='0.35' />
						<stop offset='100%' stopColor={c} stopOpacity='0' />
					</linearGradient>
				);
			})}
		</defs>
	);

	// ── Bar chart ───────────────────────────────────────────────────────────
	const renderBar = () => {
		if (stacked) {
			// Stacked bars: cumulative per category
			const cumPos = categories.map(() => 0);
			const cumNeg = categories.map(() => 0);
			return (
				<g>
					{series.map((s, si) => {
						const c = colors[si % colors.length];
						const slotW = chartW / Math.max(1, categories.length);
						const barW = Math.max(2, slotW - slotW * 0.18);
						return (
							<g key={s.field}>
								{categories.map((_, ci) => {
									const val = s.data[ci] ?? 0;
									const base = val >= 0 ? cumPos[ci] : cumNeg[ci];
									const top = base + val;
									if (val >= 0) cumPos[ci] = top;
									else cumNeg[ci] = top;
									const y1 = getY(Math.max(base, top));
									const y2 = getY(Math.min(base, top));
									const barH = Math.max(1.5, y2 - y1);
									const bx = SVG_PAD.left + ci * slotW + (slotW - barW) / 2;
									return (
										<g key={ci} className='group'>
											<rect
												x={bx}
												y={y1}
												width={barW}
												height={barH}
												rx='2'
												fill={c}
												opacity='0.85'
												style={{ transition: 'opacity 0.12s' }}
											>
												<title>{`${s.name} — ${categories[ci]}: ${fmtVal(val, valueFormat)}`}</title>
											</rect>
											{showLabels && barH > 12 && (
												<text x={bx + barW / 2} y={y1 + 9} fill='#0f172a' fontSize='8' fontWeight='900' textAnchor='middle'>
													{fmtVal(val, valueFormat)}
												</text>
											)}
										</g>
									);
								})}
							</g>
						);
					})}
				</g>
			);
		}

		// Grouped bars
		const n = series.length;
		return (
			<g>
				{series.map((s, si) => {
					const c = colors[si % colors.length];
					const bw = getBarWidth(n);
					return (
						<g key={s.field}>
							{categories.map((_, ci) => {
								const val = s.data[ci] ?? 0;
								const bx = getBarX(ci, si, n);
								const by = val >= 0 ? getY(val) : zeroY;
								const bh = Math.max(1.5, Math.abs(getY(val) - zeroY));
								return (
									<g key={ci} className='group'>
										<rect x={bx} y={by} width={bw} height={bh} rx='2' fill={c} opacity='0.85'>
											<title>{`${s.name} — ${categories[ci]}: ${fmtVal(val, valueFormat)}`}</title>
										</rect>
										{showLabels && bh > 12 && (
											<text x={bx + bw / 2} y={by - 3} fill={c} fontSize='8' fontWeight='900' textAnchor='middle'>
												{fmtVal(val, valueFormat)}
											</text>
										)}
									</g>
								);
							})}
						</g>
					);
				})}
			</g>
		);
	};

	// ── Line / Scatter chart ────────────────────────────────────────────────
	const renderLine = (asScatter = false) => (
		<g>
			{series.map((s, si) => {
				const c = colors[si % colors.length];
				const pts: [number, number][] = s.data.map((v, i) => [getX(i), getY(v)]);
				return (
					<g key={s.field}>
						{!asScatter &&
							(smooth ? (
								<path
									d={smoothPath(pts)}
									fill='none'
									stroke={c}
									strokeWidth='2.2'
									strokeLinecap='round'
									strokeLinejoin='round'
									style={{ filter: `drop-shadow(0 0 3px ${c}55)` }}
								/>
							) : (
								<polyline
									fill='none'
									stroke={c}
									strokeWidth='2.2'
									strokeLinecap='round'
									strokeLinejoin='round'
									points={pts.map((p) => p.join(',')).join(' ')}
									style={{ filter: `drop-shadow(0 0 3px ${c}55)` }}
								/>
							))}
						{pts.map(([cx, cy], i) => (
							<g key={i}>
								<circle
									cx={cx}
									cy={cy}
									r={asScatter ? 4.5 : 3.5}
									fill={asScatter ? c : '#020617'}
									stroke={c}
									strokeWidth={asScatter ? 0 : 1.8}
									opacity={asScatter ? 0.85 : 1}
								>
									<title>{`${s.name} — ${categories[i]}: ${fmtVal(s.data[i] ?? 0, valueFormat)}`}</title>
								</circle>
								{showLabels && (
									<text x={cx} y={cy - 7} fill={c} fontSize='8' fontWeight='800' textAnchor='middle'>
										{fmtVal(s.data[i] ?? 0, valueFormat)}
									</text>
								)}
							</g>
						))}
					</g>
				);
			})}
		</g>
	);

	// ── Area chart ──────────────────────────────────────────────────────────
	const renderArea = () => {
		if (stacked) {
			// Stacked area: each series fills between its line and the previous series' line
			const baselines: [number, number][][] = [categories.map((_, i) => [getX(i), zeroY] as [number, number])];
			const rendered: React.ReactNode[] = [];

			for (let si = 0; si < series.length; si++) {
				const s = series[si];
				const c = colors[si % colors.length];
				const prevBase = baselines[si];
				// Compute cumulative top
				const prevVals = baselines[si].map((_, i) => {
					const gy = prevBase[i][1];
					return minVal + ((SVG_PAD.top + chartH - gy) / chartH) * valRange;
				});
				const currPts: [number, number][] = s.data.map((v, i) => [getX(i), getY(prevVals[i] + v)]);
				baselines.push(currPts);

				const areaPolygon = [...currPts, ...prevBase.slice().reverse()].map((p) => p.join(',')).join(' ');

				rendered.push(
					<g key={s.field}>
						<polygon points={areaPolygon} fill={c} opacity='0.25' />
						{smooth ? (
							<path d={smoothPath(currPts)} fill='none' stroke={c} strokeWidth='1.8' strokeLinecap='round' />
						) : (
							<polyline
								fill='none'
								stroke={c}
								strokeWidth='1.8'
								strokeLinecap='round'
								strokeLinejoin='round'
								points={currPts.map((p) => p.join(',')).join(' ')}
							/>
						)}
					</g>
				);
			}
			return <g>{rendered}</g>;
		}

		// Normal area
		return (
			<g>
				{renderGradDefs()}
				{series.map((s, si) => {
					const c = colors[si % colors.length];
					const pts: [number, number][] = s.data.map((v, i) => [getX(i), getY(v)]);
					const closePoints = [
						[getX(categories.length - 1), zeroY],
						[getX(0), zeroY],
					] as [number, number][];
					const areaPolygon = [...pts, ...closePoints].map((p) => p.join(',')).join(' ');
					return (
						<g key={s.field}>
							<polygon points={areaPolygon} fill={`url(#gg-${s.field})`} />
							{smooth ? (
								<path d={smoothPath(pts)} fill='none' stroke={c} strokeWidth='2' strokeLinecap='round' />
							) : (
								<polyline
									fill='none'
									stroke={c}
									strokeWidth='2'
									strokeLinecap='round'
									strokeLinejoin='round'
									points={pts.map((p) => p.join(',')).join(' ')}
								/>
							)}
						</g>
					);
				})}
			</g>
		);
	};

	// ── Pie chart ───────────────────────────────────────────────────────────
	const renderPie = () => {
		const activeSeries = series[0];
		if (!activeSeries) return null;
		const total = activeSeries.data.reduce((a, b) => a + Math.abs(b), 0);
		if (total === 0) return null;

		const cx = svgW / 2;
		const cy = svgH / 2 - 8;
		const outerR = Math.min(chartW, chartH) / 2.4;
		const innerR = outerR * 0.48; // donut hole

		let acc = 0;
		const slices = activeSeries.data.map((val, i) => {
			const abs = Math.abs(val);
			const startDeg = (acc / total) * 360 - 90;
			const endDeg = ((acc + abs) / total) * 360 - 90;
			acc += abs;
			const toRad = (d: number) => (d * Math.PI) / 180;
			const x1o = cx + outerR * Math.cos(toRad(startDeg));
			const y1o = cy + outerR * Math.sin(toRad(startDeg));
			const x2o = cx + outerR * Math.cos(toRad(endDeg));
			const y2o = cy + outerR * Math.sin(toRad(endDeg));
			const x1i = cx + innerR * Math.cos(toRad(endDeg));
			const y1i = cy + innerR * Math.sin(toRad(endDeg));
			const x2i = cx + innerR * Math.cos(toRad(startDeg));
			const y2i = cy + innerR * Math.sin(toRad(startDeg));
			const large = endDeg - startDeg > 180 ? 1 : 0;
			const path = `M ${x1o} ${y1o} A ${outerR} ${outerR} 0 ${large} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${innerR} ${innerR} 0 ${large} 0 ${x2i} ${y2i} Z`;
			const pct = ((abs / total) * 100).toFixed(1);
			const midDeg = (startDeg + 90 + endDeg + 90) / 2 - 90;
			const lx = cx + ((outerR + innerR) / 2) * Math.cos(toRad(midDeg));
			const ly = cy + ((outerR + innerR) / 2) * Math.sin(toRad(midDeg));
			return { path, pct, lx, ly, label: categories[i] ?? `#${i + 1}`, val, color: colors[i % colors.length] };
		});

		return (
			<g>
				{slices.map((sl, i) => (
					<g key={i}>
						<path d={sl.path} fill={sl.color} opacity='0.85' stroke='rgba(9,10,15,0.6)' strokeWidth='1.5'>
							<title>{`${sl.label}: ${fmtVal(sl.val, valueFormat)} (${sl.pct}%)`}</title>
						</path>
						{parseFloat(sl.pct) > 4 && (
							<text
								x={sl.lx}
								y={sl.ly}
								fill='#f8fafc'
								fontSize='9'
								fontWeight='900'
								textAnchor='middle'
								dominantBaseline='middle'
								style={{ pointerEvents: 'none' }}
							>
								{sl.pct}%
							</text>
						)}
					</g>
				))}
				{/* Center label */}
				<text x={cx} y={cy - 5} fill='#94a3b8' fontSize='10' fontWeight='800' textAnchor='middle'>
					{activeSeries.name}
				</text>
				<text x={cx} y={cy + 9} fill='#64748b' fontSize='8' fontWeight='700' textAnchor='middle'>
					{categories.length} segments
				</text>
				{/* Pie legend at bottom */}
				<g transform={`translate(${SVG_PAD.left}, ${svgH - SVG_PAD.bottom + 10})`}>
					{categories.slice(0, 6).map((cat, i) => (
						<g key={i} transform={`translate(${(i % 3) * (chartW / 3)}, ${Math.floor(i / 3) * 13})`}>
							<rect width='7' height='7' rx='1.5' fill={colors[i % colors.length]} opacity='0.85' />
							<text x='10' y='6.5' fill='#64748b' fontSize='8.5' fontWeight='700'>
								{cat.length > 10 ? `${cat.slice(0, 8)}…` : cat}
							</text>
						</g>
					))}
				</g>
			</g>
		);
	};

	// ── Main chart render ───────────────────────────────────────────────────
	const renderChart = () => {
		if (series.length === 0 || categories.length === 0) return renderEmpty();

		if (chartType === 'pie') {
			return (
				<svg width={svgW} height={svgH} style={{ overflow: 'visible', userSelect: 'none' }}>
					{renderPie()}
				</svg>
			);
		}

		return (
			<svg width={svgW} height={svgH} style={{ overflow: 'visible', userSelect: 'none' }}>
				{renderGradDefs()}
				{renderAxes()}
				{renderXLabels()}
				{chartType === 'bar' && renderBar()}
				{chartType === 'line' && renderLine(false)}
				{chartType === 'area' && renderArea()}
				{chartType === 'scatter' && renderLine(true)}
			</svg>
		);
	};

	// ── Legend strip ────────────────────────────────────────────────────────
	const renderLegend = () => {
		if (!showLegend || series.length === 0 || chartType === 'pie') return null;
		return (
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', padding: '4px 12px 0', alignItems: 'center' }}>
				{series.slice(0, 8).map((s, i) => (
					<div key={s.field} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, color: '#64748b' }}>
						<div style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
						{s.name.length > 14 ? `${s.name.slice(0, 12)}…` : s.name}
					</div>
				))}
			</div>
		);
	};

	// ── Control panel ───────────────────────────────────────────────────────
	const renderControlPanel = () => (
		<div
			style={{
				width: PANEL_W,
				flexShrink: 0,
				borderLeft: '1px solid rgba(15,23,42,0.9)',
				background: 'rgba(7,8,12,0.8)',
				padding: '10px 9px',
				display: 'flex',
				flexDirection: 'column',
				gap: 12,
				overflowY: 'auto',
			}}
		>
			{/* Chart type */}
			<div>
				<SectionLabel icon={<IBar />} text='Chart Type' />
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
					{(
						[
							['bar', <IBar />],
							['line', <ILine />],
							['area', <IArea />],
							['pie', <IPie />],
							['scatter', <IScatter />],
						] as [ChartType, React.ReactNode][]
					).map(([t, icon]) => (
						<CtrlBtn
							key={t}
							active={chartType === t}
							onClick={() => setChartType(t)}
							title={t.charAt(0).toUpperCase() + t.slice(1)}
							small
						>
							{icon}
						</CtrlBtn>
					))}
				</div>
			</div>

			{/* Palette */}
			<div>
				<SectionLabel icon={<IPalette />} text='Palette' />
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
					{(Object.entries(THEMES) as [ChartTheme, string[]][]).map(([t, c]) => (
						<button
							key={t}
							title={t}
							onClick={() => setTheme(t)}
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								gap: 2,
								padding: '4px 3px',
								borderRadius: 6,
								border: theme === t ? '1.5px solid rgba(139,92,246,0.6)' : '1px solid rgba(15,23,42,0.8)',
								background: theme === t ? 'rgba(139,92,246,0.1)' : 'transparent',
								cursor: 'pointer',
							}}
						>
							{c.slice(0, 3).map((col, i) => (
								<div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: col, flexShrink: 0 }} />
							))}
						</button>
					))}
				</div>
			</div>

			{/* Style toggles */}
			<div>
				<SectionLabel icon={<ISmooth />} text='Style' />
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
					{(chartType === 'bar' || chartType === 'area') && (
						<CtrlBtn active={stacked} onClick={() => setStacked((p) => !p)} title='Stack series'>
							<IStack />
							<span>Stacked</span>
						</CtrlBtn>
					)}
					{(chartType === 'line' || chartType === 'area') && (
						<CtrlBtn active={smooth} onClick={() => setSmooth((p) => !p)} title='Smooth bezier curves'>
							<ISmooth />
							<span>Smooth</span>
						</CtrlBtn>
					)}
					<CtrlBtn active={showLabels} onClick={() => setShowLabels((p) => !p)} title='Show data labels'>
						<ILabel />
						<span>Labels</span>
					</CtrlBtn>
					<CtrlBtn active={showLegend} onClick={() => setShowLegend((p) => !p)} title='Show legend'>
						<ILegend />
						<span>Legend</span>
					</CtrlBtn>
					<CtrlBtn active={forceZero} onClick={() => setForceZero((p) => !p)} title='Force zero baseline'>
						<IZero />
						<span>Zero base</span>
					</CtrlBtn>
				</div>
			</div>

			{/* Value format */}
			<div>
				<SectionLabel icon={<IChevron />} text='Format' />
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
					{(['auto', 'km', 'pct', '2dp'] as ValueFormat[]).map((f) => (
						<CtrlBtn key={f} active={valueFormat === f} onClick={() => setValueFormat(f)} title={f} small>
							{f === 'auto' ? 'Auto' : f === 'km' ? 'K/M' : f === 'pct' ? '%' : '0.00'}
						</CtrlBtn>
					))}
				</div>
			</div>

			{/* Data layout */}
			<div>
				<SectionLabel icon={<IShuffle />} text='Data' />
				<CtrlBtn active={transposed} onClick={() => setTransposed((p) => !p)} title='Transpose rows/columns'>
					<IShuffle />
					<span>{transposed ? 'Transposed' : 'Standard'}</span>
				</CtrlBtn>
			</div>

			{/* Series toggles */}
			{allSeries.length > 0 && (
				<div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
					<SectionLabel icon={<ILegend />} text='Series' />
					<div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', maxHeight: 130, paddingRight: 2 }}>
						{allSeries.map((s, i) => {
							const off = !!disabledSeries[s.field];
							return (
								<label
									key={s.field}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 7,
										padding: '4px 6px',
										borderRadius: 6,
										background: 'rgba(9,10,15,0.4)',
										border: '1px solid rgba(15,23,42,0.8)',
										cursor: 'pointer',
										userSelect: 'none',
									}}
								>
									<div
										style={{
											width: 9,
											height: 9,
											borderRadius: 2,
											background: off ? '#1e293b' : colors[i % colors.length],
											flexShrink: 0,
											border: `1.5px solid ${off ? '#334155' : colors[i % colors.length]}`,
										}}
									/>
									<span
										style={{
											fontSize: 9,
											fontWeight: 700,
											color: off ? '#334155' : '#94a3b8',
											flex: 1,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
										title={s.name}
									>
										{s.name}
									</span>
									<input
										type='checkbox'
										checked={!off}
										onChange={() => setDisabledSeries((p) => ({ ...p, [s.field]: !p[s.field] }))}
										style={{ width: 11, height: 11, accentColor: '#7c3aed', cursor: 'pointer', flexShrink: 0 }}
									/>
								</label>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);

	// ── Main overlay ────────────────────────────────────────────────────────

	const content = (
		<div
			style={{
				position: 'fixed',
				left: pos.x,
				top: pos.y,
				width: size.w,
				height: size.h,
				zIndex: 9999,
				display: 'flex',
				flexDirection: 'column',
				borderRadius: 14,
				overflow: 'hidden',
				border: '1px solid rgba(15,23,42,0.95)',
				background: 'rgba(7,8,12,0.93)',
				backdropFilter: 'blur(18px)',
				boxShadow: '0 32px 64px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(139,92,246,0.08)',
				userSelect: 'none',
			}}
		>
			{/* ── Title bar ─────────────────────────────────────────────── */}
			<div
				onMouseDown={onHeaderMouseDown}
				style={{
					height: TITLE_H,
					flexShrink: 0,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '0 12px',
					borderBottom: '1px solid rgba(15,23,42,0.9)',
					background: 'rgba(9,10,15,0.5)',
					cursor: 'move',
					gap: 8,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<span style={{ color: '#334155', flexShrink: 0 }}>
						<IMove />
					</span>
					<input
						type='text'
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						style={{
							background: 'transparent',
							border: 'none',
							outline: 'none',
							fontSize: 12,
							fontWeight: 800,
							color: '#cbd5e1',
							width: 200,
							cursor: 'text',
							borderBottom: '1px solid transparent',
						}}
						onFocus={(e) => (e.target.style.borderBottomColor = '#7c3aed')}
						onBlur={(e) => (e.target.style.borderBottomColor = 'transparent')}
					/>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					{bounds && (
						<span style={{ fontSize: 9, fontWeight: 700, color: '#334155', fontFamily: 'monospace' }}>
							{bounds.maxRow - bounds.minRow + 1}r × {bounds.maxCol - bounds.minCol + 1}c
						</span>
					)}
					<button
						onClick={() => api.closeChart()}
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: 22,
							height: 22,
							borderRadius: 6,
							border: '1px solid rgba(15,23,42,0.9)',
							background: 'transparent',
							color: '#475569',
							cursor: 'pointer',
							padding: 0,
							flexShrink: 0,
						}}
					>
						<IClose />
					</button>
				</div>
			</div>

			{/* ── Body ──────────────────────────────────────────────────── */}
			<div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
				{/* Chart area */}
				<div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
					{renderLegend()}
					<div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px 4px' }}>
						{renderChart()}
					</div>
				</div>
				{/* Control panel */}
				{renderControlPanel()}
			</div>

			{/* ── Stats bar ─────────────────────────────────────────────── */}
			<div
				style={{
					height: STATS_H,
					flexShrink: 0,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '0 12px',
					borderTop: '1px solid rgba(15,23,42,0.9)',
					background: 'rgba(5,7,10,0.5)',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 12,
						fontSize: 9,
						fontWeight: 700,
						fontFamily: 'monospace',
						color: '#334155',
					}}
				>
					{stats ? (
						<>
							<span style={{ color: '#1e293b' }}>•</span>
							<span>
								<span style={{ color: '#475569' }}>Σ </span>
								{fmtVal(stats.sum, valueFormat)}
							</span>
							<span>
								<span style={{ color: '#475569' }}>avg </span>
								{fmtVal(stats.avg, valueFormat)}
							</span>
							<span>
								<span style={{ color: '#475569' }}>min </span>
								{fmtVal(stats.min, valueFormat)}
							</span>
							<span>
								<span style={{ color: '#475569' }}>max </span>
								{fmtVal(stats.max, valueFormat)}
							</span>
							<span style={{ color: '#1e293b' }}>•</span>
							<span style={{ color: '#334155' }}>
								{stats.count} pts · {series.length} series
							</span>
						</>
					) : (
						<span style={{ color: '#1e293b' }}>No selection</span>
					)}
				</div>
				{/* Resize handle */}
				<div
					onMouseDown={onResizeMouseDown}
					style={{ color: '#1e293b', cursor: 'se-resize', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
				>
					<IResize />
				</div>
			</div>
		</div>
	);

	if (!chartOpen || typeof document === 'undefined') return null;
	return createPortal(content, document.body);
}
