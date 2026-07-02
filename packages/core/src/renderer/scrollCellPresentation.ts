import type { InternalColumnDef, ColumnDef } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import { createEditRendererKey } from './identityKeys.js';
import type { CellSlot, CellContentMode } from './cellSlot.js';
import type { CellDisplaySnapshot } from './cellDisplaySnapshot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { VisualFreshness } from './visualFreshness.js';
import type { RowCellBinderDeps } from './rowCellBinder.js';

export function isPrimitiveSnapshotContent(snapshot: CellDisplaySnapshot | undefined): snapshot is CellDisplaySnapshot {
	return !!snapshot && (snapshot.contentMode === 'text' || snapshot.contentMode === 'empty' || snapshot.contentMode === 'fallback');
}

export function isPortalSnapshotContent(snapshot: CellDisplaySnapshot | undefined): snapshot is CellDisplaySnapshot {
	return !!snapshot && snapshot.contentMode === 'portal';
}

export function hasAuthoritativePortalHostContent<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	cellSlot: CellSlot<TRowData>,
	portalKey: string | undefined
): boolean {
	if (!portalKey || cellSlot.lastContentMode !== 'portal') return false;
	const portalHost = deps.getCellPortalHost(cellSlot.element);
	if (!portalHost || portalHost.childElementCount === 0) return false;
	return true;
}

/**
 * The full set of outcomes bindCellDuringScroll can resolve a cell to. Each variant carries
 * exactly the data its corresponding apply step in bindCellDuringScroll needs — the DOM writes,
 * portal mount/release calls, snapshot-store writes, and telemetry increments all stay in the
 * binder. This type must never grow a variant that requires calling getCellValue, a valueGetter,
 * the formula engine, a style-rule evaluator, the integrity/insights engine, or mounting a React
 * portal — those are exactly the semantic reads/mounts the scroll hot path must never perform.
 */
export type ScrollCellPresentation =
	| { kind: 'checkbox-selector'; className: string; markDirty: boolean }
	| {
			kind: 'buffered';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			portalKey: string | undefined;
			releaseStalePortal: boolean;
			title: string | null;
			validationError: string | undefined;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
	  }
	| {
			kind: 'primitive';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			markDirty: boolean;
			releaseStalePortal: boolean;
			title: string | null;
			validationError: string | undefined;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
	  }
	| {
			kind: 'freeze-live-portal';
			className: string;
			portalCellKey: string;
			title: string | null;
			validationError: string | undefined;
			shouldMarkDirty: boolean;
			captureFrozenHtml: boolean;
			snapshotForCapture: CellDisplaySnapshot | undefined;
	  }
	| {
			kind: 'impostor-html';
			className: string;
			frozenHtml: string;
			releaseStalePortal: boolean;
			recordVersionsFrom: CellDisplaySnapshot;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			kind: 'impostor-text';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			releaseStalePortal: boolean;
			recordVersionsFrom: CellDisplaySnapshot;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			kind: 'impostor-synthetic';
			className: string;
			contentMode: CellContentMode;
			formattedValue: string;
			releaseStalePortal: boolean;
			recordVersions: VisualFreshness;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			kind: 'portal-frozen';
			className: string;
			portalCellKey: string;
			markDirty: boolean;
			keepVersionFresh: boolean;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
			title: string | null;
			validationError: string | undefined;
	  }
	| {
			kind: 'portal-mount';
			className: string;
			portalCellKey: string;
			releasePriorPortal: boolean;
			isEditing: boolean;
			isFocused: boolean;
			recordVersionsFrom: CellDisplaySnapshot | undefined;
			title: string | null;
			validationError: string | undefined;
	  };

export interface ScrollCellPresentationInput<TRowData> {
	cellSlot: CellSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	ctx: ScrollRenderContext<TRowData>;
	isRowRebind: boolean;
	isRowLoading: boolean;
	isInVisibleContent: boolean;
	snapshot: CellDisplaySnapshot | undefined;
	isWarmBindingVersionFresh: boolean;
	rowVersion: number;
	cellKey: string;
}

function buildCellPinClass(lane: 'left' | 'center' | 'right'): string {
	if (lane === 'left') return 'og-cell og-cell-pinned-left';
	if (lane === 'right') return 'og-cell og-cell-pinned-right';
	return 'og-cell';
}

/**
 * Pure decision function for the scroll hot path. Given the current mounted slot state, a fresh
 * (possibly absent) display snapshot, and renderer capability metadata, decides what the cell
 * should show — never performs a DOM write, portal mount/release, or a semantic read (no
 * getCellValue/valueGetter/formula/style-rule/integrity call). `deps` is only used for read-only
 * inspection: checking whether a portal host already has live content, and reading the column's
 * cheap-display-value cache for the synthetic-impostor fallback (both already exempt from the
 * no-semantic-read counters — see runtimePerformance.test.ts).
 */
export function resolveScrollCellPresentation<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	input: ScrollCellPresentationInput<TRowData>
): ScrollCellPresentation {
	const { cellSlot, node, rowIndex, colIndex, col, lane, ctx, isRowRebind, isRowLoading, isInVisibleContent, snapshot, isWarmBindingVersionFresh, cellKey } =
		input;

	if (col.checkboxSelection) {
		return { kind: 'checkbox-selector', className: buildCellPinClass(lane) + ' og-cell-row-selector', markDirty: isInVisibleContent };
	}

	const compiledPlan = ctx.plan.columnPlans[colIndex];
	const isEditing = !!(ctx.activeEdit && ctx.activeEdit.rowId === node.id && ctx.activeEdit.colField === col.field);
	const rendererKind: 'primitive' | 'portal' | 'loading' = isRowLoading ? 'loading' : isEditing || compiledPlan?.isCustom ? 'portal' : 'primitive';

	let cellClassName = buildCellPinClass(lane);
	if (rendererKind === 'loading') cellClassName += ' og-cell-loading';
	if (snapshot?.className) {
		cellClassName = snapshot.className;
	} else if (isWarmBindingVersionFresh && cellSlot.lastClassName) {
		cellClassName = cellSlot.lastClassName;
	}

	if (!isInVisibleContent) {
		const primitiveSnapshot = isPrimitiveSnapshotContent(snapshot) ? snapshot : undefined;
		const canReuseSnapshotContent = !!primitiveSnapshot;
		const canReuseSnapshotPortal = snapshot?.contentMode === 'portal' && hasAuthoritativePortalHostContent(deps, cellSlot, cellSlot.lastPortalKey);
		const preservedContentMode: CellContentMode = canReuseSnapshotPortal
			? 'portal'
			: canReuseSnapshotContent
				? primitiveSnapshot.contentMode
				: rendererKind === 'loading'
					? 'loading'
					: 'empty';
		return {
			kind: 'buffered',
			className: cellClassName,
			contentMode: preservedContentMode,
			formattedValue:
				canReuseSnapshotContent && (preservedContentMode === 'text' || preservedContentMode === 'fallback') ? primitiveSnapshot.formattedValue : '',
			portalKey: preservedContentMode === 'portal' && canReuseSnapshotPortal ? cellSlot.lastPortalKey : undefined,
			releaseStalePortal: !canReuseSnapshotPortal && !!cellSlot.lastPortalKey,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			recordVersionsFrom: snapshot,
		};
	}

	if (rendererKind !== 'portal' && rendererKind !== 'loading') {
		let contentMode: CellContentMode;
		let formattedValue: string;
		let markDirty = false;
		if (isPrimitiveSnapshotContent(snapshot)) {
			formattedValue = snapshot.formattedValue;
			contentMode = snapshot.contentMode;
		} else if (isWarmBindingVersionFresh && (cellSlot.lastContentMode === 'text' || cellSlot.lastContentMode === 'fallback')) {
			formattedValue = cellSlot.lastFormattedValue ?? '';
			contentMode = cellSlot.lastContentMode;
			markDirty = true;
		} else {
			formattedValue = '...';
			contentMode = 'text';
			markDirty = true;
		}
		return {
			kind: 'primitive',
			className: cellClassName,
			contentMode,
			formattedValue,
			markDirty,
			releaseStalePortal: !!cellSlot.lastPortalKey,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			recordVersionsFrom: snapshot,
		};
	}

	// rendererKind is 'portal' or 'loading' from here on — both go through the portal decision
	// tree. A loading row with a custom-renderer column lets that renderer show its own loading
	// state via portal mount (isLoading is threaded into the mount request below).
	const portalCellKey = isEditing ? createEditRendererKey(node.id, col.field) : cellKey;
	const scrollMode = compiledPlan?.mode;
	const isFocused = ctx.focusedCell?.rowId === node.id && ctx.focusedCell?.colField === col.field;
	const hasScrollImpostorCapability = scrollMode === 'custom-live' || scrollMode === 'custom-imperative' || scrollMode === 'custom';

	// Compute live-content guard BEFORE any impostor path. If the cell is already showing rendered
	// portal content for this exact row+key, freeze it in place during scroll rather than replacing
	// it with a text impostor. This prevents the portal→text→portal flash that occurs on cells
	// that were already visible and rendered when the scroll began.
	// A row rebind (different row reusing this slot) is excluded — existing content belongs to the
	// old row identity and must never bleed into the incoming row.
	const hasExistingLivePortalContent =
		!isRowRebind && cellSlot.lastPortalKey === portalCellKey && hasAuthoritativePortalHostContent(deps, cellSlot, portalCellKey);

	// A prewarm snapshot that explicitly says 'fallback' (impostor) takes authority over the freeze
	// path, except for scrollSnapshot:'html' columns, where the freeze moment is the only reliable
	// place to capture committed React DOM as frozenHtml.
	const snapshotDemandsImpostor = snapshot?.contentMode === 'fallback';
	const hasScrollSnapshotHtml = (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.scrollSnapshot === 'html';

	if (hasScrollImpostorCapability && hasExistingLivePortalContent && !isEditing && !isFocused && (!snapshotDemandsImpostor || hasScrollSnapshotHtml)) {
		const globalChanged = cellSlot.lastMountedGlobalVersion !== -1 && ctx.globalVersion !== cellSlot.lastMountedGlobalVersion;
		const rowChanged =
			cellSlot.lastMountedRowVersion !== -1 && input.rowVersion !== undefined && input.rowVersion !== cellSlot.lastMountedRowVersion;
		const hasSnapshotCoverageForDecorations = !ctx.hasInsightDecorations || !!snapshot;
		const shouldDirtyFrozen =
			globalChanged ||
			rowChanged ||
			!hasSnapshotCoverageForDecorations ||
			(ctx.hasDeferredCellStyleRules &&
				(!snapshot || ctx.styleChangedDuringScroll || ctx.selectionChangedDuringScroll || ctx.loadingChangedDuringScroll));
		return {
			kind: 'freeze-live-portal',
			className: cellClassName,
			portalCellKey,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
			shouldMarkDirty: shouldDirtyFrozen,
			captureFrozenHtml: hasScrollSnapshotHtml,
			snapshotForCapture: snapshot,
		};
	}

	// Impostor paths — only reached when the slot has no live portal content for the current row/key.
	const portalImpostorSnapshot =
		hasScrollImpostorCapability && !isEditing && !isFocused && snapshot && snapshot.contentMode === 'fallback' ? snapshot : undefined;
	if (portalImpostorSnapshot) {
		const currentRowHeight = deps.engine.geometry?.rowHeights?.[rowIndex];
		const frozenHtmlValid =
			portalImpostorSnapshot.frozenHtml &&
			(portalImpostorSnapshot.frozenRowHeight === undefined || portalImpostorSnapshot.frozenRowHeight === currentRowHeight);
		const releaseStalePortal = !!cellSlot.lastPortalKey;
		if (frozenHtmlValid) {
			return {
				kind: 'impostor-html',
				className: cellClassName,
				frozenHtml: portalImpostorSnapshot.frozenHtml!,
				releaseStalePortal,
				recordVersionsFrom: portalImpostorSnapshot,
				title: portalImpostorSnapshot.title || null,
				validationError: portalImpostorSnapshot.validationError,
			};
		}
		return {
			kind: 'impostor-text',
			className: cellClassName,
			contentMode: portalImpostorSnapshot.contentMode,
			formattedValue: portalImpostorSnapshot.formattedValue,
			releaseStalePortal,
			recordVersionsFrom: portalImpostorSnapshot,
			title: portalImpostorSnapshot.title || null,
			validationError: portalImpostorSnapshot.validationError,
		};
	}

	const canFreezePortal =
		isPortalSnapshotContent(snapshot) &&
		cellSlot.lastPortalKey === portalCellKey &&
		(snapshot.contentKind === 'portal-live' || snapshot.contentKind === 'portal-frozen') &&
		hasAuthoritativePortalHostContent(deps, cellSlot, portalCellKey);

	// Synthesis impostor: no snapshot, no live content, no freeze path — show cheap text stand-in
	// so the scroll frame stays portal-free. Fidelity lane mounts the real portal post-scroll.
	if (hasScrollImpostorCapability && !isEditing && !isFocused && !canFreezePortal) {
		const genericCheap = deps.engine.getCheapDisplayValue?.(node.id, col.field) ?? '';
		const scrollImpostorFn = (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.scrollImpostor;
		const cheapValue =
			isWarmBindingVersionFresh && cellSlot.lastFormattedValue != null && cellSlot.lastContentMode !== 'portal'
				? cellSlot.lastFormattedValue
				: scrollImpostorFn != null
					? scrollImpostorFn({ value: undefined, formattedValue: genericCheap }) || genericCheap
					: genericCheap;
		const syntheticMode: CellContentMode = cheapValue !== '' ? 'fallback' : 'empty';
		return {
			kind: 'impostor-synthetic',
			className: cellClassName,
			contentMode: syntheticMode,
			formattedValue: cheapValue,
			releaseStalePortal: !!cellSlot.lastPortalKey,
			recordVersions: snapshot ?? {
				rowVersion: input.rowVersion,
				globalVersion: ctx.globalVersion,
				insightVersion: ctx.insightVersion,
				styleVersion: ctx.styleVersion,
				loadingVersion: ctx.loadingVersion,
				selectionVersion: ctx.selectionVersion,
			},
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	const globalChanged = cellSlot.lastMountedGlobalVersion !== -1 && ctx.globalVersion !== cellSlot.lastMountedGlobalVersion;
	const rowChanged = cellSlot.lastMountedRowVersion !== -1 && input.rowVersion !== undefined && input.rowVersion !== cellSlot.lastMountedRowVersion;
	const isDataStale = !isRowRebind && canFreezePortal && (globalChanged || rowChanged);
	const isPortalFrozen =
		!isRowRebind && canFreezePortal && (!isDataStale || (isPortalSnapshotContent(snapshot) && snapshot.contentKind === 'portal-frozen'));
	const isStaleFrozen = (isRowRebind || isDataStale) && canFreezePortal;
	const hasSnapshotCoverageForDecorations = !ctx.hasInsightDecorations || !!snapshot;
	const shouldDirtyFrozenPortal =
		isFocused ||
		isEditing ||
		!hasSnapshotCoverageForDecorations ||
		(ctx.hasDeferredCellStyleRules &&
			(!snapshot || ctx.styleChangedDuringScroll || ctx.selectionChangedDuringScroll || ctx.loadingChangedDuringScroll));

	if (isPortalFrozen || isStaleFrozen) {
		// Mutually exclusive in the original: a custom-live frozen cell only refreshes its version
		// stamp and is never separately marked dirty, even when shouldDirtyFrozenPortal is also true.
		const keepVersionFresh = isPortalFrozen && scrollMode === 'custom-live';
		return {
			kind: 'portal-frozen',
			className: cellClassName,
			portalCellKey,
			markDirty: !keepVersionFresh && (!isPortalFrozen || shouldDirtyFrozenPortal),
			keepVersionFresh,
			recordVersionsFrom: snapshot,
			title: snapshot?.title || null,
			validationError: snapshot?.validationError,
		};
	}

	return {
		kind: 'portal-mount',
		className: cellClassName,
		portalCellKey,
		releasePriorPortal: !!cellSlot.lastPortalKey && cellSlot.lastPortalKey !== portalCellKey,
		isEditing,
		isFocused,
		recordVersionsFrom: snapshot,
		title: snapshot?.title || null,
		validationError: snapshot?.validationError,
	};
}
