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

/**
 * Beyond the 15 golden mode x lane tests above, these cover the editing/focused/loading/rebind
 * dimensions where a binder's DOM-write behavior is actually distinct — not the full 5 x 3 x 2 x 2 x
 * 2 x 2 combinatorial product (most of those cells are identical to a already-covered case; the pure
 * resolver's own exhaustive tests in scrollCellPresentation.test.ts already cover which *presentation*
 * gets chosen for a given editing/focused/rebind combination). What's tested here is narrower and
 * complementary: given a presentation the resolver already decided on, does the binder correctly
 * thread isEditing/isFocused/isLoading into the actual portal mount call, and does
 * freeze-live-portal's rebind-driven shouldMarkDirty flag actually gate markCellDirtyAfterScroll.
 */
describe('cellPresentationDispatcher — editing/focused/loading/rebind flag threading', () => {
	it('live-mount forwards isEditing/isFocused/isRowLoading through to the portal mount call', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowLoading: true });
		const presentation: ScrollCellPresentation = {
			kind: 'live-mount',
			className: laneClass.center,
			portalCellKey: 'ck1',
			releasePriorPortal: false,
			isEditing: true,
			isFocused: true,
			recordVersionsFrom: undefined,
			title: null,
			validationError: undefined,
		};
		dispatchCellPresentation(deps, request, presentation, 1);
		expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledWith(
			expect.objectContaining({ isEditing: true, isFocused: true, isLoading: true })
		);
	});

	it('force-live-interactive-exception (the rebind-independent editing/focused override) forwards the same flags and its own counter', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowRebind: true });
		const presentation: ScrollCellPresentation = {
			kind: 'force-live-interactive-exception',
			className: laneClass.center,
			portalCellKey: 'ck1',
			releasePriorPortal: true,
			isEditing: true,
			isFocused: false,
			recordVersionsFrom: undefined,
			title: null,
			validationError: undefined,
		};
		dispatchCellPresentation(deps, request, presentation, 1);
		expect(deps.incrementForceLiveMountsDuringScroll).toHaveBeenCalledTimes(1);
		expect(deps.incrementLiveReactMountsDuringScroll).not.toHaveBeenCalled();
		expect(deps.portalMountManager.mountCellImmediately).toHaveBeenCalledWith(expect.objectContaining({ isEditing: true, isFocused: false }));
	});

	it('freeze-live-portal with shouldMarkDirty:true (driven by a rebind/version-drift the resolver detected) marks the cell dirty', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowRebind: true });
		const presentation: ScrollCellPresentation = {
			kind: 'freeze-live-portal',
			className: laneClass.center,
			portalCellKey: 'ck1',
			title: null,
			validationError: undefined,
			shouldMarkDirty: true,
			captureFrozenHtml: false,
			snapshotForCapture: undefined,
		};
		dispatchCellPresentation(deps, request, presentation, 1);
		expect(deps.markCellDirtyAfterScroll).toHaveBeenCalledWith(request.cellSlot.element);
	});

	it('freeze-live-portal with shouldMarkDirty:false does not mark the cell dirty', () => {
		const deps = makeDeps();
		const request = makeRequest('center');
		const presentation: ScrollCellPresentation = {
			kind: 'freeze-live-portal',
			className: laneClass.center,
			portalCellKey: 'ck1',
			title: null,
			validationError: undefined,
			shouldMarkDirty: false,
			captureFrozenHtml: false,
			snapshotForCapture: undefined,
		};
		dispatchCellPresentation(deps, request, presentation, 1);
		expect(deps.markCellDirtyAfterScroll).not.toHaveBeenCalled();
	});

	it('html-snapshot-pending (the loading-adjacent no-capture-yet case) writes a pending shell, not the frozen-HTML portal path', () => {
		const deps = makeDeps();
		const request = makeRequest('center', { isRowLoading: true });
		const presentation: ScrollCellPresentation = {
			kind: 'html-snapshot-pending',
			className: laneClass.center,
			title: null,
			validationError: undefined,
			releaseStalePortal: false,
			recordVersions: { rowVersion: 1, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0 },
		};
		dispatchCellPresentation(deps, request, presentation, 1);
		expect(deps.incrementHtmlSnapshotMissesDuringScroll).toHaveBeenCalledTimes(1);
		expect(request.cellSlot.lastContentMode).toBe('pending');
		expect(deps.portalMountManager.mountCellImmediately).not.toHaveBeenCalled();
	});
});
