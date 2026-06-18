import { GridEventName } from '../api/GridEvents.js';
import { GridMetric } from '../diagnostics/GridInstrumentation.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { FrameCoordinator } from './frameCoordinator.js';
import type { LayoutTransitionController } from './layoutTransitionController.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';

export interface RenderInvalidationCoordinatorDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	geometryController: GeometryController<TRowData>;
	portalMountManager: PortalMountManager<TRowData>;
	layoutTransition: LayoutTransitionController<TRowData>;
	frameCoordinator: FrameCoordinator;
	runtimeState: RenderRuntimeState;
	syncLayoutPlan: () => void;
	scrollCellIntoView: (rowId: string, colField: string) => void;
	resetScroll: () => void;
	updateCachedGeometryBounds: () => void;
	markFlushPendingAfterScroll: () => void;
	markViewportDirtyAfterScroll: () => void;
}

export class RenderInvalidationCoordinator<TRowData = unknown> {
	private unsubscribers: Array<() => void> = [];

	constructor(private readonly deps: RenderInvalidationCoordinatorDeps<TRowData>) {}

	public bind(): void {
		if (this.unsubscribers.length > 0) return;

		const invalidateFull = () => {
			this.recordLegacyInferredInvalidation('columns');
			this.deps.engine.invalidation.invalidateFull('state');
			this.requestFlushGated('state');
		};
		const invalidateViewport = () => {
			this.recordLegacyInferredInvalidation('visible-range');
			this.deps.engine.invalidation.invalidateViewport('viewport');
			this.requestViewportFlushOrDefer('viewport');
		};
		const invalidateData = () => {
			this.recordLegacyInferredInvalidation('globalVersion');
			this.deps.engine.invalidation.invalidateViewport('data');
			this.requestViewportFlushOrDefer('data');
		};
		const invalidateDefaultColumnGeometry = () => {
			this.recordLegacyInferredInvalidation('defaultColWidth');
			this.deps.geometryController.invalidateAll();
			this.deps.engine.invalidation.invalidateGeometry('columns');
			this.deps.engine.invalidation.invalidateViewport('columns');
			this.deps.engine.invalidation.invalidateHeaders('columns');
			this.deps.updateCachedGeometryBounds();
			this.requestFlushGated('columns');
		};
		const invalidateGeometryFull = (trigger: string) => {
			this.recordLegacyInferredInvalidation(trigger);
			this.deps.geometryController.invalidateAll();
			this.deps.engine.invalidation.invalidateGeometry('geometry');
			this.deps.engine.invalidation.invalidateViewport('geometry');
			this.deps.updateCachedGeometryBounds();
			this.requestFlushGated('geometry');
		};

		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('defaultRowHeight', () => invalidateGeometryFull('defaultRowHeight')));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('defaultColWidth', invalidateDefaultColumnGeometry));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('globalVersion', invalidateData));
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('loading', () => {
				this.recordLegacyInferredInvalidation('loading');
				this.deps.engine.invalidation.invalidateViewport('viewport');
				this.requestViewportFlushOrDefer('viewport');
			})
		);
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('visibleRowRange', () => {
				invalidateViewport();
			})
		);
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('visibleColRange', () => {
				invalidateViewport();
			})
		);

		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('columns', () => {
				this.deps.portalMountManager.releaseAll();
				invalidateFull();
			})
		);
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('columnWidths', () => invalidateGeometryFull('columnWidths')));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('rowHeights', () => invalidateGeometryFull('rowHeights')));
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('sortModel', () => {
				this.deps.layoutTransition.captureSnapshot('sort');
			})
		);
		// Expansion (group, tree, and master-detail all mutate state.expansion) — snapshot
		// the pre-toggle row positions so the resulting reveal/hide animates. Fires before
		// the toggle's invalidation flush, so slot.lastTop still holds the old layout.
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('expansion', () => {
				this.deps.layoutTransition.captureSnapshot('expansion');
			})
		);
		// Column pin/unpin — geometry owns the layout change; paint may add a subtle
		// semantic transition after the new pinned lanes are already committed.
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('pinnedColumns', () => {
				this.recordLegacyInferredInvalidation('pinnedColumns');
				this.deps.geometryController.invalidateAll();
				this.deps.engine.invalidation.invalidateGeometry('pin');
				this.deps.engine.invalidation.invalidateViewport('pin');
				this.deps.engine.invalidation.invalidateHeaders('pin');
				this.deps.updateCachedGeometryBounds();
				this.requestFlushGated('pin');
			})
		);
		// Client pagination page change — reset scroll to the top of the new page. The row
		// model re-runs the pipeline with the new window on the same event; this just keeps
		// the viewport from showing the middle of the freshly-sliced page.
		this.unsubscribers.push(this.deps.engine.eventBus.addEventListener(GridEventName.paginationChanged, () => this.deps.resetScroll()));
		this.unsubscribers.push(
			this.deps.engine.eventBus.addEventListener(GridEventName.selectionChanged, (event) => {
				const { result, selection } = event.payload;
				for (const cell of result.invalidatedCells) {
					this.deps.engine.invalidation.invalidateCell(cell.rowId, cell.colField, 'selection');
				}
				for (const rowId of result.invalidatedRows) {
					this.deps.engine.invalidation.invalidateRow(rowId, 'selection');
				}
				if (result.overlayChanged) {
					this.deps.engine.invalidation.invalidateOverlay('selection');
				}
				// Focused column changed — repaint headers so og-header-cell-col-focus updates.
				this.deps.engine.invalidation.invalidateHeaders('selection');
				if (selection?.focus && selection.source !== 'pointer') {
					this.deps.scrollCellIntoView(selection.focus.rowId, selection.focus.colField);
				}
				this.requestFlushGated('selection');
			})
		);
		this.unsubscribers.push(
			this.deps.engine.eventBus.addEventListener(GridEventName.cellInvalidated, () => {
				this.requestFlushGated('cell');
			})
		);
		this.unsubscribers.push(
			this.deps.engine.eventBus.addEventListener(GridEventName.columnResized, (event) => {
				this.deps.geometryController.invalidateColumns([event.payload.colField]);
				this.requestFlushGated('column resize');
			})
		);
		this.unsubscribers.push(
			this.deps.engine.eventBus.addEventListener(GridEventName.rowResized, (event) => {
				this.deps.geometryController.invalidateRows([event.payload.rowId]);
				this.requestFlushGated('row resize');
			})
		);
		this.unsubscribers.push(
			this.deps.engine.eventBus.addEventListener(GridEventName.renderInvalidated, (event) => {
				this.requestFlushGated(event.payload.reason);
			})
		);
	}

	public destroy(): void {
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	public schedulePaint(): void {
		this.scheduleFullPaint('api');
	}

	public scheduleFullPaint(reason = 'api'): void {
		this.deps.engine.invalidation.invalidateFull(reason);
		this.requestFlushGated(reason);
	}

	public scheduleViewportPaint(reason = 'viewport'): void {
		this.deps.engine.invalidation.invalidateViewport(reason);
		this.requestFlushGated(reason);
	}

	public scheduleHeaderPaint(reason = 'headers'): void {
		this.deps.engine.invalidation.invalidateHeaders(reason);
		this.requestFlushGated(reason);
	}

	public scheduleOverlayPaint(reason = 'overlay'): void {
		this.deps.engine.invalidation.invalidateOverlay(reason);
		this.requestFlushGated(reason);
	}

	public scheduleCellPaint(rowId: string, colId: string, reason = 'cell'): void {
		this.deps.engine.invalidation.invalidateCell(rowId, colId, reason);
		this.requestFlushGated(reason);
	}

	public scheduleRowPaint(rowId: string, reason = 'row'): void {
		this.deps.engine.invalidation.invalidateRow(rowId, reason);
		this.requestFlushGated(reason);
	}

	public scheduleColumnPaint(colId: string, reason = 'column'): void {
		this.deps.engine.invalidation.invalidateColumn(colId, reason);
		this.requestFlushGated(reason);
	}

	public scheduleGeometryPaint(reason = 'geometry'): void {
		this.deps.geometryController.invalidateAll();
		this.deps.engine.invalidation.invalidateGeometry(reason);
		this.deps.engine.invalidation.invalidateViewport(reason);
		this.deps.engine.invalidation.invalidateHeaders(reason);
		this.requestFlushGated(reason);
	}

	private requestViewportFlushOrDefer(reason: string): void {
		if (this.isScrollActive()) {
			this.deps.markViewportDirtyAfterScroll();
			return;
		}
		this.deps.frameCoordinator.requestPaintFrame();
	}

	private requestFlushGated(reason: string): void {
		if (this.isScrollActive()) {
			this.deps.markFlushPendingAfterScroll();
			return;
		}
		this.deps.frameCoordinator.requestPaintFrame();
	}

	private isScrollActive(): boolean {
		return this.deps.runtimeState.isScrolling();
	}

	private recordLegacyInferredInvalidation(trigger: string): void {
		this.deps.engine.instrumentation.increment(GridMetric.LEGACY_INFERRED_INVALIDATIONS);
		this.deps.engine.instrumentation.recordFallback({
			component: 'RenderInvalidationCoordinator',
			reason: `legacy-inferred-invalidation:${trigger}`,
		});
	}
}
