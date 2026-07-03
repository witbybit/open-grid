// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import { resolveWarmVisibleCellStatus, type WarmVisibleCellStatusContext, type WarmVisibleCellStatusDeps } from './warmCellStatus.js';

function makeDeps(overrides: Partial<WarmVisibleCellStatusDeps> = {}): WarmVisibleCellStatusDeps {
	return {
		getCellPortalHost: vi.fn(() => null),
		isCellMounted: vi.fn(() => true),
		...overrides,
	};
}

function makeContext(overrides: Partial<WarmVisibleCellStatusContext> = {}): WarmVisibleCellStatusContext {
	return {
		currentRowVersion: 3,
		globalVersion: 7,
		globalChangedDuringScroll: false,
		insightVersion: 0,
		styleVersion: 0,
		loadingVersion: 0,
		selectionVersion: 0,
		hasInsightDecorations: false,
		hasDeferredCellStyleRules: false,
		loadingChangedDuringScroll: false,
		selectionChangedDuringScroll: false,
		...overrides,
	};
}

function warmSlot(overrides: Partial<CellSlot> = {}): CellSlot<{ id: string }> {
	const slot = new CellSlot<{ id: string }>(document.createElement('div'));
	slot.lastMountedRowVersion = 3;
	slot.lastMountedGlobalVersion = 7;
	slot.lastMountedInsightVersion = 0;
	slot.lastMountedStyleVersion = 0;
	slot.lastMountedLoadingVersion = 0;
	slot.lastMountedSelectionVersion = 0;
	slot.lastContentMode = 'text';
	slot.lastFormattedValue = 'ready';
	Object.assign(slot, overrides);
	return slot;
}

describe('resolveWarmVisibleCellStatus', () => {
	it('a fully fresh warm cell needs neither immediate wake nor deferred refresh', () => {
		const status = resolveWarmVisibleCellStatus(makeDeps(), warmSlot(), makeContext());
		expect(status).toEqual({ needsImmediateWake: false, needsDeferredRefresh: false });
	});

	it('needs immediate wake when the cell has never been mounted (virgin -1 sentinel)', () => {
		const status = resolveWarmVisibleCellStatus(makeDeps(), warmSlot({ lastMountedRowVersion: -1 }), makeContext());
		expect(status.needsImmediateWake).toBe(true);
		expect(status.needsDeferredRefresh).toBe(true);
	});

	it('needs immediate wake when still showing the "..." placeholder', () => {
		const status = resolveWarmVisibleCellStatus(makeDeps(), warmSlot({ lastContentMode: 'text', lastFormattedValue: '...' }), makeContext());
		expect(status.needsImmediateWake).toBe(true);
	});

	it('needs immediate wake when the portal key is dangling (not actually mounted)', () => {
		const slot = warmSlot({ lastContentMode: 'portal', lastPortalKey: 'stale-key' });
		const status = resolveWarmVisibleCellStatus(makeDeps({ isCellMounted: () => false }), slot, makeContext());
		expect(status.needsImmediateWake).toBe(true);
	});

	it('needs immediate wake when the portal host exists but is empty', () => {
		const slot = warmSlot({ lastContentMode: 'portal', lastPortalKey: 'k1' });
		const emptyHost = document.createElement('div');
		const status = resolveWarmVisibleCellStatus(makeDeps({ getCellPortalHost: () => emptyHost }), slot, makeContext());
		expect(status.needsImmediateWake).toBe(true);
	});

	it('needs immediate wake when the row data version has drifted since mount', () => {
		const status = resolveWarmVisibleCellStatus(makeDeps(), warmSlot(), makeContext({ currentRowVersion: 4 }));
		expect(status.needsImmediateWake).toBe(true);
	});

	it('needs immediate wake when the global data version has drifted during scroll', () => {
		const status = resolveWarmVisibleCellStatus(makeDeps(), warmSlot(), makeContext({ globalChangedDuringScroll: true, globalVersion: 8 }));
		expect(status.needsImmediateWake).toBe(true);
	});

	it('does NOT need immediate wake for a stale insight decoration — that is deferred-only', () => {
		const status = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedInsightVersion: 0 }),
			makeContext({ hasInsightDecorations: true, insightVersion: 1 })
		);
		expect(status.needsImmediateWake).toBe(false);
		expect(status.needsDeferredRefresh).toBe(true);
	});

	// Note: a mismatch on ANY of insight/style/loading/selection also trips the broader
	// `!mountedFreshnessMatches` catch-all (as long as all four have been mounted at least once, i.e.
	// none is the -1 virgin sentinel) — so a per-dimension "not applicable" flag alone cannot isolate
	// needsDeferredRefresh down to false once ANY dimension has drifted. The tests below confirm the
	// stale/changed=true side (both the specific gate AND the catch-all agree); the not-applicable
	// side is proven false only when paired with a virgin (-1) sentinel on the other three dimensions,
	// which disables the catch-all and isolates the specific gate being tested.

	it('a stale insight version needs deferred refresh only when there are insight decorations to show', () => {
		const stale = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedInsightVersion: 0 }),
			makeContext({ hasInsightDecorations: true, insightVersion: 1 })
		);
		expect(stale.needsDeferredRefresh).toBe(true);

		// Isolate the insight-specific gate from the broader catch-all by making the other three
		// dimensions virgin (-1) — matchesCellSlotMountedFreshness's overall-mismatch catch-all
		// requires all four to have been mounted at least once to fire.
		const notApplicable = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedInsightVersion: 0, lastMountedStyleVersion: -1, lastMountedLoadingVersion: -1, lastMountedSelectionVersion: -1 }),
			makeContext({ hasInsightDecorations: false, insightVersion: 1 })
		);
		expect(notApplicable.needsDeferredRefresh).toBe(false);
	});

	it('needs deferred refresh for a stale style version only when deferred cell style rules exist', () => {
		const stale = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedStyleVersion: 0 }),
			makeContext({ hasDeferredCellStyleRules: true, styleVersion: 1 })
		);
		expect(stale.needsDeferredRefresh).toBe(true);

		const notApplicable = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedStyleVersion: 0, lastMountedInsightVersion: -1, lastMountedLoadingVersion: -1, lastMountedSelectionVersion: -1 }),
			makeContext({ hasDeferredCellStyleRules: false, styleVersion: 1 })
		);
		expect(notApplicable.needsDeferredRefresh).toBe(false);
	});

	it('needs deferred refresh for a stale loading version only when loading actually changed during scroll', () => {
		const changed = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedLoadingVersion: 0 }),
			makeContext({ loadingChangedDuringScroll: true, loadingVersion: 1 })
		);
		expect(changed.needsDeferredRefresh).toBe(true);

		const unchanged = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedLoadingVersion: 0, lastMountedInsightVersion: -1, lastMountedStyleVersion: -1, lastMountedSelectionVersion: -1 }),
			makeContext({ loadingChangedDuringScroll: false, loadingVersion: 1 })
		);
		expect(unchanged.needsDeferredRefresh).toBe(false);
	});

	it('needs deferred refresh for a stale selection version only when selection actually changed during scroll', () => {
		const changed = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedSelectionVersion: 0 }),
			makeContext({ selectionChangedDuringScroll: true, selectionVersion: 1 })
		);
		expect(changed.needsDeferredRefresh).toBe(true);

		const unchanged = resolveWarmVisibleCellStatus(
			makeDeps(),
			warmSlot({ lastMountedSelectionVersion: 0, lastMountedInsightVersion: -1, lastMountedStyleVersion: -1, lastMountedLoadingVersion: -1 }),
			makeContext({ selectionChangedDuringScroll: false, selectionVersion: 1 })
		);
		expect(unchanged.needsDeferredRefresh).toBe(false);
	});
});
