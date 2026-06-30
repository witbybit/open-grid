import type { GridEngine } from '../engine/GridEngine.js';
import { createEditRendererKey, createCellInstanceRendererKey } from './identityKeys.js';
import { reportRendererFault } from './rendererFaults.js';
import type { CellRendererPhase, ColumnDef, GridCellClassParams, InternalColumnDef } from '../columnDef.js';
import type { GridCellPointer } from '../api/GridApi.js';
import { normalizeCapabilityResult } from '../capabilities/capabilityTypes.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import {
	matchesCellSlotMountedFreshness,
	recordCellSlotMountedVisualVersions,
	matchesCellSlotMountedVisualVersions,
	type CellSlot,
	type CellContentMode,
} from './cellSlot.js';
import {
	TextRendererHandle,
	FallbackRendererHandle,
	PortalRendererHandle,
	LoadingRendererHandle,
	CustomRendererHandle,
	type CellPlacement,
} from './cellRendererHandle.js';
import type { CellRenderer } from './cellRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';
import { compileStyleRules, evaluateCellStyleRules } from '../styling/styleRules.js';
import {
	collectCellDecorationSnapshotMetadata,
	createCellDisplaySnapshot,
	mergeCellSnapshotTitle,
	type CellDisplaySnapshot,
} from './cellDisplaySnapshot.js';

function buildCellPinClass(lane: 'left' | 'center' | 'right'): string {
	if (lane === 'left') return 'og-cell og-cell-pinned-left';
	if (lane === 'right') return 'og-cell og-cell-pinned-right';
	return 'og-cell';
}

function subtractNormalizedClassName(fullClassName: string, baseClassName: string): string {
	const fullTokens = fullClassName.trim().split(/\s+/).filter(Boolean);
	if (fullTokens.length === 0) return '';
	const baseTokenSet = new Set(baseClassName.trim().split(/\s+/).filter(Boolean));
	return fullTokens.filter((token) => !baseTokenSet.has(token)).join(' ');
}

function isPrimitiveSnapshotContent(snapshot: CellDisplaySnapshot | undefined): snapshot is CellDisplaySnapshot {
	return !!snapshot && (snapshot.contentMode === 'text' || snapshot.contentMode === 'empty' || snapshot.contentMode === 'fallback');
}

function isPortalSnapshotContent(snapshot: CellDisplaySnapshot | undefined): snapshot is CellDisplaySnapshot {
	return !!snapshot && snapshot.contentMode === 'portal';
}

function applyCellTitlesAndValidation(element: HTMLDivElement, tooltipText: string | null, insightTitle: string, validationError?: string): void {
	const prevValidationAttr = element.dataset.validationError;
	if (validationError) {
		if (prevValidationAttr !== validationError) element.dataset.validationError = validationError;
	} else if (prevValidationAttr !== undefined) {
		delete element.dataset.validationError;
	}

	const title = mergeCellSnapshotTitle(tooltipText, insightTitle);
	if (title) {
		element.title = title;
	} else if (element.title) {
		element.removeAttribute('title');
	}
}

function hasAuthoritativePortalHostContent<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	cellSlot: CellSlot<TRowData>,
	portalKey: string | undefined
): boolean {
	if (!portalKey || cellSlot.lastContentMode !== 'portal') return false;
	const portalHost = deps.getCellPortalHost(cellSlot.element);
	if (!portalHost || portalHost.childElementCount === 0) return false;
	return true;
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
	if (snapshot.globalVersion !== ctx.globalVersion) return undefined;
	if (snapshot.insightVersion !== ctx.insightVersion) return undefined;
	if (snapshot.styleVersion !== ctx.styleVersion) return undefined;
	if (snapshot.loadingVersion !== ctx.loadingVersion) return undefined;
	if (snapshot.selectionVersion !== ctx.selectionVersion) return undefined;
	if (snapshot.rowVersion !== currentRowVersion) return undefined;
	return snapshot;
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
	getSnapshotVisualVersions: () => SnapshotVisualVersions;
	/** Live column-reorder preview offset (px) for a displayed column index.
	 *  0 outside an active header drag. Only consulted on the full-bind path. */
	getColumnShift?: (colIndex: number) => number;
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
		return cellSlot?.lastFormattedValue ?? '';
	}
	if (col.valueGetter || deps.engine.hasFormula(node.id, col.field)) {
		const val = deps.engine.data.getCellValue(node.id, col.field);
		return applyValueFormatter(col, val, node);
	}
	const raw = node.data ? (node.data as Record<string, unknown>)[col.field] : undefined;
	return applyValueFormatter(col, raw, node);
}

function getScrollMountValue<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	cellSlot?: CellSlot<TRowData>
): unknown {
	const cachedVal = deps.engine.data.getCachedDisplayValue(node.id, col.field);
	if (cachedVal !== undefined) return cachedVal;
	if (col.valueGetter || deps.engine.hasFormula(node.id, col.field)) {
		return '';
	}
	return node.data ? (node.data as Record<string, unknown>)[col.field] : (cellSlot?.lastFormattedValue ?? '');
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
		let checkbox = cell.querySelector<HTMLInputElement>('input[type="checkbox"].og-row-checkbox');
		if (!checkbox) {
			checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.className = 'og-row-checkbox';
			checkbox.addEventListener('click', (e) => {
				e.stopPropagation();
				const input = e.currentTarget as HTMLInputElement;
				const id = input.dataset.rowId;
				if (!id) return;
				const shouldSelect = input.checked;
				const currentState = deps.engine.stateManager.getState();
				const isMultiple = currentState.rowSelection?.mode !== 'single';
				if (isMultiple && (e as MouseEvent).shiftKey && deps.selectionPaint.rowCheckboxAnchorId) {
					const rangeIds = deps.selectionPaint.getDataRowIdsBetween(deps.selectionPaint.rowCheckboxAnchorId, id);
					if (rangeIds.length > 0) {
						if (shouldSelect) deps.engine.selectRowIds(rangeIds, 'checkbox');
						else deps.engine.deselectRowIds(rangeIds, 'checkbox');
					}
				} else if (!isMultiple && shouldSelect) {
					deps.engine.replaceRowIds([id], 'checkbox');
				} else {
					deps.engine.toggleRowId(id, 'checkbox');
				}
				deps.selectionPaint.rowCheckboxAnchorId = id;
			});
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
		return;
	}

	const stableKey = access.isEditing
		? createEditRendererKey(node.id, col.field)
		: createCellInstanceRendererKey(cellSlot.cellInstanceId, col.field);
	let contentMode: CellContentMode = 'empty';
	let formattedValue = '';

	if (((col as InternalColumnDef<TRowData>).cellRenderer || access.isEditing) && !access.isLoading) {
		contentMode = 'portal';
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
			formattedValue:
				access.value != null && col.valueFormatter
					? col.valueFormatter({ value: access.value, rowData: node.data as TRowData, colDef: col, rowId: node.id })
					: access.value != null
						? String(access.value)
						: '',
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
			contentKind: contentMode === 'portal' ? 'portal-live' : contentMode,
			contentMode,
			formattedValue,
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
			// Pointer events handle drag; stop mousedown propagation to prevent range selection.
			handle.addEventListener('mousedown', (e) => {
				e.stopPropagation();
			});
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
}

export function bindCellDuringScroll<TRowData>(deps: RowCellBinderDeps<TRowData>, request: BindCellDuringScrollRequest<TRowData>): void {
	deps.incrementGeometryOnlyCellBinds?.();
	deps.incrementCellSlotRebinds?.();
	const { cellSlot, node, rowIndex, colIndex, col, lane, ctx, pooledRowId, left, right, width, isRowRebind, isRowLoading, isInVisibleContent } =
		request;
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
	const cellKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, col.field);
	const portalHost = cellSlot.lastContentMode === 'portal' ? deps.getCellPortalHost(cellSlot.element) : null;
	const hasEmptyPortalHost =
		cellSlot.lastContentMode === 'portal' && !!cellSlot.lastPortalKey && !!portalHost && portalHost.childElementCount === 0;
	let snapshot = getFreshCellSnapshot(deps, node.id, col.field, ctx);
	if (col.checkboxSelection) {
		if (isInVisibleContent) deps.markCellDirtyAfterScroll(cellSlot.element);
		const cellClassName = buildCellPinClass(lane) + ' og-cell-row-selector';
		cellSlot.update(colIndex, col.field, rowIndex, node.id, left, right, width, cellClassName, 'custom', undefined, '', undefined);
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
		recordCellSlotMountedVisualVersions(cellSlot, {
			insightVersion: ctx.insightVersion,
			styleVersion: ctx.styleVersion,
			loadingVersion: ctx.loadingVersion,
			selectionVersion: ctx.selectionVersion,
		});
		return;
	}

	const plan = ctx.plan.columnPlans[colIndex];
	const isEditing = !!(ctx.activeEdit && ctx.activeEdit.rowId === node.id && ctx.activeEdit.colField === col.field);
	const rendererKind: 'primitive' | 'portal' | 'loading' = isRowLoading ? 'loading' : isEditing || plan?.isCustom ? 'portal' : 'primitive';

	let cellClassName = buildCellPinClass(lane);
	if (rendererKind === 'loading') cellClassName += ' og-cell-loading';
	const shouldDeferCellStyleRefresh =
		isInVisibleContent &&
		((ctx.hasInsightDecorations && !snapshot) ||
			(ctx.hasDeferredCellStyleRules &&
				!snapshot &&
				(ctx.selectionChangedDuringScroll || !canPreserveWarmVisuals || ctx.styleChangedDuringScroll || ctx.loadingChangedDuringScroll)));
	if (snapshot?.className) {
		cellClassName = snapshot.className;
	} else if (canPreserveWarmVisuals && cellSlot.lastClassName) {
		cellClassName = cellSlot.lastClassName;
	}

	if (ctx.focusedCell && ctx.focusedCell.rowId === node.id && ctx.focusedCell.colField === col.field) {
		cellSlot.element.tabIndex = -1;
		cellSlot.hasTabIndex = true;
		const programmaticScrollCell = deps.programmaticScrollCell;
		const isProgrammatic = programmaticScrollCell && programmaticScrollCell.rowId === node.id && programmaticScrollCell.colField === col.field;
		deps.setDeferredFocusCell(cellSlot.element);
		if (isProgrammatic) deps.clearProgrammaticScrollCell();
	}

	if (shouldDeferCellStyleRefresh) {
		deps.markCellDirtyAfterScroll(cellSlot.element);
		deps.incrementStyleHookCallsDuringScroll();
	}

	if (!isInVisibleContent) {
		const primitiveSnapshot = isPrimitiveSnapshotContent(snapshot) ? snapshot : undefined;
		const canReuseSnapshotContent = !!primitiveSnapshot;
		const canReuseSnapshotPortal =
			snapshot?.contentMode === 'portal' && hasAuthoritativePortalHostContent(deps, cellSlot, cellSlot.lastPortalKey);
		if (!canReuseSnapshotPortal && cellSlot.lastPortalKey) {
			deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
		}
		const preservedContentMode: CellContentMode = canReuseSnapshotPortal
			? 'portal'
			: canReuseSnapshotContent
				? primitiveSnapshot.contentMode
				: rendererKind === 'loading'
					? 'loading'
					: 'empty';
		applyCellTitlesAndValidation(cellSlot.element, snapshot?.title || null, '', snapshot?.validationError);
		const didWriteBuffered = cellSlot.update(
			colIndex,
			col.field,
			rowIndex,
			node.id,
			left,
			right,
			width,
			cellClassName,
			preservedContentMode,
			undefined,
			canReuseSnapshotContent && (preservedContentMode === 'text' || preservedContentMode === 'fallback') ? primitiveSnapshot.formattedValue : '',
			preservedContentMode === 'portal' && canReuseSnapshotPortal ? cellSlot.lastPortalKey : undefined
		);
		if (snapshot) {
			cellSlot.lastMountedRowVersion = rowVersion;
			cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
			recordCellSlotMountedVisualVersions(cellSlot, snapshot);
		}
		if (didWriteBuffered) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	}

	let contentMode: CellContentMode = 'empty';
	let formattedValue = '';

	if (rendererKind === 'loading') {
		contentMode = 'loading';
	} else if (rendererKind !== 'portal') {
		if (isPrimitiveSnapshotContent(snapshot)) {
			formattedValue = snapshot.formattedValue;
			contentMode = snapshot.contentMode;
		} else if (canPreserveWarmVisuals && (cellSlot.lastContentMode === 'text' || cellSlot.lastContentMode === 'fallback')) {
			formattedValue = cellSlot.lastFormattedValue ?? '';
			contentMode = cellSlot.lastContentMode;
			deps.markCellDirtyAfterScroll(cellSlot.element);
		} else {
			formattedValue = '...';
			contentMode = 'text';
			deps.markCellDirtyAfterScroll(cellSlot.element);
		}
		if (cellSlot.lastPortalKey) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
		applyCellTitlesAndValidation(cellSlot.element, snapshot?.title || null, '', snapshot?.validationError);
		const didWritePrimitive = cellSlot.update(
			colIndex,
			col.field,
			rowIndex,
			node.id,
			left,
			right,
			width,
			cellClassName,
			contentMode,
			undefined,
			formattedValue,
			undefined
		);
		if (snapshot) {
			cellSlot.lastMountedRowVersion = rowVersion;
			cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
			recordCellSlotMountedVisualVersions(cellSlot, snapshot);
		}
		if (didWritePrimitive) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	} else {
		contentMode = 'portal';
	}

	const portalCellKey = isEditing ? createEditRendererKey(node.id, col.field) : cellKey;
	const scrollMode = plan?.mode;
	const isFocused = ctx.focusedCell?.rowId === node.id && ctx.focusedCell?.colField === col.field;
	const canTrustSnapshotPortalHost =
		isPortalSnapshotContent(snapshot) &&
		cellSlot.lastPortalKey === portalCellKey &&
		(snapshot.contentKind === 'portal-live' || snapshot.contentKind === 'portal-frozen') &&
		hasAuthoritativePortalHostContent(deps, cellSlot, portalCellKey);
	const canFreezePortal = canTrustSnapshotPortalHost;
	const globalChanged = cellSlot.lastMountedGlobalVersion !== -1 && ctx.globalVersion !== cellSlot.lastMountedGlobalVersion;
	const rowChanged = cellSlot.lastMountedRowVersion !== -1 && rowVersion !== undefined && rowVersion !== cellSlot.lastMountedRowVersion;
	const isDataStale = !isRowRebind && canFreezePortal && (globalChanged || rowChanged);
	const isPortalFrozen =
		!isRowRebind && canFreezePortal && (!isDataStale || (isPortalSnapshotContent(snapshot) && snapshot.contentKind === 'portal-frozen'));
	const isStaleFrozen = (isRowRebind || isDataStale) && canFreezePortal;
	const hasSnapshotCoverageForDecorations = !ctx.hasInsightDecorations || !!snapshot;
	const shouldDirtyFrozenPortal =
		isFocused ||
		isEditing ||
		!hasSnapshotCoverageForDecorations ||
		(ctx.hasDeferredCellStyleRules &&
			(!snapshot || ctx.styleChangedDuringScroll || ctx.selectionChangedDuringScroll || ctx.loadingChangedDuringScroll));

	if (isPortalFrozen || isStaleFrozen) {
		deps.cellRenderer.showPortalContent(cellSlot.element);
		contentMode = 'portal';

		if (isPortalFrozen && scrollMode === 'custom-live') {
			cellSlot.lastMountedRowVersion = rowVersion;
			cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
		} else if (!isPortalFrozen || shouldDirtyFrozenPortal) {
			deps.markCellDirtyAfterScroll(cellSlot.element);
		}
	} else {
		if (cellSlot.lastPortalKey && cellSlot.lastPortalKey !== portalCellKey) {
			deps.releaseCellPortal(cellSlot.element, undefined, 'scrolled-out');
		}
		deps.markCellDirtyAfterScroll(cellSlot.element);
		const ensuredPortalHost = deps.ensureCellPortalHost(cellSlot.element);
		deps.portalMountManager.mountCellImmediately({
			cellKey: portalCellKey,
			container: ensuredPortalHost,
			value: getScrollMountValue(deps, node, col, cellSlot),
			node,
			col,
			rowIndex,
			colIndex,
			rowSlotId: pooledRowId,
			slotGeneration: request.pooledRowGeneration,
			cellRowBindingGeneration: cellSlot.rowBindingGeneration,
			cellInstanceId: cellSlot.cellInstanceId,
			portalHostId: cellSlot.portalHostId,
			isEditing,
			isLoading: isRowLoading,
			phase: 'scroll',
			isScrolling: false,
			isFocused,
			isSelected: false,
		});
		contentMode = 'portal';
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
	}
	applyCellTitlesAndValidation(cellSlot.element, snapshot?.title || null, '', snapshot?.validationError);

	const didWrite = cellSlot.update(
		colIndex,
		col.field,
		rowIndex,
		node.id,
		left,
		right,
		width,
		cellClassName,
		contentMode,
		undefined,
		formattedValue,
		contentMode === 'portal' ? portalCellKey : undefined
	);
	if (snapshot) {
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
		recordCellSlotMountedVisualVersions(cellSlot, snapshot);
	}
	if (didWrite) deps.incrementCurrentScrollCellsWritten();
	deps.incrementCellsBoundDuringScroll();
}
