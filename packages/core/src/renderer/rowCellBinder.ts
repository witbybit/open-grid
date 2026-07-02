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
import { isVisualFresh } from './visualFreshness.js';
import { resolveScrollCellPresentation, type ScrollCellPresentation } from './scrollCellPresentation.js';

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
	const scrollMode = plan.columnPlans[colIndex]?.mode;
	let contentMode: CellContentMode = 'empty';
	let formattedValue = '';
	let portalImpostorValue = '';
	const hasScrollSnapshotHtmlCap = (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.scrollSnapshot === 'html';
	// scrollSnapshot: 'html' — capture the committed HTML of an already-live portal on every full
	// (non-scroll) bind, not just the scroll freeze-in-place moment. Without this, a cell only ever
	// gets a frozen clone after surviving one prior scroll-while-visible cycle; any normal re-render
	// (selection, focus, unrelated repaint elsewhere in the grid) settles this cell's portal without
	// ever reading its committed DOM, so the very first scroll after that settle still falls back to
	// plain text. Reading here — before this bind decides whether to release/remount the portal —
	// means the cell already "looks frozen" the first time it is ever scrolled.
	let freshFrozenHtml: string | undefined;
	let freshFrozenRowHeight: number | undefined;
	if (hasScrollSnapshotHtmlCap && cellSlot.lastPortalKey === stableKey && deps.portalMountManager.isCellMounted(stableKey)) {
		const existingHost = deps.getCellPortalHost(cellSlot.element);
		if (existingHost && existingHost.childElementCount > 0) {
			freshFrozenHtml = existingHost.innerHTML;
			freshFrozenRowHeight = deps.engine.geometry?.rowHeights?.[rowIndex];
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
		const scrollImpostorFn = (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.scrollImpostor;
		portalImpostorValue =
			scrollImpostorFn != null
				? scrollImpostorFn({ value: access.value, formattedValue: formattedForImpostor }) || formattedForImpostor
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
	// Prefer the HTML captured fresh above (this bind's own committed portal read). Otherwise carry
	// frozenHtml/frozenRowHeight forward from the previous snapshot so the scroll impostor can still
	// replay the styled clone — e.g. when this bind's portal key changed and nothing was available to
	// read this time. Guard on rowVersion: if the row's data changed, the captured HTML is stale —
	// drop it so the next capture reflects the updated badge/chip rather than replaying ghost data.
	const prevSnapshot = hasScrollSnapshotHtmlCap ? deps.engine.cellDisplaySnapshots.get(node.id, col.field) : undefined;
	const carriedFrozenHtml = prevSnapshot?.rowVersion === rowVersion ? prevSnapshot.frozenHtml : undefined;
	const carriedFrozenRowHeight = prevSnapshot?.rowVersion === rowVersion ? prevSnapshot.frozenRowHeight : undefined;
	const prevFrozenHtml = freshFrozenHtml ?? carriedFrozenHtml;
	const prevFrozenRowHeight = freshFrozenHtml !== undefined ? freshFrozenRowHeight : carriedFrozenRowHeight;
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
			frozenHtml: prevFrozenHtml,
			frozenRowHeight: prevFrozenRowHeight,
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
	const cellKey = createCellInstanceRendererKey(cellSlot.cellInstanceId, col.field);
	const snapshot = getFreshCellSnapshot(deps, node.id, col.field, ctx);

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

	// 2. Resolve what to show — the only place that decides, never mutates.
	const presentation = resolveScrollCellPresentation(deps, {
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

	// 3. Apply the resolved presentation, enqueue fidelity work, update mounted slot bookkeeping.
	applyScrollCellPresentation(deps, request, presentation, rowVersion);
}

function applyScrollCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: ScrollCellPresentation,
	rowVersion: number
): void {
	const { cellSlot, node, rowIndex, colIndex, col, ctx, pooledRowId, left, right, width, isRowLoading } = request;

	const stampMountedVersions = (source: CellDisplaySnapshot): void => {
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
		recordCellSlotMountedVisualVersions(cellSlot, source);
	};

	switch (presentation.kind) {
		case 'checkbox-selector': {
			if (presentation.markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);
			cellSlot.update(colIndex, col.field, rowIndex, node.id, left, right, width, presentation.className, 'custom', undefined, '', undefined);
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

		case 'buffered': {
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			const didWrite = cellSlot.update(
				colIndex,
				col.field,
				rowIndex,
				node.id,
				left,
				right,
				width,
				presentation.className,
				presentation.contentMode,
				undefined,
				presentation.formattedValue,
				presentation.portalKey
			);
			if (presentation.recordVersionsFrom) stampMountedVersions(presentation.recordVersionsFrom);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'primitive': {
			if (presentation.markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			const didWrite = cellSlot.update(
				colIndex,
				col.field,
				rowIndex,
				node.id,
				left,
				right,
				width,
				presentation.className,
				presentation.contentMode,
				undefined,
				presentation.formattedValue,
				undefined
			);
			if (presentation.recordVersionsFrom) stampMountedVersions(presentation.recordVersionsFrom);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'freeze-live-portal': {
			// Freeze: keep existing portal content visible during scroll without remounting it.
			deps.cellRenderer.showPortalContent(cellSlot.element);
			if (presentation.snapshotForCapture) {
				applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			}
			if (presentation.shouldMarkDirty) deps.markCellDirtyAfterScroll(cellSlot.element);

			// scrollSnapshot: 'html' — the portal host has live committed React content right now.
			// Capture its innerHTML and patch the snapshot so future impostor renders for this row
			// can replay the styled HTML instead of falling back to plain text. React commits async,
			// so this freeze moment is the only reliable place to read committed DOM content.
			if (presentation.captureFrozenHtml && presentation.snapshotForCapture) {
				const snapshot = presentation.snapshotForCapture;
				const portalHost = deps.getCellPortalHost(cellSlot.element);
				const html = portalHost?.innerHTML;
				if (html && html !== snapshot.frozenHtml) {
					const capturedRowHeight = deps.engine.geometry?.rowHeights?.[rowIndex];
					deps.engine.cellDisplaySnapshots.set({ ...snapshot, frozenHtml: html, frozenRowHeight: capturedRowHeight });
				}
			}

			const didWrite = cellSlot.update(
				colIndex,
				col.field,
				rowIndex,
				node.id,
				left,
				right,
				width,
				presentation.className,
				'portal',
				undefined,
				'',
				presentation.portalCellKey
			);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'impostor-html': {
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			deps.markCellDirtyAfterScroll(cellSlot.element);
			applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			// HTML snapshot path: inject the static clone of the last fidelity render into the
			// portal host so the cell looks identical to its settled state during scroll. The host
			// is inert — no React fiber, no event handlers — and the fidelity lane will replace it
			// with the live portal on the next post-scroll pass.
			const portalHost = deps.ensureCellPortalHost(cellSlot.element);
			portalHost.innerHTML = presentation.frozenHtml;
			deps.cellRenderer.showPortalContent(cellSlot.element);
			const didWrite = cellSlot.update(
				colIndex,
				col.field,
				rowIndex,
				node.id,
				left,
				right,
				width,
				presentation.className,
				'portal',
				undefined,
				'',
				undefined
			);
			stampMountedVersions(presentation.recordVersionsFrom);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'impostor-text': {
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			deps.markCellDirtyAfterScroll(cellSlot.element);
			applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			const didWrite = cellSlot.update(
				colIndex,
				col.field,
				rowIndex,
				node.id,
				left,
				right,
				width,
				presentation.className,
				presentation.contentMode,
				undefined,
				presentation.formattedValue,
				undefined
			);
			stampMountedVersions(presentation.recordVersionsFrom);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'impostor-synthetic': {
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			deps.markCellDirtyAfterScroll(cellSlot.element);
			applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			const didWrite = cellSlot.update(
				colIndex,
				col.field,
				rowIndex,
				node.id,
				left,
				right,
				width,
				presentation.className,
				presentation.contentMode,
				undefined,
				presentation.formattedValue,
				undefined
			);
			cellSlot.lastMountedRowVersion = rowVersion;
			cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
			recordCellSlotMountedVisualVersions(cellSlot, presentation.recordVersions);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'portal-frozen': {
			deps.cellRenderer.showPortalContent(cellSlot.element);
			if (presentation.keepVersionFresh) {
				cellSlot.lastMountedRowVersion = rowVersion;
				cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
			} else if (presentation.markDirty) {
				deps.markCellDirtyAfterScroll(cellSlot.element);
			}
			applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			const didWrite = cellSlot.update(
				colIndex,
				col.field,
				rowIndex,
				node.id,
				left,
				right,
				width,
				presentation.className,
				'portal',
				undefined,
				'',
				presentation.portalCellKey
			);
			if (presentation.recordVersionsFrom) stampMountedVersions(presentation.recordVersionsFrom);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'portal-mount': {
			if (presentation.releasePriorPortal) deps.releaseCellPortal(cellSlot.element, undefined, 'scrolled-out');
			deps.markCellDirtyAfterScroll(cellSlot.element);
			const ensuredPortalHost = deps.ensureCellPortalHost(cellSlot.element);
			deps.portalMountManager.mountCellImmediately({
				cellKey: presentation.portalCellKey,
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
				isEditing: presentation.isEditing,
				isLoading: isRowLoading,
				phase: 'scroll',
				isScrolling: false,
				isFocused: presentation.isFocused,
				isSelected: false,
			});
			cellSlot.lastMountedRowVersion = rowVersion;
			cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
			applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			const didWrite = cellSlot.update(
				colIndex,
				col.field,
				rowIndex,
				node.id,
				left,
				right,
				width,
				presentation.className,
				'portal',
				undefined,
				'',
				presentation.portalCellKey
			);
			if (presentation.recordVersionsFrom) stampMountedVersions(presentation.recordVersionsFrom);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}
	}
}
