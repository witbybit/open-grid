import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import { getColumnInstanceIdentity } from '../../columnDef.js';
import { createCellRendererLifecycle } from '../lifecycle/cellRendererLifecycle.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { applyCellTitlesAndValidation, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'freeze' - an existing live portal may remain visually frozen during scroll;
 * cold cells show a cheap synthetic impostor and wait for the fidelity lane.
 */
export function applyFreezeCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, request, cellCtrl, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;
	const lifecycle = createCellRendererLifecycle(deps);

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
			deps.cellRenderer.showPortalContent(cellSlot.element);
			const portalHost = deps.getCellPortalHost(cellSlot.element);
			if (portalHost) lifecycle.freeze({ cellCtrl, host: portalHost });
			applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
			if (presentation.markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);

			if (presentation.captureFrozenHtml && presentation.recordVersions && 'rowId' in presentation.recordVersions && portalHost?.innerHTML) {
				const snapshot = presentation.recordVersions;
				const columnInstanceId = getColumnInstanceIdentity(col);
				const existing = deps.engine.htmlScrollSnapshots.getFresh
					? deps.engine.htmlScrollSnapshots.getFresh({
							rowId: snapshot.rowId,
							columnInstanceId,
							expectedFreshness: snapshot,
							policy: 'visual',
						})
					: deps.engine.htmlScrollSnapshots.get?.(snapshot.rowId, columnInstanceId, snapshot, { mode: 'visual' });
				if (portalHost.innerHTML !== existing?.html) {
					lifecycle.captureHtml({
						cellCtrl,
						host: portalHost,
						reason: 'freeze',
						token: {
							epoch: input.request.ctx.globalVersion,
							cellControllerKey: cellCtrl.key,
							rowId: cellCtrl.rowId,
							columnInstanceId: cellCtrl.columnInstanceId,
							freshness: cellCtrl.freshness ?? snapshot,
						},
						cellSlot,
						colField: snapshot.colField,
						rowHeight: deps.engine.geometry?.rowHeights?.[rowIndex],
						colWidth: ctx.plan?.colWidths?.[colIndex],
					});
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
				presentation.portalKey
			);
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}

		case 'impostor-synthetic': {
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
			return;
		}

		case 'portal-frozen': {
			deps.cellRenderer.showPortalContent(cellSlot.element);
			const portalHost = deps.getCellPortalHost(cellSlot.element);
			if (portalHost) lifecycle.freeze({ cellCtrl, host: portalHost });
			if (presentation.keepVersionFresh) {
				cellSlot.lastMountedRowVersion = rowVersion;
				cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
			} else if (presentation.markDirty) {
				deps.markCellDirtyAfterScroll(cellSlot.element);
			}
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
				'portal',
				undefined,
				'',
				presentation.portalKey
			);
			if (presentation.recordVersions && 'rowId' in presentation.recordVersions) {
				stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersions);
			}
			if (didWrite) deps.incrementCurrentScrollCellsWritten();
			deps.incrementCellsBoundDuringScroll();
			return;
		}
	}
}
