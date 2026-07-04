import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { applyPrimitiveCellPresentation } from './primitiveCellBinder.js';
import { applyLiveCellPresentation } from './liveCellBinder.js';
import { applyFreezeCellPresentation } from './freezeCellBinder.js';
import { applyTextImpostorCellPresentation } from './textImpostorCellBinder.js';
import { applyHtmlSnapshotCellPresentation } from './htmlSnapshotCellBinder.js';

/**
 * Dispatches a resolved ScrollCellPresentation to its mode-specific binder. Dispatch only — no
 * presentation logic lives here; each binder owns its own DOM writes/telemetry/mount calls.
 */
export function dispatchCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: ScrollCellPresentation,
	rowVersion: number
): void {
	switch (presentation.kind) {
		case 'buffered':
		case 'primitive':
			return applyPrimitiveCellPresentation(deps, request, presentation, rowVersion);

		case 'live-mount':
		case 'force-live-interactive-exception':
			return applyLiveCellPresentation(deps, request, presentation, rowVersion);

		case 'checkbox-selector':
		case 'freeze-live-portal':
		case 'portal-frozen':
		case 'impostor-synthetic':
			return applyFreezeCellPresentation(deps, request, presentation, rowVersion);

		case 'text-impostor':
		case 'impostor-text':
			return applyTextImpostorCellPresentation(deps, request, presentation, rowVersion);

		case 'impostor-html':
		case 'html-snapshot-pending':
			return applyHtmlSnapshotCellPresentation(deps, request, presentation, rowVersion);
	}
}
