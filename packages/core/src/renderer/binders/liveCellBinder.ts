import { getColumnInstanceIdentity, type InternalColumnDef } from '../../columnDef.js';
import { createCellCtrl } from '../controllers/CellCtrl.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { applyCellTitlesAndValidation, getScrollMountValue, stampMountedVersions } from './binderShared.js';
import { createCellRendererLifecycle } from '../lifecycle/cellRendererLifecycle.js';
import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';

/** Renders the over-budget emergency shell for a fresh live mount that couldn't be granted this
 * frame's mount budget. */
function applyLiveMountEmergencyShell<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, request, cellCtrl, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const { cellSlot, node, rowIndex, colIndex, col, ctx, left, right, width } = request;
	deps.incrementLiveReactEmergencyShellsDuringScroll?.();
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
		'pending',
		undefined,
		'',
		undefined
	);
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
	if (didWrite) deps.incrementCurrentScrollCellsWritten();
	deps.incrementCellsBoundDuringScroll();
}

function toCompatInput<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	presentation: Extract<ScrollCellPresentation, { kind: 'live-mount' | 'force-live-interactive-exception' }>,
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
	cellCtrl.freshness = {
		rowVersion,
		globalVersion: request.ctx.globalVersion,
		insightVersion: request.ctx.insightVersion,
		styleVersion: request.ctx.styleVersion,
		loadingVersion: request.ctx.loadingVersion,
		selectionVersion: request.ctx.selectionVersion,
	};
	cellCtrl.visualState.editing = presentation.isEditing;
	cellCtrl.visualState.focused = presentation.isFocused;
	cellCtrl.presentationState = {
		kind: presentation.kind,
		className: presentation.className,
		title: presentation.title ?? null,
		validationError: presentation.validationError,
		releaseStalePortal: presentation.releasePriorPortal,
		requiresFidelity: false,
		freshness: cellCtrl.freshness,
		portalKey: presentation.portalCellKey,
		isEditing: presentation.isEditing,
		isFocused: presentation.isFocused,
		recordVersions: presentation.recordVersionsFrom,
	};
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

export function applyLiveCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void;
export function applyLiveCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	compatRequest: BindCellDuringScrollRequest<TRowData>,
	compatPresentation: Extract<ScrollCellPresentation, { kind: 'live-mount' | 'force-live-interactive-exception' }>,
	compatRowVersion: number
): void;
export function applyLiveCellPresentation<TRowData>(
	inputOrDeps: DispatchCellPresentationInput<TRowData> | RowCellBinderDeps<TRowData>,
	compatRequest?: BindCellDuringScrollRequest<TRowData>,
	compatPresentation?: Extract<ScrollCellPresentation, { kind: 'live-mount' | 'force-live-interactive-exception' }>,
	compatRowVersion?: number
): void {
	const input =
		compatRequest && compatPresentation && typeof compatRowVersion === 'number'
			? toCompatInput(inputOrDeps as RowCellBinderDeps<TRowData>, compatRequest, compatPresentation, compatRowVersion)
			: (inputOrDeps as DispatchCellPresentationInput<TRowData>);
	const { deps, request, cellCtrl, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const { cellSlot, node, rowIndex, colIndex, col, ctx, pooledRowId, left, right, width, isRowLoading } = request;
	const lifecycle = createCellRendererLifecycle(deps);

	if (presentation.kind === 'force-live-interactive-exception') {
		deps.incrementForceLiveMountsDuringScroll?.();
		if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'scrolled-out', cellElement: cellSlot.element });
		deps.markCellDirtyAfterScroll(cellSlot.element);
		const ensuredPortalHost = deps.ensureCellPortalHost(cellSlot.element);
		lifecycle.mountLive({
			cellCtrl,
			host: ensuredPortalHost,
			reason: 'scroll-force-live',
			token: {
				epoch: ctx.globalVersion,
				cellControllerKey: cellCtrl.key,
				rowId: cellCtrl.rowId,
				columnInstanceId: cellCtrl.columnInstanceId,
				freshness: cellCtrl.freshness!,
			},
			mount: {
				cellKey: presentation.portalKey!,
				value: getScrollMountValue(deps, node, col, cellSlot),
				node,
				col,
				rowIndex,
				colIndex,
				rowSlotId: pooledRowId,
				slotGeneration: request.pooledRowGeneration,
				cellRowBindingGeneration: cellSlot.rowBindingGeneration,
				cellInstanceId: cellSlot.cellInstanceId,
				portalHostId: cellSlot.portalHostId,
				isEditing: cellCtrl.visualState.editing,
				isLoading: isRowLoading,
				isFocused: cellCtrl.visualState.focused,
				isSelected: false,
			},
		});
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
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
		if (presentation.recordVersions && 'rowId' in presentation.recordVersions)
			stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersions);
		if (didWrite) deps.incrementCurrentScrollCellsWritten();
		deps.incrementCellsBoundDuringScroll();
		return;
	}

	const isFreshMount = !deps.portalMountManager.isCellMounted(presentation.portalKey!);
	deps.onLiveCellResolved?.(node.id, (col as InternalColumnDef<TRowData>).instanceId, rowIndex, isFreshMount);
	const withinBudget = deps.tryConsumeLiveBudget?.(isFreshMount ? 'mount' : 'update') ?? true;
	if (!withinBudget) {
		if (!isFreshMount) return;
		if (deps.allowLiveEmergencyShell?.() ?? true) {
			applyLiveMountEmergencyShell(input);
			return;
		}
	}
	if (isFreshMount) deps.incrementLiveReactMountsDuringScroll?.();
	else deps.incrementLiveReactUpdatesDuringScroll?.();
	if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'scrolled-out', cellElement: cellSlot.element });
	deps.markCellDirtyAfterScroll(cellSlot.element);
	const ensuredPortalHost = deps.ensureCellPortalHost(cellSlot.element);
	const token = {
		epoch: ctx.globalVersion,
		cellControllerKey: cellCtrl.key,
		rowId: cellCtrl.rowId,
		columnInstanceId: cellCtrl.columnInstanceId,
		freshness: cellCtrl.freshness!,
	};
	const mount = {
		cellKey: presentation.portalKey!,
		value: getScrollMountValue(deps, node, col, cellSlot),
		node,
		col,
		rowIndex,
		colIndex,
		rowSlotId: pooledRowId,
		slotGeneration: request.pooledRowGeneration,
		cellRowBindingGeneration: cellSlot.rowBindingGeneration,
		cellInstanceId: cellSlot.cellInstanceId,
		portalHostId: cellSlot.portalHostId,
		isEditing: cellCtrl.visualState.editing,
		isLoading: isRowLoading,
		isFocused: cellCtrl.visualState.focused,
		isSelected: false,
	};
	if (isFreshMount) lifecycle.mountLive({ cellCtrl, host: ensuredPortalHost, reason: 'scroll-live', token, mount });
	else lifecycle.updateLive({ cellCtrl, host: ensuredPortalHost, reason: 'scroll-live', token, mount });
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = ctx.globalVersion;
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
	if (presentation.recordVersions && 'rowId' in presentation.recordVersions)
		stampMountedVersions(cellSlot, rowVersion, ctx.globalVersion, presentation.recordVersions);
	if (didWrite) deps.incrementCurrentScrollCellsWritten();
	deps.incrementCellsBoundDuringScroll();
}
