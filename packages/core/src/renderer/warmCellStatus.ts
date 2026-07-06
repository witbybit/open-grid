import type { CellSlot } from './cellSlot.js';
import { matchesCellSlotMountedFreshness, matchesCellSlotMountedVisualVersions } from './cellSlot.js';
import { hasMountedDataVersionDrifted } from './visualFreshness.js';
import { mustClearSlotForControllerChange } from './controllerWarmDomGuards.js';
import { createCellCtrl } from './controllers/CellCtrl.js';

/**
 * Read-only inspection of a warm (already-mounted) cell's own portal state — kept separate from the
 * broader binder dependency bag so this policy is testable without constructing it.
 */
export interface WarmVisibleCellStatusDeps {
	getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null;
	isCellMounted(portalKey: string): boolean;
}

/** The scroll-frame version/decoration context this warm cell's mounted state is being judged against. */
export interface WarmVisibleCellStatusContext {
	currentRowVersion: number | undefined;
	globalVersion: number;
	globalChangedDuringScroll: boolean;
	insightVersion: number;
	styleVersion: number;
	loadingVersion: number;
	selectionVersion: number;
	hasInsightDecorations: boolean;
	hasDeferredCellStyleRules: boolean;
	loadingChangedDuringScroll: boolean;
	selectionChangedDuringScroll: boolean;
}

export interface WarmVisibleCellStatus {
	/** The warm state is untrustworthy enough (never-mounted, stale portal, data changed) that this
	 *  cell must be woken and refreshed THIS frame, not deferred. */
	needsImmediateWake: boolean;
	/** The warm state is stale in some visual dimension (insight/style/loading/selection) that can
	 *  wait for the post-scroll fidelity pass rather than blocking this frame. */
	needsDeferredRefresh: boolean;
}

/**
 * Judges whether an already-visible, already-bound cell's warm DOM state (`lastPortalKey`,
 * `lastContentMode`, `lastMounted*Version`) is still trustworthy enough to skip re-binding this
 * scroll frame, or whether it must be woken. Warm DOM may accelerate rendering by skipping redundant
 * work — it must never itself be the proof that the cell is correct; every dimension checked here is
 * an explicit identity or freshness comparison, never a bare "it looks bound" assumption.
 *
 * Two independent conditions, at two different urgencies:
 * - `needsImmediateWake`: the warm state itself is suspicious (never mounted, dangling/stale portal
 *   key, still showing the "..." placeholder) OR the underlying row/global DATA has changed — both
 *   are correctness issues that cannot wait.
 * - `needsDeferredRefresh`: everything from `needsImmediateWake` PLUS any of the four independently-
 *   weighted visual dimensions (insight/style/loading/selection) being stale — a decoration issue,
 *   not a data-correctness issue, safe to defer to the post-scroll fidelity lane.
 */
export function resolveWarmVisibleCellStatus<TRowData>(
	deps: WarmVisibleCellStatusDeps,
	cellSlot: CellSlot<TRowData>,
	ctx: WarmVisibleCellStatusContext
): WarmVisibleCellStatus {
	const cellCtrl = createCellCtrl({
		rowId: cellSlot.rowId,
		columnInstanceId: cellSlot.columnInstanceId as any,
		colField: cellSlot.colField,
		freshness: {
			rowVersion: ctx.currentRowVersion ?? -1,
			globalVersion: ctx.globalVersion,
			insightVersion: ctx.insightVersion,
			styleVersion: ctx.styleVersion,
			loadingVersion: ctx.loadingVersion,
			selectionVersion: ctx.selectionVersion,
		},
	});
	cellCtrl.lifecycle.attachedSlotInstanceId = cellSlot.cellInstanceId;
	const lastPortalKey = cellSlot.lastPortalKey;
	const portalHost = cellSlot.lastContentMode === 'portal' ? deps.getCellPortalHost(cellSlot.element) : null;
	const hasStalePortalMount = cellSlot.lastContentMode === 'portal' && !!lastPortalKey && !deps.isCellMounted(lastPortalKey);
	const hasEmptyPortalHost = cellSlot.lastContentMode === 'portal' && !!lastPortalKey && !!portalHost && portalHost.childElementCount === 0;
	const hasSuspiciousWarmState =
		mustClearSlotForControllerChange(cellSlot, cellCtrl) ||
		cellSlot.lastMountedRowVersion === -1 ||
		cellSlot.lastMountedGlobalVersion === -1 ||
		cellSlot.lastContentMode === 'pending' ||
		(cellSlot.lastContentMode === 'text' && cellSlot.lastFormattedValue === '...') ||
		hasStalePortalMount ||
		hasEmptyPortalHost;

	const mountedDataVersionDrift = hasMountedDataVersionDrifted(cellSlot, {
		rowVersion: ctx.currentRowVersion,
		globalVersion: ctx.globalVersion,
	});
	const globalDataChanged = mountedDataVersionDrift.globalChanged || (cellSlot.lastMountedGlobalVersion !== -1 && ctx.globalChangedDuringScroll);
	const rowDataChanged = mountedDataVersionDrift.rowChanged;

	const mountedFreshnessMatches = matchesCellSlotMountedFreshness(cellSlot, {
		rowVersion: ctx.currentRowVersion ?? -1,
		globalVersion: ctx.globalVersion,
		visualVersions: {
			insightVersion: ctx.insightVersion,
			styleVersion: ctx.styleVersion,
			loadingVersion: ctx.loadingVersion,
			selectionVersion: ctx.selectionVersion,
		},
	});
	const insightVisualStale =
		ctx.hasInsightDecorations && (cellSlot.lastMountedInsightVersion === -1 || cellSlot.lastMountedInsightVersion !== ctx.insightVersion);
	const styleVisualStale =
		ctx.hasDeferredCellStyleRules && (cellSlot.lastMountedStyleVersion === -1 || cellSlot.lastMountedStyleVersion !== ctx.styleVersion);
	const loadingVisualStale =
		cellSlot.lastMountedLoadingVersion === -1 ||
		!matchesCellSlotMountedVisualVersions(cellSlot, {
			insightVersion: cellSlot.lastMountedInsightVersion,
			styleVersion: cellSlot.lastMountedStyleVersion,
			loadingVersion: ctx.loadingVersion,
			selectionVersion: cellSlot.lastMountedSelectionVersion,
		});
	const selectionVisualStale =
		cellSlot.lastMountedSelectionVersion === -1 ||
		!matchesCellSlotMountedVisualVersions(cellSlot, {
			insightVersion: cellSlot.lastMountedInsightVersion,
			styleVersion: cellSlot.lastMountedStyleVersion,
			loadingVersion: cellSlot.lastMountedLoadingVersion,
			selectionVersion: ctx.selectionVersion,
		});

	return {
		needsImmediateWake: hasSuspiciousWarmState || globalDataChanged || rowDataChanged,
		needsDeferredRefresh:
			hasSuspiciousWarmState ||
			globalDataChanged ||
			rowDataChanged ||
			(!mountedFreshnessMatches &&
				cellSlot.lastMountedInsightVersion !== -1 &&
				cellSlot.lastMountedStyleVersion !== -1 &&
				cellSlot.lastMountedLoadingVersion !== -1 &&
				cellSlot.lastMountedSelectionVersion !== -1) ||
			insightVisualStale ||
			styleVisualStale ||
			(ctx.loadingChangedDuringScroll && loadingVisualStale) ||
			(ctx.selectionChangedDuringScroll && selectionVisualStale),
	};
}
