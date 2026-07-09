import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import { createCellRendererLifecycle } from '../lifecycle/cellRendererLifecycle.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { applyCellTitlesAndValidation, recordDispatchWrite, stampMountedVersions } from './binderShared.js';

/**
 * scrollPresentation: 'freeze' - an existing live portal may remain visually frozen during scroll;
 * cold cells show a cheap synthetic impostor and wait for the fidelity lane.
 */
export function applyFreezeCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const lifecycle = createCellRendererLifecycle(deps);

	switch (presentation.kind) {
		case 'checkbox-selector': {
			if (input.phase === 'scroll' && presentation.markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);
			if (presentation.releaseStalePortal) deps.releaseCellPortal(cellSlot.element, false, 'invalidated');
			if (input.phase === 'full-bind' && runtime.checkbox) {
				let checkbox = cellSlot.contentElement.querySelector<HTMLInputElement>('input[type="checkbox"].og-row-checkbox');
				if (!checkbox) {
					checkbox = document.createElement('input');
					checkbox.type = 'checkbox';
					checkbox.className = 'og-row-checkbox';
					cellSlot.contentElement.textContent = '';
					cellSlot.contentElement.appendChild(checkbox);
				}
				checkbox.dataset.rowId = cellCtrl.rowId;
				checkbox.setAttribute('aria-label', runtime.checkbox.ariaLabel);
				checkbox.title = runtime.checkbox.title;
				if (checkbox.checked !== runtime.checkbox.checked) checkbox.checked = runtime.checkbox.checked;
			}
			const didWrite = cellSlot.update(
				geometry.colIndex,
				cellCtrl.field,
				geometry.rowIndex,
				cellCtrl.rowId,
				geometry.left,
				geometry.right,
				geometry.width,
				presentation.className,
				'custom',
				undefined,
				'',
				undefined,
				geometry.dragShift
			);
			cellSlot.lastMountedRowVersion = rowVersion;
			cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
			recordCellSlotMountedVisualVersions(cellSlot, {
				insightVersion: cellCtrl.freshness?.insightVersion ?? -1,
				styleVersion: cellCtrl.freshness?.styleVersion ?? -1,
				loadingVersion: cellCtrl.freshness?.loadingVersion ?? -1,
				selectionVersion: cellCtrl.freshness?.selectionVersion ?? -1,
			});
			recordDispatchWrite(input, didWrite);
			return;
		}

		case 'frozen-portal': {
			deps.cellRenderer.showPortalContent(cellSlot.element);
			const portalHost = deps.getCellPortalHost(cellSlot.element);
			if (portalHost) lifecycle.freeze({ cellCtrl, host: portalHost });
			applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
			if (input.phase === 'scroll' && presentation.markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);

			if (presentation.captureFrozenHtml && presentation.recordVersions && 'rowId' in presentation.recordVersions && portalHost?.innerHTML) {
				const snapshot = presentation.recordVersions;
				const existing = deps.engine.htmlScrollSnapshots.getFresh
					? deps.engine.htmlScrollSnapshots.getFresh({
							rowId: snapshot.rowId,
							columnInstanceId: cellCtrl.columnInstanceId,
							expectedFreshness: snapshot,
							policy: 'visual',
						})
					: deps.engine.htmlScrollSnapshots.get?.(snapshot.rowId, cellCtrl.columnInstanceId, snapshot, { mode: 'visual' });
				if (portalHost.innerHTML !== existing?.html) {
					lifecycle.captureHtml({
						cellCtrl,
						host: portalHost,
						reason: 'freeze',
						token: {
							epoch: runtime.globalVersion,
							cellControllerKey: cellCtrl.key,
							rowId: cellCtrl.rowId,
							columnInstanceId: cellCtrl.columnInstanceId,
							freshness: cellCtrl.freshness ?? snapshot,
						},
						cellSlot,
						colField: cellCtrl.field,
						rowHeight: runtime.rowHeight,
						colWidth: runtime.colWidth,
					});
				}
			}

			const didWrite = cellSlot.update(
				geometry.colIndex,
				cellCtrl.field,
				geometry.rowIndex,
				cellCtrl.rowId,
				geometry.left,
				geometry.right,
				geometry.width,
				presentation.className,
				'portal',
				undefined,
				'',
				presentation.portalKey,
				geometry.dragShift
			);
			if (presentation.keepVersionFresh) {
				cellSlot.lastMountedRowVersion = rowVersion;
				cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
			}
			if (presentation.recordVersions && 'rowId' in presentation.recordVersions) {
				stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
			}
			recordDispatchWrite(input, didWrite);
			return;
		}

		case 'shell': {
			if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'invalidated', cellElement: cellSlot.element });
			if (input.phase === 'scroll') deps.markCellDirtyAfterScroll(cellSlot.element);
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
				presentation.contentMode ?? 'fallback',
				undefined,
				presentation.formattedValue ?? '',
				undefined,
				geometry.dragShift
			);
			cellSlot.lastMountedRowVersion = rowVersion;
			cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
			if (presentation.recordVersions && !('rowId' in presentation.recordVersions)) {
				recordCellSlotMountedVisualVersions(cellSlot, presentation.recordVersions);
			}
			recordDispatchWrite(input, didWrite);
			return;
		}
	}
}
