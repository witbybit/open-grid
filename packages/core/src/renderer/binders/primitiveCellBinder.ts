import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { applyCellTitlesAndValidation, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'primitive' — fast text/class patch, no renderer, no portal, no HTML snapshot.
 * Also handles the 'buffered' kind (an off-screen cell reusing/clearing its last-known content),
 * which is presentation-orthogonal but shares this binder's plain cellSlot.update() shape.
 */
export function applyPrimitiveCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: Extract<ScrollCellPresentation, { kind: 'buffered' | 'primitive' }>,
	rowVersion: number
): void {
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;

	switch (presentation.kind) {
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
			if (presentation.recordVersionsFrom) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersionsFrom);
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
			if (presentation.recordVersionsFrom) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersionsFrom);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}
	}
}
