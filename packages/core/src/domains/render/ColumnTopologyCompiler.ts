import type { RenderColumn } from './RendererEngineView.js';

export type ColumnLane = 'left' | 'center' | 'right';

export interface ColumnPlacement {
	columnId: string;
	field: string;
	header: string;
	lane: ColumnLane;
	laneIndex: number;
	absoluteIndex: number;
	absoluteLeft: number;
	laneLeft: number;
	width: number;
	sortable: boolean;
	sortDirection: 'asc' | 'desc' | null;
}

export interface CompiledColumnTopology {
	placements: ColumnPlacement[];
	byColumnId: Map<string, ColumnPlacement>;
	leftPlacements: ColumnPlacement[];
	centerPlacements: ColumnPlacement[];
	rightPlacements: ColumnPlacement[];
	pinLeftWidth: number;
	pinRightWidth: number;
	pinRightBaseLeft: number;
	totalContentWidth: number;
	version: number;
}

export function compileColumnTopology(columns: readonly RenderColumn[], version: number): CompiledColumnTopology {
	const placements: ColumnPlacement[] = [];
	const byColumnId = new Map<string, ColumnPlacement>();
	const leftPlacements: ColumnPlacement[] = [];
	const centerPlacements: ColumnPlacement[] = [];
	const rightPlacements: ColumnPlacement[] = [];

	let laneLeftIdx = 0;
	let laneCenterIdx = 0;
	let laneRightIdx = 0;

	let pinLeftWidth = 0;
	let pinRightWidth = 0;
	let pinRightBaseLeft = 0;
	let totalContentWidth = 0;

	// First pass: compute lane widths and pinRightBaseLeft
	for (const col of columns) {
		if (col.lane === 'left') {
			pinLeftWidth += col.width;
		} else if (col.lane === 'right') {
			pinRightWidth += col.width;
			if (pinRightBaseLeft === 0 || col.left < pinRightBaseLeft) {
				pinRightBaseLeft = col.left;
			}
		}
		const rightEdge = col.left + col.width;
		if (rightEdge > totalContentWidth) {
			totalContentWidth = rightEdge;
		}
	}

	// If no right-pinned columns, pinRightBaseLeft stays 0
	if (pinRightWidth === 0) {
		pinRightBaseLeft = 0;
	}

	// Second pass: build placements
	for (let i = 0; i < columns.length; i++) {
		const col = columns[i];
		const absoluteLeft = col.left;
		const width = col.width;
		const lane = col.lane;

		let laneIndex: number;
		let laneLeft: number;

		if (lane === 'left') {
			laneIndex = laneLeftIdx++;
			laneLeft = absoluteLeft;
		} else if (lane === 'right') {
			laneIndex = laneRightIdx++;
			laneLeft = absoluteLeft - pinRightBaseLeft;
		} else {
			laneIndex = laneCenterIdx++;
			laneLeft = absoluteLeft - pinLeftWidth;
		}

		const placement: ColumnPlacement = {
			columnId: col.columnId,
			field: col.field,
			header: col.header,
			lane,
			laneIndex,
			absoluteIndex: i,
			absoluteLeft,
			laneLeft,
			width,
			sortable: col.sortable,
			sortDirection: col.sortDirection,
		};

		placements.push(placement);
		byColumnId.set(col.columnId, placement);

		if (lane === 'left') {
			leftPlacements.push(placement);
		} else if (lane === 'center') {
			centerPlacements.push(placement);
		} else {
			rightPlacements.push(placement);
		}
	}

	return {
		placements,
		byColumnId,
		leftPlacements,
		centerPlacements,
		rightPlacements,
		pinLeftWidth,
		pinRightWidth,
		pinRightBaseLeft,
		totalContentWidth,
		version,
	};
}
