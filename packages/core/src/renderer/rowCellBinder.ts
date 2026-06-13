import type { GridEngine } from '../engine/GridEngine.js';
import { createEditRendererKey, createSlotRendererKey } from './identityKeys.js';
import { reportRendererFault } from './rendererFaults.js';
import type { CellRendererPhase, ColumnDef, GridCellClassParams, GridCellPointer, GridState, InternalColumnDef, RowNode } from '../store.js';
import type { CellSlot, CellContentMode } from './cellSlot.js';
import type { CellRenderer } from './cellRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';

function buildCellPinClass(colIndex: number, pinLeftColumns: number, pinRightStart: number): string {
	if (colIndex < pinLeftColumns) return 'og-cell og-cell-pinned-left';
	if (colIndex >= pinRightStart) return 'og-cell og-cell-pinned-right';
	return 'og-cell';
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
	cancelPendingPortalRelease: (cellKey: string) => void;
	incrementStyleHookCallsDuringScroll: () => void;
	incrementCellsBoundDuringScroll: () => void;
	incrementCurrentScrollCellsWritten: () => void;
}

export interface BindCellFullRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	slotId: string;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	pinLeftColumns: number;
	pinRightColumns: number;
	pinRightStart: number;
	pinRightBaseLeft: number;
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	state: GridState<TRowData>;
	ctx?: ScrollRenderContext<TRowData>;
	phase?: CellRendererPhase;
}

export interface BindCellDuringScrollRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	pinLeftColumns: number;
	pinRightStart: number;
	ctx: ScrollRenderContext<TRowData>;
	pooledRowId: string;
	left: number;
	right: number;
	width: number;
	isRowRebind: boolean;
	isRowLoading: boolean;
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
		if (cachedVal !== undefined) return cachedVal;
		return cellSlot?.lastFormattedValue ?? '';
	}
	if (col.valueGetter || deps.engine.hasFormula(node.id, col.field)) {
		const val = deps.engine.data.getCellValue(node.id, col.field);
		return val == null ? '' : String(val);
	}
	const raw = node.data ? (node.data as Record<string, unknown>)[col.field] : undefined;
	return raw == null ? '' : String(raw);
}

function getScrollMountValue<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	cellSlot?: CellSlot<TRowData>
): unknown {
	const cachedVal = deps.engine.data.getCachedDisplayValue(node.id, col.field);
	if (cachedVal !== undefined) return cachedVal;
	return cellSlot?.lastFormattedValue ?? '';
}

export function bindCellFull<TRowData>(deps: RowCellBinderDeps<TRowData>, request: BindCellFullRequest<TRowData>): void {
	const {
		cellSlot,
		slotId,
		node,
		rowIndex,
		colIndex,
		col,
		pinLeftColumns,
		pinRightStart,
		pinRightBaseLeft,
		plan,
		state,
		ctx,
		phase = 'initial',
	} = request;
	const access = deps.engine.cellAccess.get(node.id, rowIndex, node, node.data, colIndex, col, undefined, state);

	let cellClassName = buildCellPinClass(colIndex, pinLeftColumns, pinRightStart);
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

	if (state.styleSlots?.cellClass && node.data) {
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
			const customCellClass = state.styleSlots.cellClass(col, node.data, s);
			if (customCellClass) cellClassName += ' ' + customCellClass;
		} catch (e) {
			reportRendererFault(deps.engine, 'cell-class', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
		}
	}

	if (state.styleSlots?.beforeCellRender) {
		try {
			state.styleSlots.beforeCellRender(access, cellSlot.element);
		} catch (e) {
			reportRendererFault(deps.engine, 'before-cell-render', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
		}
	}

	const isPinRight = colIndex >= pinRightStart;
	const cellLeft = plan.colLefts[colIndex];
	const leftArg = isPinRight ? cellLeft - pinRightBaseLeft : cellLeft;
	const cellWidth = plan.colWidths[colIndex];

	if (col.checkboxSelection) {
		const cell = cellSlot.contentElement;
		const rowId = node.id;
		const isChecked = (deps.selectionPaint.selectedRowIdSet ?? new Set(state.selectedRowIds)).has(rowId);
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
				if ((e as MouseEvent).shiftKey && deps.selectionPaint.rowCheckboxAnchorId) {
					const rangeIds = deps.selectionPaint.getDataRowIdsBetween(deps.selectionPaint.rowCheckboxAnchorId, id);
					if (rangeIds.length > 0) {
						if (shouldSelect) deps.engine.selectRowIds(rangeIds, 'checkbox');
						else deps.engine.deselectRowIds(rangeIds, 'checkbox');
					}
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
		cellSlot.update(colIndex, col.field, rowIndex, node.id, leftArg, -1, cellWidth, cellClassName, 'custom', undefined, '', undefined);
		return;
	}

	const stableKey = access.isEditing ? createEditRendererKey(node.id, col.field) : createSlotRendererKey(slotId, col.field);
	let contentMode: CellContentMode = 'empty';
	let formattedValue = '';

	if (((col as InternalColumnDef<TRowData>).cellRenderer || access.isEditing) && !access.isLoading) {
		contentMode = 'portal';
		if (cellSlot.element.dataset.cellKey !== stableKey || !deps.portalMountManager.isCellMounted(stableKey)) {
			if (cellSlot.element.dataset.cellKey) {
				deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			}
			cellSlot.contentElement.textContent = '';
		}
		const portalHost = deps.ensureCellPortalHost(cellSlot.element);
		deps.cellRenderer.showPortalContent(cellSlot.element);
		deps.cancelPendingPortalRelease(stableKey);
		deps.portalMountManager.mountCell({
			cellKey: stableKey,
			container: portalHost,
			value: access.value,
			node,
			col,
			rowIndex,
			colIndex,
			rowSlotId: slotId,
			isEditing: access.isEditing,
			isLoading: access.isLoading,
			phase: access.isEditing ? 'edit' : phase,
			isScrolling: false,
			isFocused: access.isFocused,
			isSelected: access.isSelected,
		});
	} else {
		if (cellSlot.element.dataset.cellKey) {
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
		contentMode === 'portal' ? stableKey : undefined
	);

	if (state.styleSlots?.afterCellRender) {
		try {
			state.styleSlots.afterCellRender(access, cellSlot.element);
		} catch (e) {
			reportRendererFault(deps.engine, 'after-cell-render', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
		}
	}
}

export function bindCellDuringScroll<TRowData>(deps: RowCellBinderDeps<TRowData>, request: BindCellDuringScrollRequest<TRowData>): void {
	const {
		cellSlot,
		node,
		rowIndex,
		colIndex,
		col,
		pinLeftColumns,
		pinRightStart,
		ctx,
		pooledRowId,
		left,
		right,
		width,
		isRowRebind,
		isRowLoading,
	} = request;

	if (col.checkboxSelection) {
		deps.markCellDirtyAfterScroll(cellSlot.element);
		const cellClassName = buildCellPinClass(colIndex, pinLeftColumns, pinRightStart) + ' og-cell-row-selector';
		cellSlot.update(colIndex, col.field, rowIndex, node.id, left, right, width, cellClassName, 'custom', undefined, '', undefined);
		return;
	}

	const plan = ctx.plan.columnPlans[colIndex];
	const isEditing = !!(ctx.activeEdit && ctx.activeEdit.rowId === node.id && ctx.activeEdit.colField === col.field);
	const rendererKind: 'primitive' | 'portal' | 'loading' = isRowLoading ? 'loading' : isEditing || plan?.isCustom ? 'portal' : 'primitive';

	let cellClassName = buildCellPinClass(colIndex, pinLeftColumns, pinRightStart);
	if (rendererKind === 'loading') cellClassName += ' og-cell-loading';

	if (ctx.focusedCell && ctx.focusedCell.rowId === node.id && ctx.focusedCell.colField === col.field) {
		cellSlot.element.tabIndex = -1;
		cellSlot.hasTabIndex = true;
		const programmaticScrollCell = deps.programmaticScrollCell;
		const isProgrammatic = programmaticScrollCell && programmaticScrollCell.rowId === node.id && programmaticScrollCell.colField === col.field;
		deps.setDeferredFocusCell(cellSlot.element);
		if (isProgrammatic) deps.clearProgrammaticScrollCell();
	}

	if (ctx.hasStyleHooks) {
		deps.markCellDirtyAfterScroll(cellSlot.element);
		deps.incrementStyleHookCallsDuringScroll();
	}

	let contentMode: CellContentMode = 'empty';
	let formattedValue = '';

	if (rendererKind === 'loading') {
		contentMode = 'loading';
	} else if (rendererKind !== 'portal') {
		const cachedVal = deps.engine.data.getCachedDisplayValue(node.id, col.field);
		if (cachedVal !== undefined) {
			formattedValue = cachedVal;
			contentMode = formattedValue === '' ? 'empty' : 'text';
		} else {
			formattedValue = '...';
			contentMode = 'text';
			deps.markCellDirtyAfterScroll(cellSlot.element);
		}
		if (cellSlot.element.dataset.cellKey) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
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
		if (didWritePrimitive) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	} else {
		contentMode = 'portal';
	}

	const cellKey = isEditing ? createEditRendererKey(node.id, col.field) : createSlotRendererKey(pooledRowId, col.field);
	const scrollMode = plan?.mode;
	const isFocused = ctx.focusedCell?.rowId === node.id && ctx.focusedCell?.colField === col.field;
	const isMounted = deps.portalMountManager.isCellMounted(cellKey);
	const canFreezePortal = cellSlot.lastPortalKey === cellKey && isMounted;
	const globalChanged = cellSlot.lastMountedGlobalVersion !== -1 && ctx.globalVersion !== cellSlot.lastMountedGlobalVersion;
	const rowChanged =
		cellSlot.lastMountedRowVersion !== -1 &&
		ctx.rowVersions.get(node.id) !== undefined &&
		ctx.rowVersions.get(node.id) !== cellSlot.lastMountedRowVersion;
	const isDataStale = !isRowRebind && canFreezePortal && (globalChanged || rowChanged);
	const isPortalFrozen = !isRowRebind && canFreezePortal && !isDataStale;
	const isStaleFrozen = (isRowRebind || isDataStale) && canFreezePortal;

	if (isPortalFrozen || isStaleFrozen) {
		deps.cellRenderer.showPortalContent(cellSlot.element);
		deps.cancelPendingPortalRelease(cellKey);
		contentMode = 'portal';

		if (isPortalFrozen && scrollMode === 'custom-live') {
			const portalHost = deps.ensureCellPortalHost(cellSlot.element);
			deps.portalMountManager.mountCellImmediately({
				cellKey,
				container: portalHost,
				value: getScrollMountValue(deps, node, col, cellSlot),
				node,
				col,
				rowIndex,
				colIndex,
				rowSlotId: pooledRowId,
				isEditing,
				isLoading: false,
				phase: 'scroll',
				isScrolling: false,
				isFocused,
				isSelected: false,
			});
			cellSlot.lastMountedRowVersion = ctx.rowVersions.get(node.id) ?? -1;
			cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
		} else {
			deps.markCellDirtyAfterScroll(cellSlot.element);
		}
	} else {
		if (cellSlot.lastPortalKey && cellSlot.lastPortalKey !== cellKey) {
			deps.releaseCellPortal(cellSlot.element, undefined, 'scrolled-out');
		}
		const portalHost = deps.ensureCellPortalHost(cellSlot.element);
		deps.portalMountManager.mountCellImmediately({
			cellKey,
			container: portalHost,
			value: getScrollMountValue(deps, node, col, cellSlot),
			node,
			col,
			rowIndex,
			colIndex,
			rowSlotId: pooledRowId,
			isEditing,
			isLoading: isRowLoading,
			phase: 'scroll',
			isScrolling: false,
			isFocused,
			isSelected: false,
		});
		contentMode = 'portal';
		cellSlot.lastMountedRowVersion = ctx.rowVersions.get(node.id) ?? -1;
		cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
	}

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
		contentMode === 'portal' ? cellKey : undefined
	);
	if (didWrite) deps.incrementCurrentScrollCellsWritten();
	deps.incrementCellsBoundDuringScroll();
}
