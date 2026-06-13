import { GridEventName } from '../store.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { RenderScheduler } from './renderScheduler.js';
import type { LayoutTransitionController } from './layoutTransitionController.js';

export interface RenderInvalidationCoordinatorDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	geometryController: GeometryController<TRowData>;
	portalMountManager: PortalMountManager<TRowData>;
	layoutTransition: LayoutTransitionController<TRowData>;
	scheduler: RenderScheduler;
	syncLayoutPlan: () => void;
	scrollCellIntoView: (rowId: string, colField: string) => void;
	updateCachedGeometryBounds: () => void;
	getIsScrolling: () => boolean;
	getIsScrollFrameActive: () => boolean;
	markFlushPendingAfterScroll: () => void;
	markViewportDirtyAfterScroll: () => void;
}

export class RenderInvalidationCoordinator<TRowData = unknown> {
	private unsubscribers: Array<() => void> = [];

	constructor(private readonly deps: RenderInvalidationCoordinatorDeps<TRowData>) {}

	public bind(): void {
		if (this.unsubscribers.length > 0) return;

		const invalidateFull = () => {
			this.deps.engine.invalidation.invalidateFull('state');
			this.requestFlushGated('state');
		};
		const invalidateHeaders = () => {
			this.deps.engine.invalidation.invalidateHeaders('headers');
			this.requestFlushGated('headers');
		};
		const invalidateOverlay = () => {
			this.deps.engine.invalidation.invalidateOverlay('overlay');
			this.requestFlushGated('overlay');
		};
		const invalidateViewport = () => {
			this.deps.engine.invalidation.invalidateViewport('viewport');
			this.requestViewportFlushOrDefer('viewport');
		};
		const invalidateData = () => {
			this.deps.engine.invalidation.invalidateViewport('data');
			this.requestViewportFlushOrDefer('data');
		};
		const invalidateDefaultColumnGeometry = () => {
			this.deps.geometryController.invalidateAll();
			this.deps.engine.invalidation.invalidateGeometry('columns');
			this.deps.engine.invalidation.invalidateViewport('columns');
			this.deps.engine.invalidation.invalidateHeaders('columns');
			this.deps.updateCachedGeometryBounds();
			this.requestFlushGated('columns');
		};
		const invalidateGeometryFull = () => {
			this.deps.geometryController.invalidateAll();
			this.deps.engine.invalidation.invalidateGeometry('geometry');
			this.deps.engine.invalidation.invalidateViewport('geometry');
			this.deps.updateCachedGeometryBounds();
			this.requestFlushGated('geometry');
		};

		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('defaultRowHeight', invalidateGeometryFull));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('defaultColWidth', invalidateDefaultColumnGeometry));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('globalVersion', invalidateData));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('loading', invalidateViewport));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('visibleRowRange', invalidateViewport));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('visibleColRange', invalidateViewport));

		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('columns', () => {
				this.deps.portalMountManager.releaseAll();
				invalidateFull();
			})
		);
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('columnWidths', invalidateGeometryFull));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('rowHeights', invalidateGeometryFull));
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('enableColumnReorder', invalidateHeaders));
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('sortModel', () => {
				this.deps.layoutTransition.captureSnapshot();
			})
		);
		// Expansion (group, tree, and master-detail all mutate state.expansion) — snapshot
		// the pre-toggle row positions so the resulting reveal/hide animates. Fires before
		// the toggle's invalidation flush, so slot.lastTop still holds the old layout.
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('expansion', () => {
				this.deps.layoutTransition.captureSnapshot();
			})
		);
		this.unsubscribers.push(this.deps.engine.stateManager.subscribeToKey('activeEdit', invalidateOverlay));
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
				if (selection?.focus && selection.source !== 'pointer') {
					this.deps.scrollCellIntoView(selection.focus.rowId, selection.focus.colField);
				}
				this.requestFlushGated('selection');
			})
		);
		this.unsubscribers.push(
			this.deps.engine.eventBus.addEventListener(GridEventName.rowSelectionChanged, () => {
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
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('showGroupPanel', () => {
				this.deps.syncLayoutPlan();
				this.scheduleGeometryPaint('showGroupPanel');
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
		this.deps.scheduler.requestFlush(reason);
	}

	private requestFlushGated(reason: string): void {
		if (this.isScrollActive()) {
			this.deps.markFlushPendingAfterScroll();
			return;
		}
		this.deps.scheduler.requestFlush(reason);
	}

	private isScrollActive(): boolean {
		return (
			this.deps.getIsScrolling() || this.deps.engine.isScrolling || this.deps.getIsScrollFrameActive() || this.deps.engine.isScrollFrameActive
		);
	}
}
