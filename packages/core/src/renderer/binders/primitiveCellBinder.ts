import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { applyCellTitlesAndValidation, recordDispatchWrite, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'primitive' — fast text/class patch, no renderer, no portal, no HTML snapshot.
 * Also handles the 'buffered' kind (an off-screen cell reusing/clearing its last-known content),
 * which is presentation-orthogonal but shares this binder's plain cellSlot.update() shape.
 */
export function applyPrimitiveCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;

	switch (presentation.kind) {
		case 'buffered': {
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
			const didWrite = cellSlot.update(
				geometry.colIndex,
				cellCtrl.field,
				geometry.rowIndex,
				cellCtrl.rowId,
				geometry.left,
				geometry.right,
				geometry.width,
				presentation.className,
				presentation.contentMode ?? 'empty',
				undefined,
				presentation.formattedValue ?? '',
				presentation.portalKey,
				0,
				input.phase === 'full-bind' ? cellCtrl.visualState.selected : undefined
			);
			if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
			recordDispatchWrite(input, didWrite);
			return;
		}

		case 'primitive': {
			if (input.phase === 'scroll' && presentation.markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
			const didWrite = cellSlot.update(
				geometry.colIndex,
				cellCtrl.field,
				geometry.rowIndex,
				cellCtrl.rowId,
				geometry.left,
				geometry.right,
				geometry.width,
				presentation.className,
				presentation.contentMode ?? 'text',
				undefined,
				presentation.formattedValue ?? '',
				undefined,
				0,
				input.phase === 'full-bind' ? cellCtrl.visualState.selected : undefined
			);
			if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
			recordDispatchWrite(input, didWrite);
			return;
		}

		case 'full-bind-primitive':
		case 'full-bind-loading': {
			if (presentation.kind === 'full-bind-loading') deps.cellRenderer.ensureLoadingSkeleton(cellSlot.element);
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
			const didWrite = cellSlot.update(
				geometry.colIndex,
				cellCtrl.field,
				geometry.rowIndex,
				cellCtrl.rowId,
				geometry.left,
				geometry.right,
				geometry.width,
				presentation.className,
				presentation.kind === 'full-bind-loading' ? 'loading' : (presentation.contentMode ?? 'text'),
				cellCtrl.valueState.value,
				presentation.formattedValue ?? '',
				undefined,
				0,
				input.phase === 'full-bind' ? cellCtrl.visualState.selected : undefined
			);
			recordDispatchWrite(input, didWrite);
			return;
		}
	}
}
