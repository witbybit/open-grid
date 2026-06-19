import { GridEventName } from '../api/GridEvents.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { FrameCoordinator } from './frameCoordinator.js';
import type { GeometryController } from './geometryController.js';
import type { LayoutTransitionController } from './layoutTransitionController.js';
import type { PortalMountManager } from './portalMountManager.js';
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

		this.unsubscribers.push(
			this.deps.engine.eventBus.addEventListener(GridEventName.sortChanged, () => {
				this.deps.layoutTransition.captureSnapshot('sort');
			})
		);
		// Expansion (group, tree, and master-detail all mutate state.expansion) needs the
		// pre-toggle row positions so the subsequent viewport flush can animate from the old layout.
		this.unsubscribers.push(
			this.deps.engine.stateManager.subscribeToKey('expansion', () => {
				this.deps.layoutTransition.captureSnapshot('expansion');
			})
		);
		// Client pagination page change: reset scroll to the top of the new page while the row
		// model re-runs the pipeline for the new window on the same event.
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
}
