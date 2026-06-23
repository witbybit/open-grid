import type { ColumnId } from './ColumnId.js';
import type { ColumnModel } from './ColumnModel.js';

export type ColumnLane = 'left' | 'center' | 'right';

export interface ColumnLayoutEntry {
	readonly columnId: ColumnId;
	readonly lane: ColumnLane;
	/** Left offset in pixels within the column's lane. */
	readonly left: number;
	readonly width: number;
}

/**
 * Derived layout snapshot for the columns (ARCHITECTURE.md §3 R6, R12). A pure projection of the
 * column model: visible columns split into pinned-left / center / pinned-right lanes, each with
 * running left offsets. The renderer consumes this; it computes none of it itself.
 */
export interface ColumnLayout {
	readonly entries: readonly ColumnLayoutEntry[];
	readonly leftWidth: number;
	readonly centerWidth: number;
	readonly rightWidth: number;
	readonly totalWidth: number;
}

export function computeColumnLayout<TRow>(model: ColumnModel<TRow>): ColumnLayout {
	const lefts: ColumnLayoutEntry[] = [];
	const centers: ColumnLayoutEntry[] = [];
	const rights: ColumnLayoutEntry[] = [];
	let leftX = 0;
	let centerX = 0;
	let rightX = 0;

	for (const columnId of model.getVisibleColumnIds()) {
		const width = model.getWidth(columnId) ?? 0;
		const pinned = model.getPinned(columnId);
		if (pinned === 'left') {
			lefts.push({ columnId, lane: 'left', left: leftX, width });
			leftX += width;
		} else if (pinned === 'right') {
			rights.push({ columnId, lane: 'right', left: rightX, width });
			rightX += width;
		} else {
			centers.push({ columnId, lane: 'center', left: centerX, width });
			centerX += width;
		}
	}

	return {
		entries: [...lefts, ...centers, ...rights],
		leftWidth: leftX,
		centerWidth: centerX,
		rightWidth: rightX,
		totalWidth: leftX + centerX + rightX,
	};
}
