import type { GridDomainId } from '../../kernel/GridDomain.js';
import type { GridEventListener } from '../../kernel/GridEvent.js';
import type { ColumnId } from '../columns/ColumnId.js';
import type { ColumnLane } from '../columns/ColumnLayout.js';
import type { LayoutSnapshot } from '../layout/LayoutSnapshot.js';
import type { VisualModelView } from '../pipeline/VisualModel.js';
import type { VisualRow } from '../pipeline/VisualRow.js';
import type { RowId } from '../rows/RowId.js';
import type { VisibleWindow } from '../viewport/VisibleWindow.js';
import type { ViewportSnapshot } from '../viewport/ViewportModel.js';

/** A visible column as the renderer paints it — header text, lane, geometry, live sort direction. */
export interface RenderColumn {
	readonly columnId: ColumnId;
	readonly field: string;
	readonly header: string;
	readonly lane: ColumnLane;
	readonly left: number;
	readonly width: number;
	readonly sortable: boolean;
	readonly sortDirection: 'asc' | 'desc' | null;
}

/**
 * The clean read surface the DOM renderer consumes from the new engine (ARCHITECTURE.md §3 R12).
 * Replaces the renderer's direct reads of the old engine's internals (`geometry.rowTops` arrays,
 * `columns.getCompiledPlan()`, `invalidation.consume()`, `stateManager.getState()`). The renderer
 * keeps all its DOM/slot/layer/scroll/portal machinery and reads only through this view; it never
 * mutates business state.
 */
export interface RendererEngineView<TRow> {
	// structure
	getVisualRowCount(): number;
	getVisualRow(index: number): VisualRow<TRow> | null;
	getVisualModel(): VisualModelView<TRow>;

	// geometry (row tops/heights, column lefts/widths, pinned lanes, totals)
	getGeometry(): LayoutSnapshot;

	// columns (header descriptors for the visible columns)
	getColumns(): readonly RenderColumn[];

	// viewport / visible window (runtime)
	getViewport(): ViewportSnapshot;
	getVisibleWindow(): VisibleWindow;

	// cell display value
	getCellDisplayValue(rowId: RowId, field: string): unknown;

	// selection / editing read
	isRowSelected(rowId: RowId): boolean;

	// change signal + invalidation
	subscribe(listener: GridEventListener): () => void;
	getVersion(domain: GridDomainId): number;
}
