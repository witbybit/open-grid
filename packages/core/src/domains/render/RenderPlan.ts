import type { ColumnId } from '../columns/ColumnId.js';
import type { ColumnLane } from '../columns/ColumnLayout.js';
import type { LayoutSnapshot } from '../layout/LayoutSnapshot.js';
import type { RowId, VisualRowId } from '../rows/RowId.js';
import type { VisualModel } from '../pipeline/VisualModel.js';
import { isDataVisualRow } from '../pipeline/VisualRow.js';
import type { VisualRow } from '../pipeline/VisualRow.js';
import type { VisibleWindow } from '../viewport/VisibleWindow.js';

export interface CellRenderPlan {
	readonly columnId: ColumnId;
	readonly field: string;
	readonly lane: ColumnLane;
	readonly left: number;
	readonly width: number;
	readonly value: unknown;
}

export interface RowRenderPlan {
	readonly visualRowId: VisualRowId;
	readonly rowId: RowId | null;
	readonly kind: VisualRow['kind'];
	readonly top: number;
	readonly height: number;
	readonly cells: readonly CellRenderPlan[];
}

/**
 * The complete description of what to paint (ARCHITECTURE.md §3 R12). Derived purely from the
 * visual model + layout snapshot + visible window. The renderer applies this; it reaches into no
 * row model and recomputes no business state.
 */
export interface RenderPlan {
	readonly rows: readonly RowRenderPlan[];
	readonly firstIndex: number;
	readonly lastIndex: number;
	readonly totalHeight: number;
	readonly totalWidth: number;
}

export interface BuildRenderPlanOptions {
	/** Resolve a column's data field. Defaults to the column id (the columns domain supplies the real map). */
	readonly getField?: (columnId: ColumnId) => string;
	/** Resolve a cell's display value. Omit for structure-only plans (no values). */
	readonly getCellValue?: (rowId: RowId, field: string) => unknown;
}

export const EMPTY_RENDER_PLAN: RenderPlan = { rows: [], firstIndex: 0, lastIndex: -1, totalHeight: 0, totalWidth: 0 };

/**
 * Build the render plan for the rows in `window`. Each windowed visual row becomes a row plan with
 * absolute `top`/`height`; data rows additionally get one cell plan per visible column with the
 * column's lane/left/width and resolved value.
 */
export function buildRenderPlan<TRow>(
	visual: VisualModel<TRow>,
	layout: LayoutSnapshot,
	window: VisibleWindow,
	options: BuildRenderPlanOptions = {},
): RenderPlan {
	const rows: RowRenderPlan[] = [];
	const last = Math.min(window.lastIndex, visual.count - 1);

	for (let index = window.firstIndex; index <= last; index++) {
		const visualRow = visual.getByVisualIndex(index);
		if (!visualRow) continue;

		const cells: CellRenderPlan[] = [];
		if (isDataVisualRow(visualRow)) {
			for (const col of layout.columns.entries) {
				const field = options.getField ? options.getField(col.columnId) : String(col.columnId);
				cells.push({
					columnId: col.columnId,
					field,
					lane: col.lane,
					left: col.left,
					width: col.width,
					value: options.getCellValue ? options.getCellValue(visualRow.rowId, field) : undefined,
				});
			}
		}

		rows.push({
			visualRowId: visualRow.visualRowId,
			rowId: isDataVisualRow(visualRow) ? visualRow.rowId : null,
			kind: visualRow.kind,
			top: layout.getRowTop(index),
			height: layout.getRowHeight(index),
			cells,
		});
	}

	return {
		rows,
		firstIndex: window.firstIndex,
		lastIndex: last,
		totalHeight: layout.totalHeight,
		totalWidth: layout.totalWidth,
	};
}
