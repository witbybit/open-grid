import type { CellCtrl } from '../controllers/CellCtrl.js';
import type { RowCtrl } from '../controllers/RowCtrl.js';
import type { BindCellDuringScrollRequest, RowCellBinderDeps } from '../rowCellBinder.js';
import { applyPrimitiveCellPresentation } from './primitiveCellBinder.js';
import { applyLiveCellPresentation } from './liveCellBinder.js';
import { applyFreezeCellPresentation } from './freezeCellBinder.js';
import { applyTextImpostorCellPresentation } from './textImpostorCellBinder.js';
import { applyHtmlSnapshotCellPresentation } from './htmlSnapshotCellBinder.js';

export interface DispatchCellPresentationInput<TRowData> {
	deps: RowCellBinderDeps<TRowData>;
	request: BindCellDuringScrollRequest<TRowData>;
	cellCtrl: CellCtrl;
	rowCtrl: RowCtrl<TRowData>;
	phase: 'scroll' | 'full-bind' | 'prewarm' | 'fidelity';
	rowVersion: number;
}

/**
 * Dispatch only. Presentation authority lives on CellCtrl; binders receive the controller and apply
 * its already-resolved state onto the physical CellSlot.
 */
export function dispatchCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	switch (input.cellCtrl.presentationState.kind) {
		case 'buffered':
		case 'primitive':
			return applyPrimitiveCellPresentation(input);

		case 'live-mount':
		case 'force-live-interactive-exception':
			return applyLiveCellPresentation(input);

		case 'checkbox-selector':
		case 'freeze-live-portal':
		case 'portal-frozen':
		case 'impostor-synthetic':
			return applyFreezeCellPresentation(input);

		case 'text-impostor':
		case 'impostor-text':
			return applyTextImpostorCellPresentation(input);

		case 'impostor-html':
		case 'html-snapshot-pending':
			return applyHtmlSnapshotCellPresentation(input);
	}
}
