// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import { resolveScrollCellPresentation, type ScrollCellPresentationInput } from './scrollCellPresentation.js';
import type { RowCellBinderDeps } from './rowCellBinder.js';

/**
 * The resolver must never perform a DOM write, portal mount/release, or semantic read. Deps here
 * intentionally omit getCellValue/valueGetter/formula/style-rule/integrity hooks entirely — if the
 * resolver ever reached for one, the call would throw "not a function" and fail the test.
 */
function makeDeps(overrides: Partial<RowCellBinderDeps<{ id: string; name: string }>> = {}): RowCellBinderDeps<{ id: string; name: string }> {
	return {
		engine: {
			getCheapDisplayValue: vi.fn(() => ''),
			geometry: { rowHeights: [40] },
		} as any,
		cellRenderer: {} as any,
		portalMountManager: {} as any,
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
		ensureCellPortalHost: vi.fn(),
		getCellPortalHost: vi.fn(() => null),
		markCellDirtyAfterScroll: vi.fn(),
		releaseCellPortal: vi.fn(),
		incrementStyleHookCallsDuringScroll: vi.fn(),
		incrementCellsBoundDuringScroll: vi.fn(),
		incrementCurrentScrollCellsWritten: vi.fn(),
		getSnapshotVisualVersions: () => ({ styleVersion: 0, loadingVersion: 0 }),
		...overrides,
	};
}

function baseInput(
	overrides: Partial<ScrollCellPresentationInput<{ id: string; name: string }>> = {}
): ScrollCellPresentationInput<{ id: string; name: string }> {
	return {
		cellSlot: new CellSlot(document.createElement('div')),
		node: { id: 'r1', data: { id: 'r1', name: 'Name 1' } } as any,
		rowIndex: 0,
		colIndex: 0,
		col: { field: 'name' } as any,
		lane: 'center',
		ctx: {
			activeEdit: null,
			focusedCell: null,
			globalVersion: 7,
			insightVersion: 0,
			styleVersion: 0,
			selectionVersion: 0,
			hasDeferredCellStyleRules: false,
			hasInsightDecorations: false,
			isScrolling: true,
			loadingVersion: 0,
			plan: { columnPlans: [{ isCustom: false, mode: 'primitive' }] },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			rowVersions: new Map([['r1', 3]]),
		} as any,
		isRowRebind: false,
		isRowLoading: false,
		isInVisibleContent: true,
		snapshot: undefined,
		isWarmBindingVersionFresh: false,
		rowVersion: 3,
		cellKey: 'ci1:name',
		...overrides,
	};
}

describe('resolveScrollCellPresentation', () => {
	it('resolves a checkbox-selection column to checkbox-selector regardless of other state', () => {
		const presentation = resolveScrollCellPresentation(makeDeps(), baseInput({ col: { field: 'sel', checkboxSelection: true } as any }));
		expect(presentation.kind).toBe('checkbox-selector');
	});

	it('resolves an off-screen buffered cell with no snapshot to empty, releasing a stale portal', () => {
		const cellSlot = new CellSlot<{ id: string; name: string }>(document.createElement('div'));
		cellSlot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'stale-key');
		const presentation = resolveScrollCellPresentation(makeDeps(), baseInput({ cellSlot, isInVisibleContent: false }));
		expect(presentation.kind).toBe('buffered');
		if (presentation.kind !== 'buffered') throw new Error('unreachable');
		expect(presentation.contentMode).toBe('empty');
		expect(presentation.releaseStalePortal).toBe(true);
	});

	it('resolves a visible primitive cell with no snapshot and no warm state to the "..." placeholder', () => {
		const presentation = resolveScrollCellPresentation(makeDeps(), baseInput());
		expect(presentation.kind).toBe('primitive');
		if (presentation.kind !== 'primitive') throw new Error('unreachable');
		expect(presentation.formattedValue).toBe('...');
		expect(presentation.markDirty).toBe(true);
	});

	it('resolves a fresh custom-live snapshot for a portal-capable column to an impostor variant, not a live mount', () => {
		const snapshot = {
			rowId: 'r1',
			colField: 'name',
			rowVersion: 3,
			globalVersion: 7,
			insightVersion: 0,
			styleVersion: 0,
			loadingVersion: 0,
			selectionVersion: 0,
			baseClassName: 'og-cell',
			stateClassName: '',
			decorationClassName: '',
			classTokens: ['og-cell'],
			className: 'og-cell',
			contentKind: 'impostor' as const,
			contentMode: 'fallback' as const,
			formattedValue: 'Fallback name',
			title: '',
		};
		const presentation = resolveScrollCellPresentation(
			makeDeps(),
			baseInput({
				col: { field: 'name', cellRenderer: () => null } as any,
				ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] } } as any,
				snapshot,
			})
		);
		expect(presentation.kind).toBe('impostor-text');
		if (presentation.kind !== 'impostor-text') throw new Error('unreachable');
		expect(presentation.formattedValue).toBe('Fallback name');
	});

	it('resolves a portal-capable column with no snapshot and no live content to a cold portal-mount', () => {
		const presentation = resolveScrollCellPresentation(
			makeDeps(),
			baseInput({
				col: { field: 'name', cellRenderer: () => null } as any,
				ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'primitive' }] } } as any,
			})
		);
		// mode is 'primitive' here (no impostor capability) and no existing portal — falls to the
		// cold-mount tail rather than any impostor path.
		expect(presentation.kind).toBe('portal-mount');
	});

	it('never calls a semantic read or portal-mount hook — deps deliberately omit them', () => {
		// If the resolver reached for getCellValue/valueGetter/formula/style/integrity/portal-mount,
		// makeDeps() doesn't define them and the call would throw synchronously.
		expect(() =>
			resolveScrollCellPresentation(
				makeDeps(),
				baseInput({
					col: { field: 'name', cellRenderer: () => null } as any,
					ctx: { ...baseInput().ctx, plan: { columnPlans: [{ isCustom: true, mode: 'custom-live' }] } } as any,
				})
			)
		).not.toThrow();
	});
});
