// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from '../cellSlot.js';
import type { RowCellBinderDeps, BindCellDuringScrollRequest } from '../rowCellBinder.js';
import type { ScrollCellPresentation } from '../scrollCellPresentation.js';
import { dispatchCellPresentation } from './cellPresentationDispatcher.js';

/**
 * One golden test per mode per lane (5 modes x 3 lanes = 15) — proves cellPresentationDispatcher.ts
 * routes each ScrollCellPresentation kind to the correct binder and that binder still performs the
 * same DOM write / telemetry increment the pre-split monolithic applyScrollCellPresentation did.
 * This is a regression harness for the Phase 1 extraction, not a redesign of expected behavior.
 */

function makeDeps(overrides: Partial<RowCellBinderDeps<{ id: string; name: string }>> = {}): RowCellBinderDeps<{ id: string; name: string }> {
	return {
		engine: {
			data: { getCachedDisplayValue: vi.fn(() => undefined) },
			hasFormula: vi.fn(() => false),
			getCellDisplaySnapshot: vi.fn(() => undefined),
			getCheapDisplayValue: vi.fn(() => ''),
			htmlScrollSnapshots: { get: vi.fn(() => undefined), set: vi.fn() },
			geometry: { rowHeights: [40] },
		} as any,
		cellRenderer: { showPortalContent: vi.fn(), ensureLoadingSkeleton: vi.fn() } as any,
		portalMountManager: { isCellMounted: vi.fn(() => false), mountCell: vi.fn(), mountCellImmediately: vi.fn() } as any,
		selectionPaint: {} as any,
		cellClassScratch: {} as any,
		getViewportContainer: () => null,
		getIsScrolling: () => true,
		getIsScrollFrameActive: () => true,
		programmaticScrollCell: null,
		clearProgrammaticScrollCell: vi.fn(),
		setDeferredFocusCell: vi.fn(),
		applyFocus: vi.fn(),
		isEditorInteractiveElement: () => false,
		ensureCellPortalHost: (cell) => {
			const host = document.createElement('div');
			cell.appendChild(host);
			return host;
		},
		getCellPortalHost: () => null,
		markCellDirtyAfterScroll: vi.fn(),
		releaseCellPortal: vi.fn(),
		incrementStyleHookCallsDuringScroll: vi.fn(),
		incrementCellsBoundDuringScroll: vi.fn(),
		incrementCurrentScrollCellsWritten: vi.fn(),
		incrementForceLiveMountsDuringScroll: vi.fn(),
		incrementLiveReactMountsDuringScroll: vi.fn(),
		incrementHtmlSnapshotHitsDuringScroll: vi.fn(),
		incrementHtmlSnapshotMissesDuringScroll: vi.fn(),
		incrementTextImpostorUsesDuringScroll: vi.fn(),
		getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		...overrides,
	};
}

function makeRequest(
	lane: 'left' | 'center' | 'right',
	overrides: Partial<BindCellDuringScrollRequest<{ id: string; name: string }>> = {}
): BindCellDuringScrollRequest<{ id: string; name: string }> {
	return {
		cellSlot: new CellSlot(document.createElement('div')),
		node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
		rowIndex: 0,
		colIndex: 0,
		col: { field: 'name', cellRenderer: () => null } as any,
		lane,
		ctx: {
			activeEdit: null,
			focusedCell: null,
			globalVersion: 1,
			insightVersion: 0,
			styleVersion: 0,
			selectionVersion: 0,
			loadingVersion: 0,
			hasDeferredCellStyleRules: false,
			isScrolling: true,
			plan: { columnPlans: [{ isCustom: true, mode: 'custom' }], colWidths: [100] },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			rowVersions: new Map([['r1', 1]]),
		} as any,
		pooledRowId: 'slot-1',
		pooledRowGeneration: 0,
		left: 0,
		right: -1,
		width: 100,
		isRowRebind: false,
		isRowLoading: false,
		isInVisibleContent: true,
		...overrides,
	};
}

const laneClass: Record<'left' | 'center' | 'right', string> = {
	left: 'og-cell og-cell-pinned-left',
	center: 'og-cell',
	right: 'og-cell og-cell-pinned-right',
};

const LANES: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];

describe('cellPresentationDispatcher — one golden test per mode per lane', () => {
	for (const lane of LANES) {
		it(`primitive mode (${lane}): writes text content and releases stale portal`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'primitive',
				className: laneClass[lane],
				contentMode: 'text',
				formattedValue: 'hello',
				markDirty: true,
				releaseStalePortal: false,
				title: null,
				validationError: undefined,
				recordVersionsFrom: undefined,
			};
			dispatchCellPresentation(deps, request, presentation, 1);
			expect(request.cellSlot.lastContentMode).toBe('text');
			expect(request.cellSlot.lastFormattedValue).toBe('hello');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
			expect(deps.markCellDirtyAfterScroll).toHaveBeenCalledWith(request.cellSlot.element);
		});

		it(`live mode (${lane}): mounts the real renderer immediately`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'live-mount',
				className: laneClass[lane],
				portalCellKey: 'ck1',
				releasePriorPortal: false,
				isEditing: false,
				isFocused: false,
				recordVersionsFrom: undefined,
				title: null,
				validationError: undefined,
			};
			dispatchCellPresentation(deps, request, presentation, 1);
			expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledWith(
				expect.objectContaining({ phase: 'scroll-live', isScrolling: true })
			);
			expect(deps.incrementLiveReactMountsDuringScroll).toHaveBeenCalledTimes(1);
			expect(request.cellSlot.lastContentMode).toBe('portal');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
		});

		it(`freeze mode (${lane}): freezes an existing live portal in place without remounting`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'freeze-live-portal',
				className: laneClass[lane],
				portalCellKey: 'ck1',
				title: null,
				validationError: undefined,
				shouldMarkDirty: false,
				captureFrozenHtml: false,
				snapshotForCapture: undefined,
			};
			dispatchCellPresentation(deps, request, presentation, 1);
			expect(deps.cellRenderer.showPortalContent).toHaveBeenCalledWith(request.cellSlot.element);
			expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
			expect(request.cellSlot.lastContentMode).toBe('portal');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
		});

		it(`text-impostor mode (${lane}): shows the explicit text impostor, never mounts`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'text-impostor',
				className: laneClass[lane],
				contentMode: 'fallback',
				formattedValue: '★ chip',
				releaseStalePortal: false,
				recordVersions: { rowVersion: 1, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 },
				title: null,
				validationError: undefined,
			};
			dispatchCellPresentation(deps, request, presentation, 1);
			expect(deps.incrementTextImpostorUsesDuringScroll).toHaveBeenCalledTimes(1);
			expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
			expect(request.cellSlot.lastFormattedValue).toBe('★ chip');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
		});

		it(`html-snapshot mode (${lane}): replays frozen HTML into the portal host, never mounts`, () => {
			const deps = makeDeps();
			const request = makeRequest(lane);
			const presentation: ScrollCellPresentation = {
				kind: 'impostor-html',
				className: laneClass[lane],
				frozenHtml: '<span>frozen</span>',
				releaseStalePortal: false,
				recordVersionsFrom: { rowVersion: 1, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 },
				title: null,
				validationError: undefined,
			};
			dispatchCellPresentation(deps, request, presentation, 1);
			expect(deps.incrementHtmlSnapshotHitsDuringScroll).toHaveBeenCalledTimes(1);
			expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
			expect(request.cellSlot.lastContentMode).toBe('portal');
			expect(request.cellSlot.lastClassName).toBe(laneClass[lane]);
		});
	}
});
