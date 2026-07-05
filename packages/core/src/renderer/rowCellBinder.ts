import type { GridEngine } from '../engine/GridEngine.js';
import { createEditRendererKey, createCellInstanceRendererKey } from './identityKeys.js';
import { reportRendererFault } from './rendererFaults.js';
import type { CellRendererPhase, ColumnDef, ColumnInstanceId, GridCellClassParams, InternalColumnDef } from '../columnDef.js';
import { getColumnInstanceIdentity } from '../columnDef.js';
import type { GridCellPointer } from '../api/GridApi.js';
import { normalizeCapabilityResult } from '../capabilities/capabilityTypes.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import { matchesCellSlotMountedFreshness, recordCellSlotMountedVisualVersions, type CellSlot, type CellContentMode } from './cellSlot.js';
import {
	TextRendererHandle,
	FallbackRendererHandle,
	PortalRendererHandle,
	LoadingRendererHandle,
	CustomRendererHandle,
} from './cellRendererHandle.js';
import type { CellRenderer } from './cellRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';
import { compileStyleRules, evaluateCellStyleRules } from '../styling/styleRules.js';
import { collectCellDecorationSnapshotMetadata, createCellDisplaySnapshot, type CellDisplaySnapshot } from './cellDisplaySnapshot.js';
import { isVisualFresh, mountedCellFreshness } from './visualFreshness.js';
import { resolveScrollCellPresentation, type ScrollCellPresentationDeps } from './scrollCellPresentation.js';
import { isHtmlSnapshotPresentation, isTextImpostorPresentation } from './scrollPresentationMode.js';
import { dispatchCellPresentation } from './binders/cellPresentationDispatcher.js';
import { buildCellPinClass, applyCellTitlesAndValidation } from './binders/binderShared.js';
import { getOrCreateCellCtrl, createRowCtrl, type RowCtrl } from './controllers/RowCtrl.js';
import type { CellCtrl } from './controllers/CellCtrl.js';
import { CellCtrlStore } from './controllers/CellCtrlStore.js';

const fallbackCellCtrlStores = new WeakMap<object, CellCtrlStore<any>>();

function subtractNormalizedClassName(fullClassName: string, baseClassName: string): string {
	const fullTokens = fullClassName.trim().split(/\s+/).filter(Boolean);
	if (fullTokens.length === 0) return '';
	const baseTokenSet = new Set(baseClassName.trim().split(/\s+/).filter(Boolean));
	return fullTokens.filter((token) => !baseTokenSet.has(token)).join(' ');
}

function getFreshCellSnapshot<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	rowId: string,
	colField: string,
	ctx?: ScrollRenderContext<TRowData>
): CellDisplaySnapshot | undefined {
	const snapshotLookup = deps.engine as GridEngine<TRowData> & {
		getCellDisplaySnapshot?: (rowId: string, colField: string) => CellDisplaySnapshot | undefined;
		cellDisplaySnapshots?: { get: (rowId: string, colField: string) => CellDisplaySnapshot | undefined };
	};
	const snapshot = snapshotLookup.getCellDisplaySnapshot?.(rowId, colField) ?? snapshotLookup.cellDisplaySnapshots?.get(rowId, colField);
	if (!snapshot || !ctx) return snapshot;
	const currentRowVersion = ctx.rowVersions?.get(rowId) ?? -1;
	const isFresh = isVisualFresh(snapshot, {
		rowVersion: currentRowVersion,
		globalVersion: ctx.globalVersion,
		insightVersion: ctx.insightVersion,
		styleVersion: ctx.styleVersion,
		loadingVersion: ctx.loadingVersion,
		selectionVersion: ctx.selectionVersion,
	});
	return isFresh ? snapshot : undefined;
}

export interface SnapshotVisualVersions {
	styleVersion: number;
	loadingVersion: number;
}

export interface RowCellBinderDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	cellRenderer: CellRenderer;
	portalMountManager: PortalMountManager<TRowData>;
	selectionPaint: SelectionPaintManager<TRowData>;
	cellClassScratch: GridCellClassParams<TRowData>;
	getViewportContainer: () => HTMLElement | null | undefined;
	getIsScrolling: () => boolean;
	getIsScrollFrameActive: () => boolean;
	programmaticScrollCell: GridCellPointer | null;
	clearProgrammaticScrollCell: () => void;
	setDeferredFocusCell: (cell: HTMLDivElement) => void;
	applyFocus: (cell: HTMLDivElement) => void;
	isEditorInteractiveElement: (el: Element | null) => boolean;
	ensureCellPortalHost: (cell: HTMLDivElement) => HTMLDivElement;
	getCellPortalHost: (cell: HTMLDivElement) => HTMLDivElement | null;
	markCellDirtyAfterScroll: (cell: HTMLDivElement) => void;
	releaseCellPortal: (cell: HTMLDivElement, forceDeferred?: boolean, reason?: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated') => void;
	incrementStyleHookCallsDuringScroll: () => void;
	incrementCellsBoundDuringScroll: () => void;
	incrementCurrentScrollCellsWritten: () => void;
	incrementFullCellBinds?: () => void;
	incrementGeometryOnlyCellBinds?: () => void;
	incrementCellSlotRebinds?: () => void;
	incrementIntegrityComputesDuringScroll?: () => void;
	incrementForceLiveMountsDuringScroll?: () => void;
	/** scrollPresentation:'live' fresh portal mounts during scroll — distinct from the rare
	 *  forceLiveMountsDuringScroll interactive exception (see scrollCellPresentation.ts), and from
	 *  incrementLiveReactUpdatesDuringScroll (re-renders of an already-mounted live cell). */
	incrementLiveReactMountsDuringScroll?: () => void;
	/** A live cell already mounted (React re-render, not a fresh portal mount) — budgeted separately
	 *  from incrementLiveReactMountsDuringScroll by liveFrameBudget.ts. */
	incrementLiveReactUpdatesDuringScroll?: () => void;
	/** A live-mount was deferred to a shell/pending placeholder because the frame's mount budget was
	 *  exhausted (see liveFrameBudget.ts, GridRendererOptions.liveReact). */
	incrementLiveReactEmergencyShellsDuringScroll?: () => void;
	/** Returns false when this frame's live-mode budget for `kind` is exhausted. Omitted (or a
	 *  caller-side default of always-true) means unlimited — see liveFrameBudget.ts. */
	tryConsumeLiveBudget?: (kind: 'mount' | 'update') => boolean;
	/** Whether an over-budget fresh mount may fall back to an emergency shell instead of mounting
	 *  anyway. Omitted defaults to true (shell allowed). */
	allowLiveEmergencyShell?: () => boolean;
	incrementHtmlSnapshotHitsDuringScroll?: () => void;
	incrementHtmlSnapshotMissesDuringScroll?: () => void;
	incrementTextImpostorUsesDuringScroll?: () => void;
	/** Grid-level defaults for scrollPresentation:'html-snapshot' columns that don't override them. */
	getHtmlSnapshotDefaults?: () => { allowShellWhenMissing: boolean; allowTextFallbackWhenMissing: boolean };
	getSnapshotVisualVersions: () => SnapshotVisualVersions;
	/** Live column-reorder preview offset (px) for a displayed column index.
	 *  0 outside an active header drag. Only consulted on the full-bind path. */
	getColumnShift?: (colIndex: number) => number;
	/** Called once per cell whose resolved presentation this frame was 'live-mount' — lets the
	 *  caller's ViewportPlan.liveRows/liveCenterColumns (see viewportPlanner.ts) reflect what the
	 *  resolver actually decided, without this binder needing to know about ViewportPlan itself. */
	onLiveCellResolved?: (rowId: string, columnInstanceId: ColumnInstanceId) => void;
}

export interface BindCellFullRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	slotId: string;
	/** Physical slot generation — incremented on each row rebind. Required for stale-mount detection. */
	slotGeneration: number;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	pinRightBaseLeft: number;
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	state: InternalGridState<TRowData>;
	ctx?: ScrollRenderContext<TRowData>;
	phase?: CellRendererPhase;
	/** Attached RowCtrl for this row, when the caller already resolved one this frame (bindAllDataCells
	 *  resolves it once per row, not once per cell). Falls back to engine.rowCtrls.getOrCreate(node.id)
	 *  when omitted — kept optional so existing direct callers/tests are unaffected. */
	rowCtrl?: RowCtrl<TRowData>;
}

export interface BindCellDuringScrollRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	ctx: ScrollRenderContext<TRowData>;
	pooledRowId: string;
	/** Physical slot generation — required for stale-mount detection in deferred flush. */
	pooledRowGeneration: number;
	left: number;
	right: number;
	width: number;
	isRowRebind: boolean;
	isRowLoading: boolean;
	isInVisibleContent: boolean;
	/** Attached RowCtrl for this row, when the caller already resolved one this frame. Falls back to
	 *  engine.rowCtrls.getOrCreate(node.id) when omitted. */
	rowCtrl?: RowCtrl<TRowData>;
}

function applyValueFormatter<TRowData>(col: ColumnDef<TRowData>, value: unknown, node: RowNode<TRowData>): string {
	if (col.valueFormatter) {
		return col.valueFormatter({ value, rowData: node.data as TRowData, colDef: col, rowId: node.id });
	}
	if (value == null) return '';
	return String(value);
}

function getCheapCellText<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	cellSlot?: CellSlot<TRowData>,
	ctx?: ScrollRenderContext<TRowData>
): string {
	const isScrolling = ctx ? ctx.isScrolling : deps.getIsScrollFrameActive() || deps.engine.isScrolling;
	if (isScrolling) {
		const cachedVal = deps.engine.data.getCachedDisplayValue(node.id, col.field);
		if (cachedVal !== undefined) return col.valueFormatter ? applyValueFormatter(col, cachedVal, node) : cachedVal;
		// Warm DOM may accelerate only when it still belongs to this exact row/column — otherwise
		// it's a different row's leftover text and must not be shown as a stand-in for this one.
		const isSameIdentity = !!cellSlot && cellSlot.rowId === node.id && cellSlot.colField === col.field;
		return isSameIdentity ? (cellSlot!.lastFormattedValue ?? '') : '';
	}
	if (col.valueGetter || deps.engine.hasFormula(node.id, col.field)) {
		const val = deps.engine.data.getCellValue(node.id, col.field);
		return applyValueFormatter(col, val, node);
	}
	const raw = node.data ? (node.data as Record<string, unknown>)[col.field] : undefined;
	return applyValueFormatter(col, raw, node);
}

/**
 * WS2: Assign the appropriate CellRendererHandle based on the resolved content mode.
 * Destroys the previous handle when the renderer kind changes or the portal key rotates.
 * Text/fallback handles are updated in-place to avoid allocation when kind is stable.
 */
function assignRendererHandle<TRowData>(cellSlot: CellSlot<TRowData>, contentMode: CellContentMode, formattedValue: string, portalKey: string): void {
	const existing = cellSlot.renderer;

	if (contentMode === 'text') {
		if (existing instanceof TextRendererHandle) {
			existing.formattedValue = formattedValue;
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new TextRendererHandle<TRowData>(formattedValue);
		}
	} else if (contentMode === 'fallback') {
		if (existing instanceof FallbackRendererHandle) {
			existing.formattedValue = formattedValue;
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new FallbackRendererHandle<TRowData>(formattedValue);
		}
	} else if (contentMode === 'portal') {
		if (existing instanceof PortalRendererHandle && existing.portalKey === portalKey) {
			// Same portal key — renderer is still active; no structural change.
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new PortalRendererHandle<TRowData>(portalKey);
		}
	} else if (contentMode === 'loading') {
		if (existing instanceof LoadingRendererHandle) {
			// Already loading — no change.
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new LoadingRendererHandle<TRowData>();
		}
	} else if (contentMode === 'custom') {
		if (existing instanceof CustomRendererHandle) {
			// Custom content owner manages its own lifecycle.
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new CustomRendererHandle<TRowData>();
		}
	} else {
		// 'empty' | 'pending' — no active renderer
		if (existing !== null) {
			existing.destroy();
			cellSlot.renderer = null;
		}
	}
}

/**
 * Attaches/reuses the CellCtrl for this (rowId, columnInstanceId), stamping its physical-slot
 * bookkeeping and editing/focus state. Deliberately does NOT feed the resolver — CellCtrl is
 * populated alongside resolveScrollCellPresentation's existing decision tree, not injected into it
 * (see controllers/CellCtrl.ts doc comment). Also rolls the row-level isEditing/isFocused flags on
 * RowCtrl into `true` when this cell is the active edit/focus target — the row-level reset back to
 * `false` happens once per row in bindAllDataCells, not here.
 */
function attachCellCtrl<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: { cellSlot: CellSlot<TRowData>; node: RowNode<TRowData>; col: ColumnDef<TRowData>; rowCtrl?: RowCtrl<TRowData> },
	isEditing: boolean,
	isFocused: boolean
): CellCtrl {
	const { cellSlot, node, col } = request;
	// Defensive fallback for lightweight test doubles that construct a partial `engine` mock without
	// a real RowCtrlStore — a real GridEngine always has `rowCtrls` (see GridEngine.ts), so this only
	// ever triggers in tests, producing a throwaway, unshared RowCtrl rather than crashing.
	const rowCtrl = request.rowCtrl ?? deps.engine.rowCtrls?.getOrCreate(node.id) ?? createRowCtrl<TRowData>(node.id);
	const instanceId = getColumnInstanceIdentity(col);
	const existingCellCtrlStore = deps.engine.rowCtrls?.cellCtrls ?? fallbackCellCtrlStores.get(rowCtrl as object);
	const cellCtrlStore =
		existingCellCtrlStore ??
		(() => {
			const store = new CellCtrlStore<TRowData>();
			fallbackCellCtrlStores.set(rowCtrl as object, store);
			return store;
		})();
	const { cellCtrl, created } = getOrCreateCellCtrl(rowCtrl, cellCtrlStore, col.field, instanceId);
	if (deps.engine.rowCtrls) {
		if (created) deps.engine.rowCtrls.stats.cellCtrlsCreated++;
		else deps.engine.rowCtrls.stats.cellCtrlsReused++;
	}
	cellCtrl.attachedSlotInstanceId = cellSlot.cellInstanceId;
	cellCtrl.attachedRowBindingGeneration = cellSlot.rowBindingGeneration;
	cellCtrl.isEditing = isEditing;
	cellCtrl.isFocused = isFocused;
	if (isEditing) rowCtrl.isEditing = true;
	if (isFocused) rowCtrl.isFocused = true;
	return cellCtrl;
}

/**
 * Mirrors cellCtrl.lastResolvedFreshness/lastResolvedContentMode from cellSlot's just-written
 * lastMounted* fields — a same-call-frame read of values cellSlot.update()/stampMountedVersions()
 * have already written, not a stale cache. Reading FROM cellSlot (rather than reconstructing the
 * frame's freshness independently) matters: several scroll-time binder branches only conditionally
 * call stampMountedVersions (e.g. when a presentation's `recordVersionsFrom` is undefined, cellSlot's
 * stamps are deliberately left unchanged). Mirroring cellSlot's actual post-dispatch state keeps
 * CellCtrl truthful in exactly those cases instead of silently diverging from what's really mounted.
 */
function stampCellCtrlResolution<TRowData>(cellCtrl: CellCtrl, cellSlot: CellSlot<TRowData>): void {
	cellCtrl.lastResolvedFreshness = mountedCellFreshness(cellSlot);
	cellCtrl.lastResolvedContentMode = cellSlot.lastContentMode;
}

export function bindCellFull<TRowData>(deps: RowCellBinderDeps<TRowData>, request: BindCellFullRequest<TRowData>): void {
	deps.incrementFullCellBinds?.();
	deps.incrementCellSlotRebinds?.();
	const { cellSlot, slotId, node, rowIndex, colIndex, col, lane, pinRightBaseLeft, plan, state, ctx, phase = 'initial' } = request;
	const access = deps.engine.cellAccess.get(node.id, rowIndex, node, node.data, colIndex, col, undefined, state);
	const rowVersion = deps.engine.rowVersions.get(node.id) ?? -1;
	const snapshotVisualVersions = deps.getSnapshotVisualVersions();
	const currentVisualVersions = {
		insightVersion: deps.engine.insights.getVersion(),
		styleVersion: snapshotVisualVersions.styleVersion,
		loadingVersion: snapshotVisualVersions.loadingVersion,
		selectionVersion: deps.engine.selectionVersion,
	};
	const cellCtrl = attachCellCtrl(deps, request, access.isEditing, access.isFocused);

	const baseCellClassName = buildCellPinClass(lane);
	let cellClassName = baseCellClassName;
	if (access.isFocused) {
		cellClassName += ' og-cell-focused';
		cellSlot.element.tabIndex = -1;
		cellSlot.hasTabIndex = true;
		const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
		if (
			activeEl &&
			(activeEl === document.body ||
				(deps.getViewportContainer() &&
					deps.getViewportContainer()!.contains(activeEl) &&
					activeEl !== cellSlot.element &&
					!cellSlot.element.contains(activeEl) &&
					!deps.isEditorInteractiveElement(activeEl)))
		) {
			if (deps.getIsScrolling()) {
				deps.setDeferredFocusCell(cellSlot.element);
			} else {
				deps.applyFocus(cellSlot.element);
			}
		}
	} else if (cellSlot.hasTabIndex) {
		cellSlot.element.removeAttribute('tabindex');
		cellSlot.hasTabIndex = false;
	}

	if (access.isSelected) cellClassName += ' og-cell-selected';
	if (access.isLoading) cellClassName += ' og-cell-loading';

	// Readonly visual indicator
	if (col.canEdit !== undefined && node.data !== null) {
		const isEditable = normalizeCapabilityResult(
			col.canEdit({ action: 'edit', row: node.data as TRowData, rowId: node.id, colField: col.field })
		).allowed;
		if (!isEditable) cellClassName += ' og-cell-readonly';
	}

	// Insight layer decorations — read-only overlay; must not mutate row data or DOM directly.
	// This is the integrity/insights compute site. It must never fire on the scroll hot path
	// (bindCellDuringScroll never calls it) — the counter proves that contract holds.
	if (deps.getIsScrolling()) deps.incrementIntegrityComputesDuringScroll?.();
	const cellDecorations = deps.engine.insights.getCellDecorations(node.id, col.field);
	const decorationMetadata = collectCellDecorationSnapshotMetadata(cellDecorations);
	cellClassName += decorationMetadata.classNameSuffix;
	const insightTitle = decorationMetadata.insightTitle;
	const validationDecTitle = decorationMetadata.validationError;

	// Sync data-validation-error for ValidationTooltipController (hover tooltip).
	const compiledStyleRules = compileStyleRules(state.styleRules);
	if (compiledStyleRules.hasCellRules && node.data) {
		try {
			const s = deps.cellClassScratch;
			s.row = node.data;
			s.rowId = node.id;
			s.rowIndex = rowIndex;
			s.col = col;
			s.colField = col.field;
			s.colIndex = colIndex;
			s.isFocused = access.isFocused;
			s.isRowFocused = access.isRowFocused;
			s.isRowSelected = access.isRowSelected || access.isRowFocused;
			s.isSelected = access.isSelected;
			s.isEditing = access.isEditing;
			s.value = access.value;
			s.rawValue = access.rawValue;
			s.isLoading = access.isLoading;
			s.selection = state.selection;
			const customCellClass = evaluateCellStyleRules(compiledStyleRules, col, node.data, s);
			if (customCellClass) cellClassName += ' ' + customCellClass;
		} catch (e) {
			reportRendererFault(deps.engine, 'cell-class', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
		}
	}

	const cellLeft = plan.colLefts[colIndex];
	const leftArg = lane === 'right' ? cellLeft - pinRightBaseLeft : cellLeft;
	const cellWidth = plan.colWidths[colIndex];
	const dragShift = deps.getColumnShift ? deps.getColumnShift(colIndex) : 0;

	if (col.checkboxSelection) {
		const cell = cellSlot.contentElement;
		const rowId = node.id;
		const isChecked = !!deps.selectionPaint.getSelectedRowIdSet(state.selectedRowIds)?.has(rowId);
		cellClassName += ' og-cell-row-selector';
		// Click handling is centralized: a single delegated listener on the viewport container
		// (SelectionPaintManager.onViewportClick) resolves checkbox vs. cell clicks from the DOM
		// target at fire time — see its doc comment for why moving off a per-checkbox listener here
		// is behavior-preserving.
		let checkbox = cell.querySelector<HTMLInputElement>('input[type="checkbox"].og-row-checkbox');
		if (!checkbox) {
			checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.className = 'og-row-checkbox';
			cell.textContent = '';
			cell.appendChild(checkbox);
		}
		checkbox.dataset.rowId = rowId;
		checkbox.setAttribute('aria-label', isChecked ? `Deselect row ${rowIndex + 1}` : `Select row ${rowIndex + 1}`);
		checkbox.title = 'Select row. Shift-click selects a range.';
		if (checkbox.checked !== isChecked) checkbox.checked = isChecked;
		cellSlot.update(
			colIndex,
			col.field,
			rowIndex,
			node.id,
			leftArg,
			-1,
			cellWidth,
			cellClassName,
			'custom',
			undefined,
			'',
			undefined,
			dragShift,
			access.isSelected
		);
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = state.globalVersion;
		recordCellSlotMountedVisualVersions(cellSlot, currentVisualVersions);
		stampCellCtrlResolution(cellCtrl, cellSlot);
		return;
	}

	const stableKey = access.isEditing
		? createEditRendererKey(node.id, getColumnInstanceIdentity(col))
		: createCellInstanceRendererKey(cellSlot.cellInstanceId, getColumnInstanceIdentity(col));
	const scrollMode = plan.columnPlans[colIndex]?.mode;
	let contentMode: CellContentMode = 'empty';
	let formattedValue = '';
	let portalImpostorValue = '';
	const isHtmlSnapshotCol = isHtmlSnapshotPresentation(col);
	// html-snapshot mode — capture the committed HTML of an already-live portal on every full
	// (non-scroll) bind, not just the scroll freeze-in-place moment. Without this, a cell only ever
	// gets a frozen clone after surviving one prior scroll-while-visible cycle; any normal re-render
	// (selection, focus, unrelated repaint elsewhere in the grid) settles this cell's portal without
	// ever reading its committed DOM, so the very first scroll after that settle still falls back to
	// plain text. Reading here — before this bind decides whether to release/remount the portal —
	// means the cell already "looks frozen" the first time it is ever scrolled.
	if (isHtmlSnapshotCol && cellSlot.lastPortalKey === stableKey && deps.portalMountManager.isCellMounted(stableKey)) {
		const existingHost = deps.getCellPortalHost(cellSlot.element);
		if (existingHost && existingHost.childElementCount > 0) {
			deps.engine.htmlScrollSnapshots.set(
				deps.engine.htmlScrollSnapshots.createSnapshot({
					rowId: node.id,
					columnInstanceId: getColumnInstanceIdentity(col),
					colField: col.field,
					html: existingHost.innerHTML,
					freshness: { rowVersion, globalVersion: state.globalVersion, ...currentVisualVersions },
					rowHeight: deps.engine.geometry?.rowHeights?.[rowIndex],
					colWidth: plan.colWidths?.[colIndex],
				})
			);
		}
	}

	if (((col as InternalColumnDef<TRowData>).cellRenderer || access.isEditing) && !access.isLoading) {
		contentMode = 'portal';
		const formattedForImpostor =
			access.value != null && col.valueFormatter
				? col.valueFormatter({ value: access.value, rowData: node.data as TRowData, colDef: col, rowId: node.id })
				: access.value != null
					? String(access.value)
					: deps.engine.getCheapDisplayValue(node.id, col.field);
		const textImpostorRender = isTextImpostorPresentation(col)
			? (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.textImpostor?.render
			: undefined;
		portalImpostorValue =
			textImpostorRender != null
				? textImpostorRender({ value: access.value, formattedValue: formattedForImpostor }) || formattedForImpostor
				: formattedForImpostor;
		if (cellSlot.lastPortalKey !== stableKey || !deps.portalMountManager.isCellMounted(stableKey)) {
			if (cellSlot.lastPortalKey) {
				deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			}
			// Text content is left in place — CSS hides .og-cell-content when data-content-mode="portal".
			// It will be cleared lazily when the cell transitions to a non-portal, non-text mode.
		}
		const portalHost = deps.ensureCellPortalHost(cellSlot.element);
		deps.cellRenderer.showPortalContent(cellSlot.element);
		deps.portalMountManager.mountCell({
			cellKey: stableKey,
			container: portalHost,
			value: access.value,
			formattedValue: portalImpostorValue,
			node,
			col,
			rowIndex,
			colIndex,
			rowSlotId: slotId,
			slotGeneration: request.slotGeneration,
			cellRowBindingGeneration: cellSlot.rowBindingGeneration,
			cellInstanceId: cellSlot.cellInstanceId,
			portalHostId: cellSlot.portalHostId,
			isEditing: access.isEditing,
			isLoading: access.isLoading,
			phase: access.isEditing ? 'edit' : phase,
			isScrolling: false,
			isFocused: access.isFocused,
			isSelected: access.isSelected,
		});
	} else {
		if (cellSlot.lastPortalKey) {
			deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
		}
		if (access.isLoading) {
			contentMode = 'loading';
			deps.cellRenderer.ensureLoadingSkeleton(cellSlot.element);
		} else {
			formattedValue = getCheapCellText(deps, node, col, cellSlot, ctx);
			contentMode = formattedValue === '' ? 'empty' : 'text';
		}
	}

	// Cell tooltip (title attribute) — only for data rows with tooltip defined
	let tooltipText: string | null = null;
	if (col.tooltip !== undefined && node.data !== null) {
		tooltipText =
			typeof col.tooltip === 'string'
				? col.tooltip
				: col.tooltip({ row: node.data as TRowData, rowId: node.id, colField: col.field, value: access.rawValue });
	}
	applyCellTitlesAndValidation(cellSlot.element, tooltipText, insightTitle, validationDecTitle);

	cellSlot.update(
		colIndex,
		col.field,
		rowIndex,
		node.id,
		leftArg,
		-1,
		cellWidth,
		cellClassName,
		contentMode,
		access.rawValue,
		formattedValue,
		contentMode === 'portal' ? stableKey : undefined,
		dragShift,
		access.isSelected
	);

	// WS2: assign the renderer handle based on the resolved content mode.
	// Destroy the previous handle when the renderer kind or portal key changes.
	assignRendererHandle(cellSlot, contentMode, formattedValue, stableKey);
	const fullBindHasImpostorCapability = scrollMode === 'custom-live' || scrollMode === 'custom-imperative' || scrollMode === 'custom';
	const snapshotContentKind =
		contentMode === 'portal'
			? !access.isEditing && fullBindHasImpostorCapability && portalImpostorValue !== ''
				? 'impostor'
				: 'portal-live'
			: contentMode;
	const snapshotContentMode = contentMode === 'portal' && snapshotContentKind === 'impostor' ? ('fallback' as const) : contentMode;
	const snapshotFormattedValue = contentMode === 'portal' && snapshotContentKind === 'impostor' ? portalImpostorValue : formattedValue;
	deps.engine.cellDisplaySnapshots.set(
		createCellDisplaySnapshot({
			rowId: node.id,
			colField: col.field,
			rowVersion,
			globalVersion: state.globalVersion,
			insightVersion: currentVisualVersions.insightVersion,
			styleVersion: currentVisualVersions.styleVersion,
			loadingVersion: currentVisualVersions.loadingVersion,
			selectionVersion: currentVisualVersions.selectionVersion,
			baseClassName: baseCellClassName,
			stateClassName: subtractNormalizedClassName(cellClassName, baseCellClassName + decorationMetadata.classNameSuffix),
			decorationClassName: decorationMetadata.classNameSuffix,
			contentKind: snapshotContentKind,
			contentMode: snapshotContentMode,
			formattedValue: snapshotFormattedValue,
			title: cellSlot.element.title,
			validationError: validationDecTitle,
		})
	);

	// Drag handle — injected when col.canDrag is defined (opt-in). Stored on the element to avoid re-querying.
	const el = cellSlot.element as HTMLDivElement & { _dragHandle?: HTMLDivElement };
	const shouldDrag =
		col.canDrag !== undefined &&
		normalizeCapabilityResult(col.canDrag({ action: 'drag', row: node.data as TRowData, rowId: node.id, colField: col.field })).allowed;
	if (shouldDrag) {
		let handle = el._dragHandle;
		if (!handle) {
			handle = document.createElement('div');
			handle.className = 'og-drag-handle';
			handle.innerHTML =
				'<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.4"/><circle cx="11" cy="4" r="1.4"/><circle cx="5" cy="8" r="1.4"/><circle cx="11" cy="8" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="11" cy="12" r="1.4"/></svg>';
			// Pointer events handle drag; the viewport's delegated mousedown listener
			// (SelectionPaintManager.onViewportMouseDown) stops propagation for .og-drag-handle
			// targets to prevent range selection.
			el.appendChild(handle);
			el._dragHandle = handle;
		}
		handle.dataset.dragRowId = node.id;
	} else if (el._dragHandle) {
		el._dragHandle.remove();
		delete el._dragHandle;
	}
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = state.globalVersion;
	recordCellSlotMountedVisualVersions(cellSlot, currentVisualVersions);
	stampCellCtrlResolution(cellCtrl, cellSlot);
}

export function bindCellDuringScroll<TRowData>(deps: RowCellBinderDeps<TRowData>, request: BindCellDuringScrollRequest<TRowData>): void {
	deps.incrementGeometryOnlyCellBinds?.();
	deps.incrementCellSlotRebinds?.();
	const { cellSlot, node, rowIndex, colIndex, col, lane, ctx, isRowRebind, isRowLoading, isInVisibleContent } = request;

	// 1. Geometry / warm-state precomputation shared by every presentation kind.
	const canPreserveWarmVisuals = !isRowRebind && cellSlot.rowId === node.id && cellSlot.colField === col.field && !isRowLoading;
	const rowVersion = ctx.rowVersions?.get(node.id) ?? -1;
	const isWarmBindingVersionFresh =
		canPreserveWarmVisuals &&
		matchesCellSlotMountedFreshness(cellSlot, {
			rowVersion,
			globalVersion: ctx.globalVersion,
			visualVersions: {
				insightVersion: ctx.insightVersion,
				styleVersion: ctx.styleVersion,
				loadingVersion: ctx.loadingVersion,
				selectionVersion: ctx.selectionVersion,
			},
		});
	const cellKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, getColumnInstanceIdentity(col));
	const snapshot = getFreshCellSnapshot(deps, node.id, col.field, ctx);
	const isFocused = !!(ctx.focusedCell && ctx.focusedCell.rowId === node.id && ctx.focusedCell.colField === col.field);
	const isEditing = !!(ctx.activeEdit && ctx.activeEdit.rowId === node.id && ctx.activeEdit.colField === col.field);
	const cellCtrl = attachCellCtrl(deps, request, isEditing, isFocused);

	// Focus tab-index bookkeeping is independent of which presentation gets resolved below —
	// it applies whenever this cell is the focused cell, regardless of content.
	if (ctx.focusedCell && ctx.focusedCell.rowId === node.id && ctx.focusedCell.colField === col.field) {
		cellSlot.element.tabIndex = -1;
		cellSlot.hasTabIndex = true;
		const programmaticScrollCell = deps.programmaticScrollCell;
		const isProgrammatic = programmaticScrollCell && programmaticScrollCell.rowId === node.id && programmaticScrollCell.colField === col.field;
		deps.setDeferredFocusCell(cellSlot.element);
		if (isProgrammatic) deps.clearProgrammaticScrollCell();
	}

	// Likewise, deferring a style refresh to the fidelity lane is a decision independent of the
	// content presentation itself.
	const shouldDeferCellStyleRefresh =
		isInVisibleContent &&
		((ctx.hasInsightDecorations && !snapshot) ||
			(ctx.hasDeferredCellStyleRules &&
				!snapshot &&
				(ctx.selectionChangedDuringScroll || !isWarmBindingVersionFresh || ctx.styleChangedDuringScroll || ctx.loadingChangedDuringScroll)));
	if (shouldDeferCellStyleRefresh) {
		deps.markCellDirtyAfterScroll(cellSlot.element);
		deps.incrementStyleHookCallsDuringScroll();
	}

	// 2. Resolve what to show — the only place that decides, never mutates. Deliberately adapted
	// down to the resolver's narrow ScrollCellPresentationDeps here, not the full binder deps bag —
	// see the type comment on ScrollCellPresentationDeps for why.
	const scrollPresentationDeps: ScrollCellPresentationDeps = {
		getCellPortalHost: deps.getCellPortalHost,
		getRowHeight: (idx) => deps.engine.geometry?.rowHeights?.[idx],
		getColWidth: (idx) => ctx.plan?.colWidths?.[idx],
		getCheapDisplayValue: (rowId, colField) => deps.engine.getCheapDisplayValue?.(rowId, colField),
		getFrozenHtmlSnapshot: (rowId, columnInstanceId, expected, rowHeight, colWidth) => {
			const store = deps.engine.htmlScrollSnapshots as
				| {
						getFresh?: (input: {
							rowId: string;
							columnInstanceId: ColumnInstanceId;
							expectedFreshness: any;
							rowHeight?: number;
							colWidth?: number;
							policy: 'visual';
						}) => any;
						get?: (
							rowId: string,
							columnInstanceId: ColumnInstanceId | string,
							expected: any,
							options?: { rowHeight?: number; colWidth?: number; mode?: 'visual' }
						) => any;
				  }
				| undefined;
			return store?.getFresh
				? store.getFresh({ rowId, columnInstanceId, expectedFreshness: expected, rowHeight, colWidth, policy: 'visual' })
				: store?.get?.(rowId, columnInstanceId, expected, { rowHeight, colWidth, mode: 'visual' });
		},
		getHtmlSnapshotDefaults: deps.getHtmlSnapshotDefaults,
	};
	const presentation = resolveScrollCellPresentation(scrollPresentationDeps, {
		cellSlot,
		node,
		rowIndex,
		colIndex,
		col,
		lane,
		ctx,
		isRowRebind,
		isRowLoading,
		isInVisibleContent,
		snapshot,
		isWarmBindingVersionFresh,
		rowVersion,
		cellKey,
	});

	// 3. Dispatch to the mode-specific binder — enqueues fidelity work, updates mounted slot bookkeeping.
	dispatchCellPresentation(deps, request, presentation, rowVersion);
	stampCellCtrlResolution(cellCtrl, cellSlot);
}
