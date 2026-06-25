import type { GridDomainId } from '../../kernel/GridDomain.js';
import type { GridEventListener } from '../../kernel/GridEvent.js';
import type { ColumnId } from '../columns/ColumnId.js';
import type { ColumnLane } from '../columns/ColumnLayout.js';
import type { LayoutSnapshot } from '../layout/LayoutSnapshot.js';
import type { GroupByModel } from '../pipeline/GroupModel.js';
import type { FilterModel } from '../pipeline/PipelineModels.js';
import type { GridIntegrityIssue } from '../integrity/ValidationRules.js';
import type { VisualModelView } from '../pipeline/VisualModel.js';
import type { VisualRow } from '../pipeline/VisualRow.js';
import type { RowId } from '../rows/RowId.js';
import type { VisibleWindow } from '../viewport/VisibleWindow.js';
import type { ViewportSnapshot } from '../viewport/ViewportModel.js';

/**
 * Display/chrome configuration the renderer's layout reads (replaces the old renderer's reads of
 * `stateManager.getState()` for these flags). Explicit accessors, not a state blob.
 */
export interface RenderDisplayConfig {
	readonly defaultRowHeight: number;
	readonly defaultColWidth: number;
	readonly showGroupPanel: boolean;
	readonly showFilterChipBar: boolean;
	readonly showFloatingFilters: boolean;
	readonly showStatusBar: boolean;
	readonly enableColumnReorder: boolean;
	readonly loading: boolean;
}

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

	// display/chrome config (header lanes, status bar, floating filters, defaults, loading)
	getDisplayConfig(): RenderDisplayConfig;

	// geometry (row tops/heights, column lefts/widths, pinned lanes, totals)
	getGeometry(): LayoutSnapshot;

	// columns (header descriptors for the visible columns)
	getColumns(): readonly RenderColumn[];

	// viewport / visible window (runtime)
	getViewport(): ViewportSnapshot;
	getVisibleWindow(): VisibleWindow;

	// active pipeline models (for chrome: floating filters, filter chips, group panel)
	getFilterModel(): FilterModel;
	getGroupBy(): GroupByModel;

	// cell display value
	getCellDisplayValue(rowId: RowId, field: string): unknown;

	// cell validation issue (null = valid or no rule registered)
	getCellIssue(rowId: RowId, field: string): GridIntegrityIssue | null;

	// selection / editing read
	isRowSelected(rowId: RowId): boolean;

	// change signal + invalidation
	subscribe(listener: GridEventListener): () => void;
	getVersion(domain: GridDomainId): number;

	// Viewport write-back — the renderer is the sole producer of scroll/size state.
	// These bypass the kernel (scroll is not undoable business state) and update the
	// viewport model directly so computeVisibleWindow returns a fresh window next paint.
	setScroll(scrollTop: number, scrollLeft: number): void;
	setSize(width: number, height: number): void;
}
