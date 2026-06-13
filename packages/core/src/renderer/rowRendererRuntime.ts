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

export interface RowRendererRuntimeStateHost<TRowData = unknown> {
	cellClassScratch: GridCellClassParams<TRowData>;
	currentWindow: RenderWindow | null;
	dirtyCellsAfterScroll: Set<HTMLDivElement>;
	dirtyRowsAfterScroll: Set<number>;
	dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]];
	activeRows: Map<number, RowSlot<TRowData>>;
	pendingPortalReleasesAfterScroll: Map<string, unknown>;
	programmaticScrollCell: GridCellPointer | null;
	deferredFocusCell: HTMLDivElement | null;
	isScrolling: boolean;
	isScrollFrameActive: boolean;
	renderStats: any;
	currentScrollCellsVisited: number;
	currentScrollCellsPatched: number;
	currentScrollCellsWritten: number;
	currentScrollPortalOps: number;
	postScrollDirtyCellsDecorated: number;
	dirtyCellsMarkedDuringScroll: number;
}

export interface RowRendererRuntimeBridgeDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	cellRenderer: CellRenderer;
	portalMountManager: PortalMountManager<TRowData>;
	getViewportContainer: () => HTMLElement | null | undefined;
	selectionPaint: SelectionPaintManager<TRowData>;
	getFullWidthRenderer: () => FullWidthRowRenderer<TRowData>;
	stateHost: RowRendererRuntimeStateHost<TRowData>;
	initCell: (el: HTMLDivElement) => void;
	releaseCellFn: (cell: CellSlot<TRowData>) => void;
	ensurePinnedContainer: (slot: RowSlot<TRowData>, side: 'left' | 'right', width: number) => HTMLDivElement | null;
	releaseRowPortal: (slot: RowSlot<TRowData>) => boolean;
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
		programmaticScrollCell: args.programmaticScrollCell,
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
		if (!this.deps.stateHost.dirtyCellsAfterScroll.has(cell)) {
			this.deps.stateHost.dirtyCellsAfterScroll.add(cell);
			this.deps.stateHost.dirtyCellsMarkedDuringScroll++;
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
		const isDeferred = forceDeferred ?? (this.deps.stateHost.isScrollFrameActive || this.deps.stateHost.isScrolling);

		if (isDeferred) {
			this.deps.stateHost.currentScrollPortalOps++;
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
		this.deps.stateHost.pendingPortalReleasesAfterScroll.delete(cellKey);
	}

	public applyFocus(cell: HTMLDivElement): void {
		if (this.deps.stateHost.isScrollFrameActive || this.deps.stateHost.isScrolling) {
			this.deps.stateHost.deferredFocusCell = cell;
			const renderStats = this.deps.stateHost.renderStats;
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
			cellClassScratch: this.deps.stateHost.cellClassScratch,
			fullWidthRenderer: this.deps.getFullWidthRenderer(),
			currentWindow: this.deps.stateHost.currentWindow,
			dirtyCellsAfterScroll: this.deps.stateHost.dirtyCellsAfterScroll,
			dirtyRowsAfterScroll: this.deps.stateHost.dirtyRowsAfterScroll,
			dirtyBuckets: this.deps.stateHost.dirtyBuckets,
			activeRows: this.deps.stateHost.activeRows,
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
			isScrolling: this.deps.stateHost.isScrolling,
			isScrollFrameActive: this.deps.stateHost.isScrollFrameActive,
			renderStats: this.deps.stateHost.renderStats,
			programmaticScrollCell: this.deps.stateHost.programmaticScrollCell,
			clearProgrammaticScrollCell: () => {
				this.deps.stateHost.programmaticScrollCell = null;
			},
			setDeferredFocusCell: (cell) => {
				this.deps.stateHost.deferredFocusCell = cell;
			},
			incrementStyleHookCallsDuringScroll: () => {
				if (this.deps.stateHost.renderStats) this.deps.stateHost.renderStats.styleHookCallsDuringScroll++;
			},
			incrementCellsBoundDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.cellsBoundDuringScroll = (this.deps.stateHost.renderStats.cellsBoundDuringScroll || 0) + 1;
				}
			},
			incrementCurrentScrollCellsVisited: () => {
				this.deps.stateHost.currentScrollCellsVisited++;
			},
			incrementCurrentScrollCellsPatched: () => {
				this.deps.stateHost.currentScrollCellsPatched++;
			},
			incrementCurrentScrollCellsWritten: () => {
				this.deps.stateHost.currentScrollCellsWritten++;
			},
			incrementPostScrollDirtyCellsDecorated: () => {
				this.deps.stateHost.postScrollDirtyCellsDecorated++;
			},
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
