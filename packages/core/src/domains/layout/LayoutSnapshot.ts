import type { ColumnLayout } from '../columns/ColumnLayout.js';
import type { RowHeightModel } from './RowHeightModel.js';

/**
 * The geometry the renderer paints against (ARCHITECTURE.md §3 R12). A pure projection of the row
 * height model + column layout — no business state, no DOM. Row geometry is delegated to the
 * {@link RowHeightModel} so a snapshot stays cheap regardless of row count.
 */
export class LayoutSnapshot {
	constructor(
		private readonly rows: RowHeightModel,
		readonly columns: ColumnLayout
	) {}

	get rowCount(): number {
		return this.rows.getRowCount();
	}

	get totalHeight(): number {
		return this.rows.getTotalHeight();
	}

	get totalWidth(): number {
		return this.columns.totalWidth;
	}

	getRowTop(index: number): number {
		return this.rows.getRowTop(index);
	}

	getRowHeight(index: number): number {
		return this.rows.getRowHeight(index);
	}

	rowIndexAtY(y: number): number {
		return this.rows.rowIndexAtY(y);
	}
}
