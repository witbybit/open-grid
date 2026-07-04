import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { applyCellTitlesAndValidation, getScrollMountValue, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'live' — the real renderer is mounted/updated on every scroll frame this cell
 * is bound ('live-mount'). Also handles 'force-live-interactive-exception': the rare, freeze-mode-only
 * case where an actively editing/focused cell must mount live despite not declaring 'live' —
 * counted under a separate telemetry counter so a regression firing it for a non-interactive cell
 * stays visible.
 */
export function applyLiveCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: Extract<ScrollCellPresentation, { kind: 'live-mount' | 'force-live-interactive-exception' }>,
	rowVersion: number
): void {
	const { cellSlot, node, rowIndex, colIndex, col, ctx, pooledRowId, left, right, width, isRowLoading } = request;

	if (presentation.kind === 'force-live-interactive-exception') {
		// The sole exception permitted to mount live during active scroll — see the type comment on
		// ScrollCellPresentation. Counted separately from every other mount/portal metric on purpose:
		// if this ever fires for a cell that isn't actively editing/focused, that's a regression, and
		// folding it into a generic counter would hide it.
		deps.incrementForceLiveMountsDuringScroll?.();
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
			// Honest phase/isScrolling: this mount genuinely happens mid-scroll (the sole force-live
			// exception), unlike ordinary 'scroll'-phase mounts which never occur during active
			// scroll. A renderer that special-cases scrolling deserves to know it's really scrolling.
			phase: 'scroll-force-live',
			isScrolling: true,
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
		if (presentation.recordVersionsFrom) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersionsFrom);
		if (didWrite) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	}

	// 'live-mount' — scrollPresentation:'live' — mounts/updates the real renderer on every scroll
	// frame this cell is bound. Expected to fire continuously for these columns; see
	// incrementForceLiveMountsDuringScroll above for the separate, rare freeze-mode exception.
	deps.incrementLiveReactMountsDuringScroll?.();
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
		phase: 'scroll-live',
		isScrolling: true,
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
	if (presentation.recordVersionsFrom) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersionsFrom);
	if (didWrite) deps.incrementCurrentScrollCellsWritten();
	deps.incrementCellsBoundDuringScroll();
}
