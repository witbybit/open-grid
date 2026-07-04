import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { applyCellTitlesAndValidation, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'freeze' — an existing live portal may remain visually frozen during scroll;
 * cold cells show a cheap synthetic impostor and wait for the fidelity lane. Also handles
 * 'checkbox-selector' (presentation-orthogonal, no other natural home) since it shares this binder's
 * "no renderer mount, no HTML/text impostor machinery" shape.
 */
export function applyFreezeCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: Extract<ScrollCellPresentation, { kind: 'checkbox-selector' | 'freeze-live-portal' | 'portal-frozen' | 'impostor-synthetic' }>,
	rowVersion: number
): void {
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;

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

		case 'freeze-live-portal': {
			// Freeze: keep existing portal content visible during scroll without remounting it.
			deps.cellRenderer.showPortalContent(cellSlot.element);
			if (presentation.snapshotForCapture) {
				applyCellTitlesAndValidation(cellSlot.element, presentation.title, '', presentation.validationError);
			}
			if (presentation.shouldMarkDirty) deps.markCellDirtyAfterScroll(cellSlot.element);

			// scrollPresentation: 'html-snapshot' — the portal host has live committed React content right now.
			// Capture its innerHTML into the HTML snapshot store so future impostor renders for this
			// row can replay the styled HTML instead of falling back to plain text. React commits
			// async, so this freeze moment is the only reliable place to read committed DOM content.
			if (presentation.captureFrozenHtml && presentation.snapshotForCapture) {
				const snapshot = presentation.snapshotForCapture;
				const portalHost = deps.getCellPortalHost(cellSlot.element);
				const html = portalHost?.innerHTML;
				// `snapshot` (a CellDisplaySnapshot) already extends VisualFreshness — pass it directly
				// as the freshness stamp rather than re-deriving it.
				const existing = deps.engine.htmlScrollSnapshots.get(snapshot.rowId, snapshot.colField, snapshot);
				if (html && html !== existing?.html) {
					const capturedRowHeight = deps.engine.geometry?.rowHeights?.[rowIndex];
					const capturedColWidth = ctx.plan?.colWidths?.[colIndex];
					deps.engine.htmlScrollSnapshots.set(snapshot.rowId, snapshot.colField, html, snapshot, capturedRowHeight, capturedColWidth);
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
			if (presentation.recordVersionsFrom) stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersionsFrom);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}
	}
}
