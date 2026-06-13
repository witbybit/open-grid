import type { GridEngine } from '../engine/GridEngine.js';
import type { GridCellPointer, GridCellClassParams, VisualRow } from '../store.js';
import type { CellRenderer } from './cellRenderer.js';
import { CellSlot } from './cellSlot.js';
import type { FullWidthRowRenderer } from './fullWidthRowRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type { PortalMountManager } from './portalMountManager.js';
import { bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import {
	bindAllDataCells,
	bindAllLoadingCells,
	type BindAllDataCellsRequest,
	type BindAllLoadingCellsRequest,
	type RowCellBindingLaneDeps,
} from './rowCellBindingLanes.js';
import {
	decorateDirtyCellsAfterScroll as decorateDirtyCellsAfterScrollMaintenance,
	repaintInvalidatedRowsAndCells as repaintInvalidatedRowsAndCellsMaintenance,
	type RowCellBindRequest,
	type RowRenderMaintenanceDeps,
} from './rowRenderMaintenance.js';
import type { RowSlot } from './rowSlot.js';
import type { RenderWindow } from './renderWindow.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';

export interface RowRendererRuntimeArgs<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	cellRenderer: CellRenderer;
	portalMountManager: PortalMountManager<TRowData>;
	viewportContainer: HTMLElement | null | undefined;
	selectionPaint: SelectionPaintManager<TRowData>;
	cellClassScratch: GridCellClassParams<TRowData>;
	fullWidthRenderer: FullWidthRowRenderer<TRowData>;
	currentWindow: RenderWindow | null;
	dirtyCellsAfterScroll: Set<HTMLDivElement>;
	dirtyRowsAfterScroll: Set<number>;
	dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]];
	activeRows: Map<number, RowSlot<TRowData>>;
	initCell: (el: HTMLDivElement) => void;
	releaseCellFn: (cell: CellSlot<TRowData>) => void;
	ensurePinnedContainer: (slot: RowSlot<TRowData>, side: 'left' | 'right', width: number) => HTMLDivElement | null;
	releaseRowPortal: (slot: RowSlot<TRowData>) => boolean;
	ensureCellPortalHost: (cell: HTMLDivElement) => HTMLDivElement;
	getCellPortalHost: (cell: HTMLDivElement) => HTMLDivElement | null;
	markCellDirtyAfterScroll: (cell: HTMLDivElement) => void;
	releaseCellPortal: (cell: HTMLDivElement, forceDeferred?: boolean, reason?: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated') => void;
	cancelPendingPortalRelease: (cellKey: string) => void;
	applyFocus: (cell: HTMLDivElement) => void;
	isEditorInteractiveElement: (el: Element | null) => boolean;
	isScrolling: boolean;
	isScrollFrameActive: boolean;
	renderStats: any;
	programmaticScrollCell: GridCellPointer | null;
	clearProgrammaticScrollCell: () => void;
	setDeferredFocusCell: (cell: HTMLDivElement) => void;
	incrementStyleHookCallsDuringScroll: () => void;
	incrementCellsBoundDuringScroll: () => void;
	incrementCurrentScrollCellsVisited: () => void;
	incrementCurrentScrollCellsPatched: () => void;
	incrementCurrentScrollCellsWritten: () => void;
	incrementPostScrollDirtyCellsDecorated: () => void;
}

export interface RowRendererRuntimeBridgeDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	cellRenderer: CellRenderer;
	portalMountManager: PortalMountManager<TRowData>;
	getViewportContainer: () => HTMLElement | null | undefined;
	selectionPaint: SelectionPaintManager<TRowData>;
	cellClassScratch: GridCellClassParams<TRowData>;
	getFullWidthRenderer: () => FullWidthRowRenderer<TRowData>;
	getCurrentWindow: () => RenderWindow | null;
	dirtyCellsAfterScroll: Set<HTMLDivElement>;
	dirtyRowsAfterScroll: Set<number>;
	dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]];
	activeRows: Map<number, RowSlot<TRowData>>;
	initCell: (el: HTMLDivElement) => void;
	releaseCellFn: (cell: CellSlot<TRowData>) => void;
	ensurePinnedContainer: (slot: RowSlot<TRowData>, side: 'left' | 'right', width: number) => HTMLDivElement | null;
	releaseRowPortal: (slot: RowSlot<TRowData>) => boolean;
	getIsScrolling: () => boolean;
	getIsScrollFrameActive: () => boolean;
	getRenderStats: () => any;
	getProgrammaticScrollCell: () => GridCellPointer | null;
	clearProgrammaticScrollCell: () => void;
	setDeferredFocusCell: (cell: HTMLDivElement | null) => void;
	incrementStyleHookCallsDuringScroll: () => void;
	incrementCellsBoundDuringScroll: () => void;
	incrementCurrentScrollCellsVisited: () => void;
	incrementCurrentScrollCellsPatched: () => void;
	incrementCurrentScrollCellsWritten: () => void;
	incrementPostScrollDirtyCellsDecorated: () => void;
	incrementDirtyCellsMarkedDuringScroll: () => void;
	incrementCurrentScrollPortalOps: () => void;
	pendingPortalReleasesAfterScroll: Map<string, unknown>;
}

function createRowCellBinderDeps<TRowData>(args: RowRendererRuntimeArgs<TRowData>): RowCellBinderDeps<TRowData> {
	return {
		engine: args.engine,
		cellRenderer: args.cellRenderer,
		portalMountManager: args.portalMountManager,
		selectionPaint: args.selectionPaint,
		cellClassScratch: args.cellClassScratch,
		getViewportContainer: () => args.viewportContainer,
		getIsScrolling: () => args.isScrolling,
		getIsScrollFrameActive: () => args.isScrollFrameActive,
		getProgrammaticScrollCell: () => args.programmaticScrollCell,
		clearProgrammaticScrollCell: args.clearProgrammaticScrollCell,
		setDeferredFocusCell: args.setDeferredFocusCell,
		applyFocus: args.applyFocus,
		isEditorInteractiveElement: args.isEditorInteractiveElement,
		ensureCellPortalHost: args.ensureCellPortalHost,
		getCellPortalHost: args.getCellPortalHost,
		markCellDirtyAfterScroll: args.markCellDirtyAfterScroll,
		releaseCellPortal: args.releaseCellPortal,
		cancelPendingPortalRelease: args.cancelPendingPortalRelease,
		incrementStyleHookCallsDuringScroll: () => {
			if (args.renderStats) args.renderStats.styleHookCallsDuringScroll++;
		},
		incrementCellsBoundDuringScroll: () => {
			if (args.renderStats) args.renderStats.cellsBoundDuringScroll = (args.renderStats.cellsBoundDuringScroll || 0) + 1;
		},
		incrementCurrentScrollCellsWritten: () => {
			args.incrementCurrentScrollCellsWritten();
		},
	};
}

function createRowRenderMaintenanceDeps<TRowData>(args: RowRendererRuntimeArgs<TRowData>): RowRenderMaintenanceDeps<TRowData> {
	return {
		engine: args.engine,
		selectionPaint: args.selectionPaint,
		cellRenderer: args.cellRenderer,
		activeRows: args.activeRows,
		getCurrentWindow: () => args.currentWindow,
		dirtyCellsAfterScroll: args.dirtyCellsAfterScroll,
		dirtyRowsAfterScroll: args.dirtyRowsAfterScroll,
		dirtyBuckets: args.dirtyBuckets,
		incrementPostScrollDirtyCellsDecorated: () => {
			args.incrementPostScrollDirtyCellsDecorated();
		},
		bindCellFull: (request: RowCellBindRequest<TRowData>) =>
			bindCellFull(createRowCellBinderDeps(args), {
				cellSlot: request.cellSlot as CellSlot<TRowData>,
				slotId: request.slotId,
				node: request.node,
				rowIndex: request.rowIndex,
				colIndex: request.colIndex,
				col: request.col,
				pinLeftColumns: request.pinLeftColumns,
				pinRightColumns: request.pinRightColumns,
				pinRightStart: request.pinRightStart,
				pinRightBaseLeft: request.pinRightBaseLeft,
				plan: request.plan,
				state: request.state,
				ctx: request.ctx,
				phase: request.phase,
			}),
	};
}

function createRowCellBindingLaneDeps<TRowData>(args: RowRendererRuntimeArgs<TRowData>): RowCellBindingLaneDeps<TRowData> {
	return {
		engine: args.engine,
		initCell: args.initCell,
		releaseCellFn: args.releaseCellFn,
		ensurePinnedContainer: args.ensurePinnedContainer,
		cellBinderDeps: createRowCellBinderDeps(args),
		markCellDirtyAfterScroll: args.markCellDirtyAfterScroll,
		releaseCellPortal: args.releaseCellPortal,
		ensureLoadingSkeleton: (cell: HTMLDivElement) => args.cellRenderer.ensureLoadingSkeleton(cell),
		onScrollCellVisited: () => {
			args.incrementCurrentScrollCellsVisited();
		},
		onScrollCellPatched: () => {
			args.incrementCurrentScrollCellsPatched();
		},
		onScrollCellWritten: () => {
			args.incrementCurrentScrollCellsWritten();
		},
	};
}

export class RowRendererRuntimeBridge<TRowData = unknown> {
	public constructor(private readonly deps: RowRendererRuntimeBridgeDeps<TRowData>) {}

	public bindFullWidthRow(slot: RowSlot<TRowData>, visualRow: VisualRow<TRowData>): void {
		bindFullWidthRow(this.createArgs(), slot, visualRow);
	}

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		repaintInvalidatedRowsAndCellsMaintenance(createRowRenderMaintenanceDeps(this.createArgs()), frame);
	}

	public decorateDirtyCellsAfterScroll(options?: { maxCells?: number }): { remaining: number; processed: number } {
		return decorateDirtyCellsAfterScrollMaintenance(createRowRenderMaintenanceDeps(this.createArgs()), options);
	}

	public bindAllDataCells(request: BindAllDataCellsRequest<TRowData>): void {
		bindAllDataCells(createRowCellBindingLaneDeps(this.createArgs()), request);
	}

	public bindAllLoadingCells(request: BindAllLoadingCellsRequest<TRowData>): void {
		bindAllLoadingCells(createRowCellBindingLaneDeps(this.createArgs()), request);
	}

	public markCellDirtyAfterScroll(cell: HTMLDivElement): void {
		if (!this.deps.dirtyCellsAfterScroll.has(cell)) {
			this.deps.dirtyCellsAfterScroll.add(cell);
			this.deps.incrementDirtyCellsMarkedDuringScroll();
		}
	}

	public releaseCellPortal(
		cell: HTMLDivElement,
		forceDeferred?: boolean,
		reason: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated' = 'scrolled-out'
	): void {
		const cellSlot = CellSlot.fromElement(cell);
		const cellKey = cellSlot.binding?.cellKey ?? cell.dataset.cellKey;
		if (!cellKey) return;
		const container = this.getCellPortalHost(cell) ?? cell;
		const isDeferred = forceDeferred ?? (this.deps.getIsScrollFrameActive() || this.deps.getIsScrolling());

		if (isDeferred) {
			this.deps.incrementCurrentScrollPortalOps();
			this.deps.portalMountManager.releaseCellForScroll({
				cellKey,
				container,
				flushSync: false,
			});
		} else {
			this.deps.portalMountManager.releaseCell({
				cellKey,
				container,
				flushSync: false,
				reason,
			});
		}
	}

	public cancelPendingPortalRelease(cellKey: string): void {
		this.deps.pendingPortalReleasesAfterScroll.delete(cellKey);
	}

	public applyFocus(cell: HTMLDivElement): void {
		if (this.deps.getIsScrollFrameActive() || this.deps.getIsScrolling()) {
			this.deps.setDeferredFocusCell(cell);
			const renderStats = this.deps.getRenderStats();
			if (renderStats) {
				renderStats.focusCallsDuringScroll++;
			}
			return;
		}
		cell.focus({ preventScroll: true });
	}

	private createArgs(): RowRendererRuntimeArgs<TRowData> {
		return {
			engine: this.deps.engine,
			cellRenderer: this.deps.cellRenderer,
			portalMountManager: this.deps.portalMountManager,
			viewportContainer: this.deps.getViewportContainer(),
			selectionPaint: this.deps.selectionPaint,
			cellClassScratch: this.deps.cellClassScratch,
			fullWidthRenderer: this.deps.getFullWidthRenderer(),
			currentWindow: this.deps.getCurrentWindow(),
			dirtyCellsAfterScroll: this.deps.dirtyCellsAfterScroll,
			dirtyRowsAfterScroll: this.deps.dirtyRowsAfterScroll,
			dirtyBuckets: this.deps.dirtyBuckets,
			activeRows: this.deps.activeRows,
			initCell: this.deps.initCell,
			releaseCellFn: this.deps.releaseCellFn,
			ensurePinnedContainer: this.deps.ensurePinnedContainer,
			releaseRowPortal: this.deps.releaseRowPortal,
			ensureCellPortalHost: (cell) => this.ensureCellPortalHost(cell),
			getCellPortalHost: (cell) => this.getCellPortalHost(cell),
			markCellDirtyAfterScroll: (cell) => this.markCellDirtyAfterScroll(cell),
			releaseCellPortal: (cell, forceDeferred, reason) => this.releaseCellPortal(cell, forceDeferred, reason),
			cancelPendingPortalRelease: (cellKey) => this.cancelPendingPortalRelease(cellKey),
			applyFocus: (cell) => this.applyFocus(cell),
			isEditorInteractiveElement: (el) => this.isEditorInteractiveElement(el),
			isScrolling: this.deps.getIsScrolling(),
			isScrollFrameActive: this.deps.getIsScrollFrameActive(),
			renderStats: this.deps.getRenderStats(),
			programmaticScrollCell: this.deps.getProgrammaticScrollCell(),
			clearProgrammaticScrollCell: this.deps.clearProgrammaticScrollCell,
			setDeferredFocusCell: (cell) => this.deps.setDeferredFocusCell(cell),
			incrementStyleHookCallsDuringScroll: this.deps.incrementStyleHookCallsDuringScroll,
			incrementCellsBoundDuringScroll: this.deps.incrementCellsBoundDuringScroll,
			incrementCurrentScrollCellsVisited: this.deps.incrementCurrentScrollCellsVisited,
			incrementCurrentScrollCellsPatched: this.deps.incrementCurrentScrollCellsPatched,
			incrementCurrentScrollCellsWritten: this.deps.incrementCurrentScrollCellsWritten,
			incrementPostScrollDirtyCellsDecorated: this.deps.incrementPostScrollDirtyCellsDecorated,
		};
	}

	private ensureCellPortalHost(cell: HTMLDivElement): HTMLDivElement {
		this.deps.cellRenderer.getOrCreateCellContentLayer(cell);
		return this.deps.cellRenderer.getOrCreatePortalHost(cell) as HTMLDivElement;
	}

	private getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null {
		return this.deps.cellRenderer.getPortalHost(cell) as HTMLDivElement | null;
	}

	private isEditorInteractiveElement(el: Element | null): boolean {
		if (!el) return false;
		return el.closest('.og-cell-editor') !== null || el.closest('.og-context-menu') !== null;
	}
}

export function bindFullWidthRow<TRowData>(args: RowRendererRuntimeArgs<TRowData>, slot: RowSlot<TRowData>, visualRow: VisualRow<TRowData>): void {
	args.fullWidthRenderer.bind(
		slot,
		visualRow,
		(s) => {
			s.ensureLeftCells(0, null, args.initCell, args.releaseCellFn);
			s.ensureCenterCells(0, args.initCell, args.releaseCellFn);
			s.ensureRightCells(0, null, args.initCell, args.releaseCellFn);
			args.ensurePinnedContainer(s, 'left', 0);
			args.ensurePinnedContainer(s, 'right', 0);
		},
		(s) => args.releaseRowPortal(s)
	);
}
