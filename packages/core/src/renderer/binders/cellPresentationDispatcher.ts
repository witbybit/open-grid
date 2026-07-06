import { getColumnInstanceIdentity } from '../../columnDef.js';
import type { CellCtrl } from '../controllers/CellCtrl.js';
import { createCellCtrl } from '../controllers/CellCtrl.js';
import type { RowCtrl } from '../controllers/RowCtrl.js';
import type { BindCellDuringScrollRequest, RowCellBinderDeps } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
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

function toCompatInput<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: ScrollCellPresentation,
	rowVersion: number
): DispatchCellPresentationInput<TRowData> {
	const cellCtrl = createCellCtrl({
		rowId: request.node.id,
		rowIndex: request.rowIndex,
		rowCtrlKey: request.node.id,
		columnInstanceId: getColumnInstanceIdentity(request.col),
		colId: request.col.colId ?? request.col.field,
		colField: request.col.field,
		colIndex: request.colIndex,
	});
	cellCtrl.presentationState = {
		kind: presentation.kind,
		className: presentation.className,
		title: 'title' in presentation ? (presentation.title ?? null) : null,
		validationError: 'validationError' in presentation ? presentation.validationError : undefined,
		releaseStalePortal:
			'releaseStalePortal' in presentation
				? presentation.releaseStalePortal
				: 'releasePriorPortal' in presentation
					? presentation.releasePriorPortal
					: false,
		requiresFidelity: false,
		freshness: {
			rowVersion,
			globalVersion: request.ctx.globalVersion,
			insightVersion: request.ctx.insightVersion,
			styleVersion: request.ctx.styleVersion,
			loadingVersion: request.ctx.loadingVersion,
			selectionVersion: request.ctx.selectionVersion,
		},
		contentMode: 'contentMode' in presentation ? presentation.contentMode : undefined,
		formattedValue: 'formattedValue' in presentation ? presentation.formattedValue : undefined,
		portalKey: 'portalCellKey' in presentation ? presentation.portalCellKey : 'portalKey' in presentation ? presentation.portalKey : undefined,
		html: 'frozenHtml' in presentation ? presentation.frozenHtml : undefined,
		markDirty:
			'markDirty' in presentation ? presentation.markDirty : 'shouldMarkDirty' in presentation ? presentation.shouldMarkDirty : undefined,
		isEditing: 'isEditing' in presentation ? presentation.isEditing : false,
		isFocused: 'isFocused' in presentation ? presentation.isFocused : false,
		keepVersionFresh: 'keepVersionFresh' in presentation ? presentation.keepVersionFresh : undefined,
		captureFrozenHtml: 'captureFrozenHtml' in presentation ? presentation.captureFrozenHtml : undefined,
		recordVersions:
			'recordVersionsFrom' in presentation
				? presentation.recordVersionsFrom
				: 'snapshotForCapture' in presentation
					? presentation.snapshotForCapture
					: 'recordVersions' in presentation
						? presentation.recordVersions
						: undefined,
	};
	cellCtrl.freshness = cellCtrl.presentationState.freshness;
	cellCtrl.visualState.className = cellCtrl.presentationState.className;
	cellCtrl.visualState.title = cellCtrl.presentationState.title;
	cellCtrl.visualState.validationError = cellCtrl.presentationState.validationError;
	cellCtrl.visualState.editing = cellCtrl.presentationState.isEditing ?? false;
	cellCtrl.visualState.focused = cellCtrl.presentationState.isFocused ?? false;
	cellCtrl.rendererState.portalKey = cellCtrl.presentationState.portalKey;
	return {
		deps,
		request,
		cellCtrl,
		rowCtrl: {
			rowId: request.node.id,
			rowVersion,
			attachedSlotId: undefined,
			attachedGeneration: -1,
			cellKeysByColumnInstanceId: new Map(),
			isEditing: false,
			isFocused: false,
		},
		phase: 'scroll',
		rowVersion,
	};
}

/**
 * Dispatch only. Presentation authority lives on CellCtrl; binders receive the controller and apply
 * its already-resolved state onto the physical CellSlot.
 */
export function dispatchCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void;
export function dispatchCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: ScrollCellPresentation,
	rowVersion: number
): void;
export function dispatchCellPresentation<TRowData>(
	inputOrDeps: DispatchCellPresentationInput<TRowData> | RowCellBinderDeps<TRowData>,
	request?: BindCellDuringScrollRequest<TRowData>,
	presentation?: ScrollCellPresentation,
	rowVersion?: number
): void {
	const input =
		request && presentation && typeof rowVersion === 'number'
			? toCompatInput(inputOrDeps as RowCellBinderDeps<TRowData>, request, presentation, rowVersion)
			: (inputOrDeps as DispatchCellPresentationInput<TRowData>);
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
