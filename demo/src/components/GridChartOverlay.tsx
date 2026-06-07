import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { BarChart, LineChart, PieChart, X, Move, Shuffle, Palette, LayoutGrid, Type, ChevronDown, Check } from 'lucide-react';
import type { GridApi } from '@open-grid/react';
import { useGridSelector } from '@open-grid/react';

interface GridChartOverlayProps {
	api: GridApi<any>;
	onClose: () => void;
}

type ChartType = 'bar' | 'line' | 'area' | 'pie';
type ChartTheme = 'cyberpunk' | 'emerald' | 'plasma' | 'gold';

interface ChartSeries {
	name: string;
	field: string;
	data: number[];
}

export function GridChartOverlay({ api, onClose }: GridChartOverlayProps) {
	// Selection bounds subscription
	const selection = useGridSelector((state) => state.selection);
	const bounds = selection.bounds;

	// Floating window position state
	const [position, setPosition] = useState({ x: 100, y: 120 });
	const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

	// User customizable chart configuration
	const [chartType, setChartType] = useState<ChartType>('bar');
	const [theme, setTheme] = useState<ChartTheme>('cyberpunk');
	const [chartTitle, setChartTitle] = useState('Selection Analytics');
	const [isTransposed, setIsTransposed] = useState(false);
	const [disabledSeries, setDisabledSeries] = useState<Record<string, boolean>>({});

	// Theme color mapping definition (harmonic HSL colors for neon strokes/fills)
	const themeColors = useMemo(() => {
		switch (theme) {
			case 'cyberpunk':
				return ['#06b6d4', '#ec4899', '#3b82f6', '#a855f7', '#f43f5e'];
			case 'emerald':
				return ['#10b981', '#34d399', '#059669', '#6ee7b7', '#a7f3d0'];
			case 'plasma':
				return ['#8b5cf6', '#f59e0b', '#d97706', '#c084fc', '#fbbf24'];
			case 'gold':
				return ['#f59e0b', '#facc15', '#b45309', '#fef08a', '#ca8a04'];
		}
	}, [theme]);

	// Extract data and columns from active selection bounds
	const rawData = useMemo(() => {
		if (!bounds) return { categories: [], series: [] };

		const state = api.getState();
		const columns = state.columns || [];

		// 1. Gather all selected rows
		const selectedRows: any[] = [];
		for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
			const vr = api.getVisualRow(r);
			if (vr?.kind === 'data') {
				const rowData = api.getDataRowAtVisualIndex(r);
				if (rowData) {
					selectedRows.push({
						id: vr.rowId,
						data: rowData,
						label: `Row ${r + 1}`,
					});
				}
			}
		}

		// 2. Gather all selected columns
		const selectedCols: any[] = [];
		for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
			const col = columns[c];
			if (col) {
				selectedCols.push({
					field: col.field,
					header: col.header || col.field,
				});
			}
		}

		if (selectedRows.length === 0 || selectedCols.length === 0) {
			return { categories: [], series: [] };
		}

		// 3. Auto-detect category column
		// If the first selected column is not purely numeric, we treat it as categories (labels).
		// Otherwise we use row index labels.
		let categoryField = '';
		const firstColField = selectedCols[0].field;
		let isFirstColText = false;

		for (const row of selectedRows) {
			const val = api.getCellValue(row.id, firstColField);
			if (val !== null && val !== undefined && val !== '' && isNaN(Number(val))) {
				isFirstColText = true;
				break;
			}
		}

		const dataCols = [...selectedCols];
		let categoryLabels: string[] = [];

		if (isFirstColText && selectedCols.length > 1) {
			categoryField = firstColField;
			dataCols.shift(); // Remove category column from numeric series
			categoryLabels = selectedRows.map((row) => String(api.getCellValue(row.id, categoryField) ?? ''));
		} else {
			categoryLabels = selectedRows.map((row) => row.label);
		}

		// 4. Extract numeric data values
		let categories = categoryLabels;
		let series: ChartSeries[] = [];

		if (!isTransposed) {
			// Normal: columns are series, rows are categories (x-axis points)
			series = dataCols.map((col) => {
				const data = selectedRows.map((row) => {
					const val = api.getCellValue(row.id, col.field);
					const num = Number(val);
					return isNaN(num) || val === null || val === '' || typeof val === 'boolean' ? 0 : num;
				});
				return {
					name: col.header,
					field: col.field,
					data,
				};
			});
		} else {
			// Transposed: rows are series, columns are categories (x-axis points)
			categories = dataCols.map((col) => col.header);
			series = selectedRows.map((row) => {
				const data = dataCols.map((col) => {
					const val = api.getCellValue(row.id, col.field);
					const num = Number(val);
					return isNaN(num) || val === null || val === '' || typeof val === 'boolean' ? 0 : num;
				});
				// Use the category text field value if present for series name
				const nameVal = categoryField ? String(api.getCellValue(row.id, categoryField) ?? '') : row.label;
				return {
					name: nameVal || row.label,
					field: row.id,
					data,
				};
			});
		}

		// Filter active series based on user checkbox selectors
		const activeSeries = series.filter((s) => !disabledSeries[s.field]);

		return { categories, series: activeSeries, allSeries: series };
	}, [bounds, isTransposed, disabledSeries, api]);

	const { categories, series, allSeries } = rawData;

	// Draggable title bar mouse handlers
	const handleHeaderMouseDown = (e: React.MouseEvent) => {
		if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
		e.preventDefault();
		dragRef.current = {
			startX: e.clientX,
			startY: e.clientY,
			posX: position.x,
			posY: position.y,
		};
		document.addEventListener('mousemove', handleGlobalMouseMove);
		document.addEventListener('mouseup', handleGlobalMouseUp);
	};

	const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
		if (!dragRef.current) return;
		const deltaX = e.clientX - dragRef.current.startX;
		const deltaY = e.clientY - dragRef.current.startY;
		setPosition({
			x: dragRef.current.posX + deltaX,
			y: dragRef.current.posY + deltaY,
		});
	}, []);

	const handleGlobalMouseUp = useCallback(() => {
		dragRef.current = null;
		document.removeEventListener('mousemove', handleGlobalMouseMove);
		document.removeEventListener('mouseup', handleGlobalMouseUp);
	}, [handleGlobalMouseMove]);

	useEffect(() => {
		return () => {
			document.removeEventListener('mousemove', handleGlobalMouseMove);
			document.removeEventListener('mouseup', handleGlobalMouseUp);
		};
	}, [handleGlobalMouseMove, handleGlobalMouseUp]);

	// Calculate SVG geometry values
	const svgPadding = { top: 50, right: 30, bottom: 45, left: 55 };
	const svgWidth = 460;
	const svgHeight = 280;
	const chartWidth = svgWidth - svgPadding.left - svgPadding.right;
	const chartHeight = svgHeight - svgPadding.top - svgPadding.bottom;

	// Aggregate min/max values for scaling axes
	const { minVal, maxVal } = useMemo(() => {
		if (series.length === 0) return { minVal: 0, maxVal: 100 };
		let max = -Infinity;
		let min = Infinity;
		series.forEach((s) => {
			s.data.forEach((val) => {
				if (val > max) max = val;
				if (val < min) min = val;
			});
		});
		// Ensure baseline handles negative values gracefully
		if (min > 0) min = 0;
		if (max <= min) max = min + 100;
		return { minVal: min, maxVal: Math.ceil(max * 1.05) };
	}, [series]);

	const valRange = maxVal - minVal;

	// Scale mapping helper functions
	const getX = (index: number) => {
		if (categories.length <= 1) return svgPadding.left + chartWidth / 2;
		return svgPadding.left + (index / (categories.length - 1)) * chartWidth;
	};

	const getY = (value: number) => {
		const pct = (value - minVal) / valRange;
		return svgPadding.top + chartHeight - pct * chartHeight;
	};

	const zeroY = getY(0);

	// Custom SVG rendering components
	const renderChartContent = () => {
		if (series.length === 0 || categories.length === 0) {
			return (
				<div className='flex items-center justify-center h-[280px] w-full text-slate-500 font-medium text-xs border border-slate-900 bg-slate-950/40 rounded-xl'>
					Select numeric cells in the grid to render chart
				</div>
			);
		}

		if (chartType === 'pie') {
			// Pie Chart uses single series (the first active series selected)
			const activeSeries = series[0];
			const dataPoints = activeSeries.data;
			const total = dataPoints.reduce((a, b) => a + Math.abs(b), 0);

			if (total === 0) {
				return (
					<div className='flex items-center justify-center h-[280px] w-full text-slate-500 font-medium text-xs'>
						Select positive numeric values for Pie Chart
					</div>
				);
			}

			const cx = svgWidth / 2;
			const cy = svgHeight / 2 - 10;
			const radius = 80;

			let accumulatedAngle = 0;

			return (
				<svg width={svgWidth} height={svgHeight} className='select-none overflow-visible'>
					<g>
						{dataPoints.map((val, idx) => {
							const absVal = Math.abs(val);
							const angle = (absVal / total) * 360;
							const startAngleRad = (accumulatedAngle - 90) * (Math.PI / 180);
							const endAngleRad = (accumulatedAngle + angle - 90) * (Math.PI / 180);

							const x1 = cx + radius * Math.cos(startAngleRad);
							const y1 = cy + radius * Math.sin(startAngleRad);
							const x2 = cx + radius * Math.cos(endAngleRad);
							const y2 = cy + radius * Math.sin(endAngleRad);

							const largeArc = angle > 180 ? 1 : 0;
							const pathData = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

							const color = themeColors[idx % themeColors.length];
							accumulatedAngle += angle;

							const percent = ((absVal / total) * 100).toFixed(0);

							// Place percent label in the center of the arc slice
							const labelAngleRad = (accumulatedAngle - angle / 2 - 90) * (Math.PI / 180);
							const lx = cx + radius * 0.65 * Math.cos(labelAngleRad);
							const ly = cy + radius * 0.65 * Math.sin(labelAngleRad);

							return (
								<g key={idx} className='group cursor-pointer'>
									<path
										d={pathData}
										fill={color}
										opacity={0.8}
										className='transition-all duration-300 hover:opacity-100 hover:scale-105 origin-center'
										style={{ transformOrigin: `${cx}px ${cy}px` }}
										stroke='#020617'
										strokeWidth={1.5}
									/>
									{percent !== '0' && (
										<text
											x={lx}
											y={ly}
											fill='#020617'
											fontSize='9'
											fontWeight='900'
											textAnchor='middle'
											dominantBaseline='middle'
											className='pointer-events-none'
										>
											{percent}%
										</text>
									)}
									<title>{`${categories[idx] ?? `Point ${idx}`}: ${val} (${percent}%)`}</title>
								</g>
							);
						})}
					</g>
					{/* Pie chart legend */}
					<g transform={`translate(${svgPadding.left}, ${svgHeight - 35})`}>
						{categories.slice(0, 5).map((cat, idx) => {
							const xOffset = (idx % 3) * 135;
							const yOffset = Math.floor(idx / 3) * 15;
							return (
								<g key={idx} transform={`translate(${xOffset}, ${yOffset})`}>
									<rect width='8' height='8' rx='2' fill={themeColors[idx % themeColors.length]} />
									<text x='14' y='7' fill='#94a3b8' fontSize='9' fontWeight='700'>
										{cat.length > 15 ? `${cat.slice(0, 12)}...` : cat}
									</text>
								</g>
							);
						})}
					</g>
				</svg>
			);
		}

		return (
			<svg width={svgWidth} height={svgHeight} className='select-none overflow-visible'>
				<defs>
					{/* Dynamic gradient definitions for Area and glowing Line charts */}
					{series.map((s, sIdx) => {
						const color = themeColors[sIdx % themeColors.length];
						return (
							<linearGradient key={s.field} id={`grad-${s.field}`} x1='0' y1='0' x2='0' y2='1'>
								<stop offset='0%' stopColor={color} stopOpacity={0.4} />
								<stop offset='100%' stopColor={color} stopOpacity={0.0} />
							</linearGradient>
						);
					})}
				</defs>

				{/* Grid background lines */}
				<g stroke='rgba(30,41,59,0.4)' strokeWidth='1'>
					{[0, 0.25, 0.5, 0.75, 1].map((p, idx) => {
						const y = svgPadding.top + p * chartHeight;
						const valLabel = maxVal - p * valRange;
						return (
							<g key={idx}>
								<line x1={svgPadding.left} y1={y} x2={svgWidth - svgPadding.right} y2={y} />
								<text
									x={svgPadding.left - 8}
									y={y + 3}
									fill='#64748b'
									fontSize='9'
									fontWeight='700'
									textAnchor='end'
									className='font-mono'
								>
									{valLabel.toFixed(0)}
								</text>
							</g>
						);
					})}
				</g>

				{/* Axis lines */}
				<line
					x1={svgPadding.left}
					y1={svgPadding.top}
					x2={svgPadding.left}
					y2={svgPadding.top + chartHeight}
					stroke='#334155'
					strokeWidth='1.5'
				/>
				<line x1={svgPadding.left} y1={zeroY} x2={svgWidth - svgPadding.right} y2={zeroY} stroke='#334155' strokeWidth='1.5' />

				{/* X-Axis category labels */}
				<g fill='#64748b' fontSize='9' fontWeight='700' textAnchor='middle'>
					{categories.map((cat, idx) => {
						// For lines, place label directly under point. For bars, center within slot.
						const x = chartType === 'bar' ? svgPadding.left + (idx + 0.5) * (chartWidth / categories.length) : getX(idx);
						return (
							<text key={idx} x={x} y={svgHeight - svgPadding.bottom + 18} className='origin-center'>
								{cat.length > 8 ? `${cat.slice(0, 6)}...` : cat}
							</text>
						);
					})}
				</g>

				{/* Actual Chart Series Content */}
				{chartType === 'bar' && (
					<g>
						{categories.map((_, cIdx) => {
							const slotWidth = chartWidth / categories.length;
							const slotPadding = slotWidth * 0.2;
							const activeSlotWidth = slotWidth - slotPadding;
							const barWidth = activeSlotWidth / series.length;
							const startX = svgPadding.left + cIdx * slotWidth + slotPadding / 2;

							return series.map((s, sIdx) => {
								const val = s.data[cIdx] || 0;
								const barX = startX + sIdx * barWidth;
								const barY = val >= 0 ? getY(val) : zeroY;
								const barH = Math.max(2, Math.abs(getY(val) - zeroY));
								const color = themeColors[sIdx % themeColors.length];

								return (
									<g key={`${s.field}-${cIdx}`} className='group cursor-pointer'>
										<rect
											x={barX}
											y={barY}
											width={Math.max(3, barWidth - 1.5)}
											height={barH}
											rx={2}
											fill={color}
											opacity={0.85}
											className='transition-all duration-300 hover:opacity-100 hover:brightness-110'
										/>
										<title>{`${s.name} - ${categories[cIdx]}: ${val}`}</title>
									</g>
								);
							});
						})}
					</g>
				)}

				{chartType === 'line' &&
					series.map((s, sIdx) => {
						const color = themeColors[sIdx % themeColors.length];
						const points = s.data.map((val, idx) => `${getX(idx)},${getY(val)}`).join(' ');
						return (
							<g key={s.field}>
								<polyline
									fill='none'
									stroke={color}
									strokeWidth='2.5'
									points={points}
									className='transition-all duration-300'
									strokeLinecap='round'
									strokeLinejoin='round'
									style={{ filter: `drop-shadow(0 0 3px ${color}55)` }}
								/>
								{/* Data point indicator circles */}
								{s.data.map((val, idx) => (
									<circle
										key={idx}
										cx={getX(idx)}
										cy={getY(val)}
										r='4'
										fill='#020617'
										stroke={color}
										strokeWidth='2'
										className='cursor-pointer hover:r-5 transition-all duration-150'
									>
										<title>{`${s.name} - ${categories[idx]}: ${val}`}</title>
									</circle>
								))}
							</g>
						);
					})}

				{chartType === 'area' &&
					series.map((s, sIdx) => {
						const color = themeColors[sIdx % themeColors.length];
						const linePoints = s.data.map((val, idx) => `${getX(idx)},${getY(val)}`);
						const areaPoints = [`${getX(0)},${zeroY}`, ...linePoints, `${getX(categories.length - 1)},${zeroY}`].join(' ');

						return (
							<g key={s.field}>
								{/* Area fill */}
								<polygon fill={`url(#grad-${s.field})`} points={areaPoints} className='transition-all duration-300' />
								{/* Area boundary line */}
								<polyline
									fill='none'
									stroke={color}
									strokeWidth='2'
									points={linePoints.join(' ')}
									className='transition-all duration-300'
									strokeLinecap='round'
									strokeLinejoin='round'
								/>
							</g>
						);
					})}
			</svg>
		);
	};

	return (
		<div
			style={{
				position: 'absolute',
				left: `${position.x}px`,
				top: `${position.y}px`,
				zIndex: 1000,
			}}
			className='flex h-[380px] w-[640px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/85 backdrop-blur shadow-2xl transition-all duration-200'
		>
			{/* LEFT: SVG Rendering & Title bar */}
			<div className='flex flex-col flex-1 min-w-0'>
				{/* DRAGGABLE TITLE BAR */}
				<div
					onMouseDown={handleHeaderMouseDown}
					className='flex items-center justify-between border-b border-slate-900 bg-slate-950/40 px-4 py-3 cursor-move select-none shrink-0'
				>
					<div className='flex items-center gap-2'>
						<Move className='h-3.5 w-3.5 text-slate-500' />
						<input
							type='text'
							value={chartTitle}
							onChange={(e) => setChartTitle(e.target.value)}
							className='bg-transparent border-b border-transparent hover:border-slate-800 focus:border-purple-500 text-xs font-black text-slate-200 outline-none w-48'
						/>
					</div>
					<button onClick={onClose} className='rounded p-1 text-slate-500 hover:bg-slate-900 hover:text-slate-200 transition'>
						<X className='h-4 w-4' />
					</button>
				</div>

				{/* CHART GRAPHICS AREA */}
				<div className='flex-1 min-h-0 flex items-center justify-center p-4 relative'>{renderChartContent()}</div>
			</div>

			{/* RIGHT: CONFIGURATION CONTROL SIDEBAR PANEL */}
			<div className='w-44 border-l border-slate-900 bg-slate-950/60 p-3 flex flex-col gap-4 overflow-y-auto shrink-0 select-none'>
				{/* 1. Chart Type Selector */}
				<div className='flex flex-col gap-1.5'>
					<div className='text-[8px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1'>
						<LayoutGrid className='w-3 h-3 text-purple-400' />
						Chart Type
					</div>
					<div className='grid grid-cols-2 gap-1.5'>
						{(['bar', 'line', 'area', 'pie'] as ChartType[]).map((type) => {
							const Icon = type === 'bar' ? BarChart : type === 'line' ? LineChart : type === 'area' ? Shuffle : PieChart;
							return (
								<button
									key={type}
									onClick={() => setChartType(type)}
									className={`flex items-center justify-center p-2 rounded-lg border transition ${
										chartType === type
											? 'border-purple-500 bg-purple-500/10 text-purple-300'
											: 'border-slate-900 bg-slate-950 hover:border-slate-800 text-slate-400 hover:text-slate-200'
									}`}
									title={type.toUpperCase()}
								>
									<Icon className='w-4 h-4' />
								</button>
							);
						})}
					</div>
				</div>

				{/* 2. Color Palette Theme Selector */}
				<div className='flex flex-col gap-1.5'>
					<div className='text-[8px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1'>
						<Palette className='w-3 h-3 text-purple-400' />
						Color Palette
					</div>
					<div className='grid grid-cols-2 gap-1.5'>
						{(['cyberpunk', 'emerald', 'plasma', 'gold'] as ChartTheme[]).map((t) => (
							<button
								key={t}
								onClick={() => setTheme(t)}
								className={`flex items-center justify-center px-1.5 py-1 text-[9px] font-black uppercase rounded-lg border transition ${
									theme === t
										? 'border-purple-500 bg-purple-500/10 text-purple-300'
										: 'border-slate-900 bg-slate-950 hover:border-slate-800 text-slate-400'
								}`}
							>
								{t}
							</button>
						))}
					</div>
				</div>

				{/* 3. Data Orientation Transpose */}
				<div className='flex flex-col gap-1.5'>
					<div className='text-[8px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1'>
						<Shuffle className='w-3 h-3 text-purple-400' />
						Data Layout
					</div>
					<button
						onClick={() => setIsTransposed((p) => !p)}
						className={`flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg border text-[9px] font-black uppercase transition ${
							isTransposed
								? 'border-purple-500 bg-purple-500/10 text-purple-300'
								: 'border-slate-900 bg-slate-950 hover:border-slate-800 text-slate-400 hover:text-slate-200'
						}`}
					>
						<Shuffle className='w-3.5 h-3.5' />
						{isTransposed ? 'Transposed' : 'Standard'}
					</button>
				</div>

				{/* 4. Column Series Filters (Checkbox List) */}
				{allSeries && allSeries.length > 0 && (
					<div className='flex flex-col gap-1.5 flex-1 min-h-0'>
						<div className='text-[8px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1'>
							<Check className='w-3 h-3 text-purple-400' />
							Toggle Series
						</div>
						<div className='flex flex-col gap-1.5 overflow-y-auto max-h-[120px] pr-1'>
							{allSeries.map((s) => {
								const isDisabled = !!disabledSeries[s.field];
								return (
									<label
										key={s.field}
										className='flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-900 hover:border-slate-800 cursor-pointer select-none transition'
									>
										<input
											type='checkbox'
											checked={!isDisabled}
											onChange={() =>
												setDisabledSeries((prev) => ({
													...prev,
													[s.field]: !prev[s.field],
												}))
											}
											className='rounded border-slate-800 text-purple-600 focus:ring-purple-500/20 w-3 h-3 bg-slate-950 cursor-pointer'
										/>
										<span className='text-[9px] font-bold text-slate-300 truncate w-24' title={s.name}>
											{s.name}
										</span>
									</label>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
