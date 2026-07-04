import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { applyCellTitlesAndValidation, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'html-snapshot' — replays a captured inert HTML clone during scroll
 * ('impostor-html'). When no fresh capture is available and text fallback isn't explicitly allowed,
 * shows a stable shell/pending placeholder instead of raw text ('html-snapshot-pending').
 */
export function applyHtmlSnapshotCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: Extract<ScrollCellPresentation, { kind: 'impostor-html' | 'html-snapshot-pending' }>,
	rowVersion: number
): void {
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;

	if (presentation.kind === 'html-snapshot-pending') {
		deps.incrementHtmlSnapshotMissesDuringScroll?.();
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
			'pending',
			undefined,
			'',
			undefined
		);
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
		recordCellSlotMountedVisualVersions(cellSlot, presentation.recordVersions);
		if (didWrite) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	}

	// 'impostor-html'
	deps.incrementHtmlSnapshotHitsDuringScroll?.();
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
	stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersionsFrom);
	if (didWrite) deps.incrementCurrentScrollCellsWritten();
	deps.incrementCellsBoundDuringScroll();
}
