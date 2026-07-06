import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import { isHtmlSnapshotPresentation } from '../scrollPresentationMode.js';
import { applyCellTitlesAndValidation, stampMountedVersions } from './binderShared.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { createCellRendererLifecycle } from '../lifecycle/cellRendererLifecycle.js';

/**
 * scrollPresentation: 'text-impostor' — the explicit, always-on text/chip stand-in via
 * capabilities.textImpostor.render ('text-impostor' kind). Also handles 'impostor-text', the
 * implicit text fallback used by 'freeze' mode (from a snapshot that demanded impostor) and by
 * 'html-snapshot' mode when allowTextFallbackWhenMissing is set — both share the identical apply
 * shape, differing only in which telemetry counter increments.
 */
export function applyTextImpostorCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, request, cellCtrl, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;
	const lifecycle = createCellRendererLifecycle(deps);

	if (presentation.kind === 'impostor-text') {
		if (isHtmlSnapshotPresentation(col)) deps.incrementHtmlSnapshotMissesDuringScroll?.();
		if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'invalidated', cellElement: cellSlot.element });
		deps.markCellDirtyAfterScroll(cellSlot.element);
		applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
		const didWrite = cellSlot.update(
			colIndex,
			col.field,
			rowIndex,
			node.id,
			left,
			right,
			width,
			presentation.className,
			presentation.contentMode ?? 'fallback',
			undefined,
			presentation.formattedValue ?? '',
			undefined
		);
		if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersions);
		if (didWrite) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	}

	// 'text-impostor'
	deps.incrementTextImpostorUsesDuringScroll?.();
	if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'invalidated', cellElement: cellSlot.element });
	deps.markCellDirtyAfterScroll(cellSlot.element);
	applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
	const didWrite = cellSlot.update(
		colIndex,
		col.field,
		rowIndex,
		node.id,
		left,
		right,
		width,
		presentation.className,
		presentation.contentMode ?? 'fallback',
		undefined,
		presentation.formattedValue ?? '',
		undefined
	);
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
	if (presentation.recordVersions && !('rowId' in presentation.recordVersions)) {
		recordCellSlotMountedVisualVersions(cellSlot, presentation.recordVersions);
	}
	if (didWrite) deps.incrementCurrentScrollCellsWritten();
	deps.incrementCellsBoundDuringScroll();
}
