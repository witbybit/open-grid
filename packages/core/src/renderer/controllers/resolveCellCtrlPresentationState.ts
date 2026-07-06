import { createCellControllerKey, type CellCtrl } from './CellCtrl.js';
import type { RowCtrl } from './RowCtrl.js';
import type { ViewportPlan } from '../viewportPlanner.js';
import type { CellDisplaySnapshot } from '../cellDisplaySnapshot.js';
import type { VisualFreshness } from '../visualFreshness.js';
import {
	resolveScrollCellPresentation,
	type ScrollCellPresentation,
	type ScrollCellPresentationDeps,
	type ScrollCellPresentationInput,
} from '../scrollCellPresentation.js';

export type CellCtrlBindPhase = 'scroll' | 'full-bind' | 'prewarm' | 'fidelity';

export interface CellCtrlResolveContext<TRowData = unknown> {
	scroll?: {
		deps: ScrollCellPresentationDeps;
		input: ScrollCellPresentationInput<TRowData>;
	};
	fullBind?: {
		className: string;
		title: string | null;
		validationError?: string;
		contentMode: 'portal' | 'text' | 'empty' | 'loading' | 'fallback';
		formattedValue: string;
		portalKey?: string;
		freshness: VisualFreshness;
		value: unknown;
	};
}

function snapshotFreshness(snapshot: CellDisplaySnapshot): VisualFreshness {
	return {
		rowVersion: snapshot.rowVersion,
		globalVersion: snapshot.globalVersion,
		insightVersion: snapshot.insightVersion,
		styleVersion: snapshot.styleVersion,
		loadingVersion: snapshot.loadingVersion,
		selectionVersion: snapshot.selectionVersion,
	};
}

function resolvePresentationFreshness(presentation: ScrollCellPresentation, fallback: VisualFreshness): VisualFreshness {
	switch (presentation.kind) {
		case 'buffered':
		case 'primitive':
		case 'live-mount':
		case 'force-live-interactive-exception':
		case 'portal-frozen':
			return presentation.recordVersionsFrom ? snapshotFreshness(presentation.recordVersionsFrom) : fallback;
		case 'freeze-live-portal':
			return presentation.snapshotForCapture ? snapshotFreshness(presentation.snapshotForCapture) : fallback;
		case 'impostor-text':
		case 'impostor-html':
			return 'rowVersion' in presentation.recordVersionsFrom
				? presentation.recordVersionsFrom
				: snapshotFreshness(presentation.recordVersionsFrom);
		case 'text-impostor':
		case 'html-snapshot-pending':
		case 'impostor-synthetic':
			return presentation.recordVersions;
		case 'checkbox-selector':
			return fallback;
	}
}

function getPresentationTitle(presentation: ScrollCellPresentation): string | null {
	return 'title' in presentation ? (presentation.title ?? null) : null;
}

function getPresentationValidationError(presentation: ScrollCellPresentation): string | undefined {
	return 'validationError' in presentation ? presentation.validationError : undefined;
}

function hydrateCellCtrlFromScrollPresentation(
	cellCtrl: CellCtrl,
	presentation: ScrollCellPresentation,
	fallbackFreshness: VisualFreshness
): CellCtrl {
	const freshness = resolvePresentationFreshness(presentation, fallbackFreshness);
	cellCtrl.freshness = freshness;
	cellCtrl.presentationState = {
		kind: presentation.kind,
		className: presentation.className,
		title: getPresentationTitle(presentation),
		validationError: getPresentationValidationError(presentation),
		releaseStalePortal:
			'releaseStalePortal' in presentation
				? presentation.releaseStalePortal
				: 'releasePriorPortal' in presentation
					? presentation.releasePriorPortal
					: false,
		requiresFidelity:
			presentation.kind === 'primitive' ||
			presentation.kind === 'freeze-live-portal' ||
			presentation.kind === 'impostor-synthetic' ||
			presentation.kind === 'text-impostor' ||
			presentation.kind === 'impostor-text' ||
			presentation.kind === 'html-snapshot-pending' ||
			presentation.kind === 'impostor-html',
		freshness,
		contentMode: 'contentMode' in presentation ? presentation.contentMode : undefined,
		formattedValue: 'formattedValue' in presentation ? presentation.formattedValue : undefined,
		portalKey: 'portalCellKey' in presentation ? presentation.portalCellKey : 'portalKey' in presentation ? presentation.portalKey : undefined,
		html: 'frozenHtml' in presentation ? presentation.frozenHtml : undefined,
		markDirty:
			'markDirty' in presentation ? presentation.markDirty : 'shouldMarkDirty' in presentation ? presentation.shouldMarkDirty : undefined,
		isEditing: 'isEditing' in presentation ? presentation.isEditing : cellCtrl.visualState.editing,
		isFocused: 'isFocused' in presentation ? presentation.isFocused : cellCtrl.visualState.focused,
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
	cellCtrl.visualState.className = presentation.className;
	cellCtrl.visualState.title = getPresentationTitle(presentation);
	cellCtrl.visualState.validationError = getPresentationValidationError(presentation);
	cellCtrl.visualState.focused = 'isFocused' in presentation ? presentation.isFocused : cellCtrl.visualState.focused;
	cellCtrl.visualState.editing = 'isEditing' in presentation ? presentation.isEditing : cellCtrl.visualState.editing;
	cellCtrl.valueState.formattedValue = 'formattedValue' in presentation ? presentation.formattedValue : '';
	cellCtrl.valueState.displayText = cellCtrl.valueState.formattedValue;
	cellCtrl.valueState.loading = presentation.kind === 'html-snapshot-pending';
	cellCtrl.valueState.empty = !cellCtrl.valueState.formattedValue;
	cellCtrl.rendererState.portalKey =
		'portalCellKey' in presentation ? presentation.portalCellKey : 'portalKey' in presentation ? presentation.portalKey : undefined;
	cellCtrl.rendererState.htmlSnapshotKey =
		presentation.kind === 'impostor-html' || presentation.kind === 'html-snapshot-pending'
			? createCellControllerKey(cellCtrl.rowId, cellCtrl.columnInstanceId)
			: undefined;
	cellCtrl.rendererState.mode =
		presentation.kind === 'live-mount' || presentation.kind === 'force-live-interactive-exception'
			? 'live'
			: presentation.kind === 'freeze-live-portal' || presentation.kind === 'portal-frozen'
				? 'frozen'
				: presentation.kind === 'text-impostor' || presentation.kind === 'impostor-text' || presentation.kind === 'impostor-synthetic'
					? 'text-impostor'
					: presentation.kind === 'impostor-html'
						? 'html-snapshot'
						: presentation.kind === 'html-snapshot-pending'
							? 'html-pending'
							: presentation.kind === 'checkbox-selector'
								? 'none'
								: 'primitive';
	return cellCtrl;
}

function hydrateCellCtrlFromFullBind(cellCtrl: CellCtrl, context: NonNullable<CellCtrlResolveContext['fullBind']>): CellCtrl {
	cellCtrl.freshness = context.freshness;
	cellCtrl.visualState.className = context.className;
	cellCtrl.visualState.title = context.title;
	cellCtrl.visualState.validationError = context.validationError;
	cellCtrl.valueState.value = context.value;
	cellCtrl.valueState.formattedValue = context.formattedValue;
	cellCtrl.valueState.displayText = context.formattedValue;
	cellCtrl.valueState.loading = context.contentMode === 'loading';
	cellCtrl.valueState.empty = !context.formattedValue;
	cellCtrl.rendererState.portalKey = context.portalKey;
	cellCtrl.rendererState.mode =
		context.contentMode === 'portal'
			? 'live'
			: context.contentMode === 'loading'
				? 'loading'
				: context.contentMode === 'fallback'
					? 'text-impostor'
					: 'primitive';
	cellCtrl.presentationState = {
		kind: context.contentMode === 'portal' ? 'full-bind-portal' : context.contentMode === 'loading' ? 'full-bind-loading' : 'full-bind-primitive',
		className: context.className,
		title: context.title,
		validationError: context.validationError,
		releaseStalePortal: false,
		requiresFidelity: false,
		freshness: context.freshness,
		contentMode: context.contentMode,
		formattedValue: context.formattedValue,
		portalKey: context.portalKey,
	};
	return cellCtrl;
}

export function resolveCellCtrlPresentationState<TRowData>(input: {
	cellCtrl: CellCtrl;
	rowCtrl: RowCtrl;
	viewportPlan: ViewportPlan | null;
	phase: CellCtrlBindPhase;
	context: CellCtrlResolveContext<TRowData>;
}): CellCtrl {
	const { cellCtrl, context } = input;
	if (context.scroll) {
		const presentation = resolveScrollCellPresentation(context.scroll.deps, context.scroll.input);
		const fallbackFreshness: VisualFreshness = {
			rowVersion: context.scroll.input.rowVersion,
			globalVersion: context.scroll.input.ctx.globalVersion,
			insightVersion: context.scroll.input.ctx.insightVersion,
			styleVersion: context.scroll.input.ctx.styleVersion,
			loadingVersion: context.scroll.input.ctx.loadingVersion,
			selectionVersion: context.scroll.input.ctx.selectionVersion,
		};
		return hydrateCellCtrlFromScrollPresentation(cellCtrl, presentation, fallbackFreshness);
	}
	if (context.fullBind) {
		return hydrateCellCtrlFromFullBind(cellCtrl, context.fullBind);
	}
	return cellCtrl;
}
