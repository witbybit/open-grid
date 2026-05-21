import React from 'react';
import { useGridDimensions } from '@open-grid/react';
import { Cell, PerformanceRow } from './GridShared';
import { ServerRowModelController } from '@open-grid/core';

export interface RecycledGridViewportProps {
	pinLeftColumns?: number;
	pinRightColumns?: number;
	className?: string;
	onCellValueChanged?: (rowId: string, colField: string, val: unknown) => void;
	serverController?: ServerRowModelController<PerformanceRow>;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

interface ColumnData {
	index: number;
	field: string;
	header: string;
	left: number;
	width: number;
}

interface RowData {
	index: number;
	id: string;
	top: number;
	height: number;
}

interface PinnedLeftRowProps {
	row: RowData;
	cols: ColumnData[];
	api: any;
	navigation: any;
}

interface PinnedRightRowProps {
	row: RowData;
	cols: ColumnData[];
	api: any;
	navigation: any;
}

interface CenterRowProps {
	row: RowData;
	cols: ColumnData[];
	leftPinnedWidth: number;
	api: any;
	navigation: any;
}

// ----------------------------------------------------------------------
// 1. Grouped and Memoized Row Components
// ----------------------------------------------------------------------

const PinnedLeftRow = React.memo(({ row, cols, api, navigation }: PinnedLeftRowProps) => {
	return (
		<div
			className='absolute left-0 right-0 border-b border-slate-900/60 bg-slate-950/95'
			style={{
				top: row.top,
				height: row.height,
			}}
		>
			{cols.map((col) => (
				<div
					key={col.field}
					className='absolute top-0 bottom-0 border-r border-slate-900/60'
					style={{
						left: col.left,
						width: col.width,
					}}
				>
					<Cell rowId={row.id} colField={col.field} api={api} navigation={navigation} />
				</div>
			))}
		</div>
	);
});
PinnedLeftRow.displayName = 'PinnedLeftRow';

const PinnedRightRow = React.memo(({ row, cols, api, navigation }: PinnedRightRowProps) => {
	return (
		<div
			className='absolute left-0 right-0 border-b border-slate-900/60 bg-slate-950/95'
			style={{
				top: row.top,
				height: row.height,
			}}
		>
			{cols.map((col) => (
				<div
					key={col.field}
					className='absolute top-0 bottom-0 border-r border-slate-900/60'
					style={{
						left: col.left,
						width: col.width,
					}}
				>
					<Cell rowId={row.id} colField={col.field} api={api} navigation={navigation} />
				</div>
			))}
		</div>
	);
});
PinnedRightRow.displayName = 'PinnedRightRow';

const CenterRow = React.memo(({ row, cols, leftPinnedWidth, api, navigation }: CenterRowProps) => {
	return (
		<div
			className='absolute left-0 right-0 border-b border-slate-900/60 bg-slate-950 hover:bg-slate-900/10'
			style={{
				top: row.top,
				height: row.height,
				width: '100%',
			}}
		>
			{cols.map((col) => (
				<div
					key={col.field}
					className='absolute top-0 bottom-0 border-r border-slate-900/60'
					style={{
						left: col.left - leftPinnedWidth,
						width: col.width,
					}}
				>
					<Cell rowId={row.id} colField={col.field} api={api} navigation={navigation} />
				</div>
			))}
		</div>
	);
});
CenterRow.displayName = 'CenterRow';

// ----------------------------------------------------------------------
// 2. High-Performance 2D Recycled Viewport
// ----------------------------------------------------------------------

export function RecycledGridViewport({
	pinLeftColumns = 0,
	pinRightColumns = 0,
	className = '',
	onCellValueChanged,
	serverController,
	editTrigger = 'doubleClick',
	arrowKeyNavigationEdit = false,
}: RecycledGridViewportProps) {
	// Consume our single cohesive headless hook
	const {
		viewportRef,
		scrollerRef,
		containerRef,
		headerRef,
		pinnedLeftRef,
		pinnedRightRef,
		horizontalScrollerRef,
		totalWidth,
		totalHeight,
		leftPinnedWidth,
		rightPinnedWidth,
		columns,
		scrollState,
		dimensions,
		leftPinnedCols,
		rightPinnedCols,
		centerCols,
		visibleRows,
		api,
		navigation,
		handleHeaderResizeMouseDown,
	} = useGridDimensions({
		pinLeftColumns,
		pinRightColumns,
		serverController,
		enableNavigation: true,
		navigationOptions: {
			editTrigger,
			arrowKeyNavigationEdit,
			onCellValueChanged,
		},
	});

	// Outer scrollable center width: center width matches the available space between pinned lanes
	const innerCenterWidth = Math.max(0, totalWidth - leftPinnedWidth - rightPinnedWidth);

	return (
		<div
			className={`flex flex-col w-full h-full bg-slate-950 text-slate-300 font-sans select-none border border-slate-800/80 rounded-xl overflow-hidden shadow-[0_20px_50px_rgba(15,10,30,0.6)] backdrop-blur-md relative ${className}`}
		>
			{/* ---------------------------------------------------------------------- */}
			{/* 1. Grid Header Container (Sleek Dark Mode Header) */}
			{/* ---------------------------------------------------------------------- */}
			<div
				className='relative flex flex-row overflow-hidden border-b border-slate-800/60 bg-slate-900/90 text-slate-200 font-semibold uppercase tracking-wider text-xs z-30 shadow-[0_2px_10px_rgba(0,0,0,0.3)]'
				style={{ height: 40 }}
			>
				{/* Pinned Left Header Lane */}
				{pinLeftColumns > 0 && (
					<div
						className='absolute left-0 top-0 bottom-0 border-r border-slate-800 bg-slate-900/95 z-25 overflow-hidden flex flex-row shadow-[4px_0_10px_rgba(0,0,0,0.2)]'
						style={{ width: leftPinnedWidth }}
					>
						{leftPinnedCols.map((col) => (
							<div
								key={`h-pin-l-${col.field}`}
								className='absolute h-full flex items-center px-4 border-r border-slate-800/40 bg-slate-900/90 text-slate-400 select-none truncate group'
								style={{ left: col.left, width: col.width }}
							>
								<span className='truncate text-slate-300 font-bold tracking-wider'>{col.header}</span>
								<div
									onMouseDown={(e) => handleHeaderResizeMouseDown(col.field, col.width, e)}
									className='absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-purple-500/80 bg-transparent hover:opacity-100 transition-colors z-20 group-hover:bg-slate-800'
								/>
							</div>
						))}
					</div>
				)}

				{/* Scrollable Center Header Lane */}
				<div
					ref={headerRef}
					className='absolute top-0 bottom-0 overflow-hidden flex flex-row'
					style={{
						left: leftPinnedWidth,
						right: rightPinnedWidth,
					}}
				>
					<div className='relative h-full' style={{ width: innerCenterWidth }}>
						{centerCols.map((col) => (
							<div
								key={`h-center-${col.field}`}
								className='absolute h-full flex items-center px-4 border-r border-slate-800/40 text-slate-400 select-none truncate group'
								style={{
									left: col.left - leftPinnedWidth,
									width: col.width,
								}}
							>
								<span className='truncate text-slate-300 font-bold tracking-wider'>{col.header}</span>
								<div
									onMouseDown={(e) => handleHeaderResizeMouseDown(col.field, col.width, e)}
									className='absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-purple-500/80 bg-transparent hover:opacity-100 transition-colors z-20 group-hover:bg-slate-800'
								/>
							</div>
						))}
					</div>
				</div>

				{/* Pinned Right Header Lane */}
				{pinRightColumns > 0 && (
					<div
						className='absolute right-0 top-0 bottom-0 border-l border-slate-800 bg-slate-900/95 z-25 overflow-hidden flex flex-row shadow-[-4px_0_10px_rgba(0,0,0,0.2)]'
						style={{ width: rightPinnedWidth }}
					>
						{rightPinnedCols.map((col) => (
							<div
								key={`h-pin-r-${col.field}`}
								className='absolute h-full flex items-center px-4 border-r border-slate-800/40 bg-slate-900/90 text-slate-400 select-none truncate group'
								style={{ left: col.left, width: col.width }}
							>
								<span className='truncate text-slate-300 font-bold tracking-wider'>{col.header}</span>
								<div
									onMouseDown={(e) => handleHeaderResizeMouseDown(col.field, col.width, e)}
									className='absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-purple-500/80 bg-transparent hover:opacity-100 transition-colors z-20 group-hover:bg-slate-800'
								/>
							</div>
						))}
					</div>
				)}
			</div>

			{/* ---------------------------------------------------------------------- */}
			{/* 2. Grid Body Area (Single-scroller sticky-pinned layout) */}
			{/* ---------------------------------------------------------------------- */}
			<div ref={viewportRef} className='relative flex-1 overflow-hidden'>
				<div
					ref={scrollerRef}
					tabIndex={0}
					className='absolute inset-0 overflow-auto bg-slate-950 scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-800/80 outline-none animate-fade-in'
				>
					<div
						className='relative flex flex-row'
						style={{
							minWidth: '100%',
							width: totalWidth,
							height: totalHeight,
						}}
					>
						{/* Pinned Left Cells Lane */}
						{pinLeftColumns > 0 && (
							<div
								className='sticky left-0 top-0 bottom-0 z-20 border-r border-slate-850 bg-slate-950 shadow-[4px_0_15px_rgba(0,0,0,0.4)] shrink-0 overflow-hidden'
								style={{
									width: leftPinnedWidth,
									height: totalHeight,
								}}
							>
								{visibleRows.map((row) => (
									<PinnedLeftRow key={row.id} row={row} cols={leftPinnedCols} api={api} navigation={navigation} />
								))}
							</div>
						)}

						{/* Scrollable Center Cells Lane */}
						<div
							className='relative grow shrink-0'
							style={{
								width: innerCenterWidth,
								height: totalHeight,
							}}
						>
							{visibleRows.map((row) => (
								<CenterRow key={row.id} row={row} cols={centerCols} leftPinnedWidth={leftPinnedWidth} api={api} navigation={navigation} />
							))}
						</div>

						{/* Pinned Right Cells Lane */}
						{pinRightColumns > 0 && (
							<div
								className='sticky right-0 top-0 bottom-0 z-20 border-l border-slate-850 bg-slate-950 shadow-[-4px_0_15px_rgba(0,0,0,0.4)] shrink-0 overflow-hidden'
								style={{
									width: rightPinnedWidth,
									height: totalHeight,
								}}
							>
								{visibleRows.map((row) => (
									<PinnedRightRow key={row.id} row={row} cols={rightPinnedCols} api={api} navigation={navigation} />
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
