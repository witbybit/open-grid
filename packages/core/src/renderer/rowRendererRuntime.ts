import type { GridEngine } from '../engine/GridEngine.js';
import type { GridCellPointer, GridCellClassParams, VisualRow } from '../store.js';
import type { CellRenderer } from './cellRenderer.js';
import type { CellSlot } from './cellSlot.js';
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
	getProgrammaticScrollCell: () => GridCellPointer | null;
	clearProgrammaticScrollCell: () => void;
	setDeferredFocusCell: (cell: HTMLDivElement) => void;
	incrementStyleHookCallsDuringScroll: () => void;
	incrementCellsBoundDuringScroll: () => void;
	incrementCurrentScrollCellsVisited: () => void;
	incrementCurrentScrollCellsPatched: () => void;
	incrementCurrentScrollCellsWritten: () => void;
	incrementPostScrollDirtyCellsDecorated: () => void;
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
		getProgrammaticScrollCell: args.getProgrammaticScrollCell,
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

export function repaintInvalidatedRowsAndCells<TRowData>(args: RowRendererRuntimeArgs<TRowData>, frame: InvalidationFrame): void {
	return repaintInvalidatedRowsAndCellsMaintenance(createRowRenderMaintenanceDeps(args), frame);
}

export function decorateDirtyCellsAfterScroll<TRowData>(
	args: RowRendererRuntimeArgs<TRowData>,
	options?: { maxCells?: number }
): { remaining: number; processed: number } {
	return decorateDirtyCellsAfterScrollMaintenance(createRowRenderMaintenanceDeps(args), options);
}

export function bindAllDataCellsRuntime<TRowData>(args: RowRendererRuntimeArgs<TRowData>, request: BindAllDataCellsRequest<TRowData>): void {
	bindAllDataCells(createRowCellBindingLaneDeps(args), request);
}

export function bindAllLoadingCellsRuntime<TRowData>(args: RowRendererRuntimeArgs<TRowData>, request: BindAllLoadingCellsRequest<TRowData>): void {
	bindAllLoadingCells(createRowCellBindingLaneDeps(args), request);
}
