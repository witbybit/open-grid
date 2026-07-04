import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { isHtmlSnapshotPresentation } from '../scrollPresentationMode.js';
import { applyCellTitlesAndValidation, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'text-impostor' — the explicit, always-on text/chip stand-in via
 * capabilities.textImpostor.render ('text-impostor' kind). Also handles 'impostor-text', the
 * implicit text fallback used by 'freeze' mode (from a snapshot that demanded impostor) and by
 * 'html-snapshot' mode when allowTextFallbackWhenMissing is set — both share the identical apply
 * shape, differing only in which telemetry counter increments.
 */
export function applyTextImpostorCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: Extract<ScrollCellPresentation, { kind: 'text-impostor' | 'impostor-text' }>,
	rowVersion: number
): void {
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;

	if (presentation.kind === 'impostor-text') {
		if (isHtmlSnapshotPresentation(col)) deps.incrementHtmlSnapshotMissesDuringScroll?.();
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
		stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersionsFrom);
		if (didWrite) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	}

	// 'text-impostor'
	deps.incrementTextImpostorUsesDuringScroll?.();
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
}
