import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { applyCellTitlesAndValidation, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'primitive' — fast text/class patch, no renderer, no portal, no HTML snapshot.
 * Also handles the 'buffered' kind (an off-screen cell reusing/clearing its last-known content),
 * which is presentation-orthogonal but shares this binder's plain cellSlot.update() shape.
 */
export function applyPrimitiveCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, request, cellCtrl, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;

	switch (presentation.kind) {
		case 'buffered': {
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
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
				presentation.contentMode ?? 'empty',
				undefined,
				presentation.formattedValue ?? '',
				presentation.portalKey
			);
			if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersions);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'primitive': {
			if (presentation.markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
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
				presentation.contentMode ?? 'text',
				undefined,
				presentation.formattedValue ?? '',
				undefined
			);
			if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersions);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}
	}
}
