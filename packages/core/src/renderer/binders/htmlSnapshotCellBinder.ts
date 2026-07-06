import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import { applyCellTitlesAndValidation, stampMountedVersions } from './binderShared.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { createCellRendererLifecycle } from '../lifecycle/cellRendererLifecycle.js';

/**
 * scrollPresentation: 'html-snapshot' — replays a captured inert HTML clone during scroll
 * ('impostor-html'). When no fresh capture is available and text fallback isn't explicitly allowed,
 * shows a stable shell/pending placeholder instead of raw text ('html-snapshot-pending').
 */
export function applyHtmlSnapshotCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, request, cellCtrl, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;
	const lifecycle = createCellRendererLifecycle(deps);

	if (presentation.kind === 'html-snapshot-pending') {
		deps.incrementHtmlSnapshotMissesDuringScroll?.();
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
			'pending',
			undefined,
			'',
			undefined
		);
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
		if (presentation.recordVersions && !('rowId' in presentation.recordVersions)) {
			recordCellSlotMountedVisualVersions(cellSlot, presentation.recordVersions);
		}
		if (didWrite) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	}

	// 'impostor-html'
	deps.incrementHtmlSnapshotHitsDuringScroll?.();
	if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'invalidated', cellElement: cellSlot.element });
	deps.markCellDirtyAfterScroll(cellSlot.element);
	applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
	// HTML snapshot path: inject the static clone of the last fidelity render into the
	// portal host so the cell looks identical to its settled state during scroll. The host
	// is inert — no React fiber, no event handlers — and the fidelity lane will replace it
	// with the live portal on the next post-scroll pass.
	const portalHost = deps.ensureCellPortalHost(cellSlot.element);
	portalHost.innerHTML = presentation.html ?? '';
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
	if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersions);
	if (didWrite) deps.incrementCurrentScrollCellsWritten();
	deps.incrementCellsBoundDuringScroll();
}
