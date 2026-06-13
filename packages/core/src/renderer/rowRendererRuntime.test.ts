// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RowRendererRuntimeBridge, type RowRendererRuntimeBridgeDeps, type RowRendererRuntimeStateHost } from './rowRendererRuntime.js';

vi.mock('./cellSlot.js', () => ({
	CellSlot: {
		fromElement: vi.fn(() => ({ binding: null })),
	},
}));

function makeStateHost(overrides?: Partial<RowRendererRuntimeStateHost<unknown>>): RowRendererRuntimeStateHost<unknown> {
	return {
		cellClassScratch: {} as any,
		currentWindow: null,
		dirtyCellsAfterScroll: new Set(),
		dirtyRowsAfterScroll: new Set(),
		dirtyBuckets: [[], [], [], []],
		activeRows: new Map(),
		pendingPortalReleasesAfterScroll: new Map(),
		programmaticScrollCell: null,
		deferredFocusCell: null,
		isScrolling: false,
		isScrollFrameActive: false,
		renderStats: { focusCallsDuringScroll: 0, styleHookCallsDuringScroll: 0, cellsBoundDuringScroll: 0 },
		currentScrollCellsVisited: 0,
		currentScrollCellsPatched: 0,
		currentScrollCellsWritten: 0,
		currentScrollPortalOps: 0,
		postScrollDirtyCellsDecorated: 0,
		dirtyCellsMarkedDuringScroll: 0,
		...overrides,
	};
}

function makeDeps(stateHost: RowRendererRuntimeStateHost<unknown>): RowRendererRuntimeBridgeDeps<unknown> {
	return {
		engine: {} as any,
		cellRenderer: {
			getOrCreateCellContentLayer: vi.fn(() => document.createElement('div')),
			getOrCreatePortalHost: vi.fn(() => document.createElement('div')),
			getPortalHost: vi.fn(() => null),
			ensureLoadingSkeleton: vi.fn(),
		} as any,
		portalMountManager: {
			releaseCellForScroll: vi.fn(),
			releaseCell: vi.fn(),
		} as any,
		getViewportContainer: () => null,
		selectionPaint: {} as any,
		getFullWidthRenderer: () => ({}) as any,
		stateHost,
		initCell: () => {},
		releaseCellFn: () => {},
		ensurePinnedContainer: () => null,
		releaseRowPortal: () => false,
	};
}

function makeBridge(overrides?: Partial<RowRendererRuntimeStateHost<unknown>>) {
	const stateHost = makeStateHost(overrides);
	const deps = makeDeps(stateHost);
	return { bridge: new RowRendererRuntimeBridge(deps), stateHost, deps };
}

function cellWithKey(key: string): HTMLDivElement {
	const el = document.createElement('div');
	el.dataset.cellKey = key;
	return el;
}

// ─── markCellDirtyAfterScroll ─────────────────────────────────────────────────

describe('RowRendererRuntimeBridge – markCellDirtyAfterScroll', () => {
	it('adds cell to dirty set and increments counter', () => {
		const { bridge, stateHost } = makeBridge();
		const cell = document.createElement('div');

		bridge.markCellDirtyAfterScroll(cell);

		expect(stateHost.dirtyCellsAfterScroll.has(cell)).toBe(true);
		expect(stateHost.dirtyCellsMarkedDuringScroll).toBe(1);
	});

	it('does NOT double-count when the same cell is marked twice', () => {
		const { bridge, stateHost } = makeBridge();
		const cell = document.createElement('div');

		bridge.markCellDirtyAfterScroll(cell);
		bridge.markCellDirtyAfterScroll(cell);

		expect(stateHost.dirtyCellsAfterScroll.size).toBe(1);
		expect(stateHost.dirtyCellsMarkedDuringScroll).toBe(1);
	});

	it('tracks distinct cells independently', () => {
		const { bridge, stateHost } = makeBridge();
		const a = document.createElement('div');
		const b = document.createElement('div');

		bridge.markCellDirtyAfterScroll(a);
		bridge.markCellDirtyAfterScroll(b);

		expect(stateHost.dirtyCellsAfterScroll.size).toBe(2);
		expect(stateHost.dirtyCellsMarkedDuringScroll).toBe(2);
	});
});

// ─── releaseCellPortal ────────────────────────────────────────────────────────

describe('RowRendererRuntimeBridge – releaseCellPortal', () => {
	it('does nothing when cell has no cellKey', () => {
		const { bridge, deps } = makeBridge();
		const cell = document.createElement('div'); // no dataset.cellKey

		bridge.releaseCellPortal(cell);

		expect(deps.portalMountManager.releaseCellForScroll).not.toHaveBeenCalled();
		expect(deps.portalMountManager.releaseCell).not.toHaveBeenCalled();
	});

	it('uses immediate release when not scrolling', () => {
		const { bridge, deps } = makeBridge({ isScrolling: false, isScrollFrameActive: false });
		const cell = cellWithKey('cell-1');

		bridge.releaseCellPortal(cell);

		expect(deps.portalMountManager.releaseCell).toHaveBeenCalledWith(expect.objectContaining({ cellKey: 'cell-1', flushSync: false }));
		expect(deps.portalMountManager.releaseCellForScroll).not.toHaveBeenCalled();
	});

	it('uses deferred release when isScrolling', () => {
		const { bridge, deps, stateHost } = makeBridge({ isScrolling: true });
		const cell = cellWithKey('cell-2');

		bridge.releaseCellPortal(cell);

		expect(deps.portalMountManager.releaseCellForScroll).toHaveBeenCalledWith(expect.objectContaining({ cellKey: 'cell-2', flushSync: false }));
		expect(stateHost.currentScrollPortalOps).toBe(1);
		expect(deps.portalMountManager.releaseCell).not.toHaveBeenCalled();
	});

	it('uses deferred release when isScrollFrameActive', () => {
		const { bridge, deps, stateHost } = makeBridge({ isScrollFrameActive: true });
		const cell = cellWithKey('cell-3');

		bridge.releaseCellPortal(cell);

		expect(deps.portalMountManager.releaseCellForScroll).toHaveBeenCalled();
		expect(stateHost.currentScrollPortalOps).toBe(1);
	});

	it('forces deferred release when forceDeferred=true even if not scrolling', () => {
		const { bridge, deps, stateHost } = makeBridge({ isScrolling: false, isScrollFrameActive: false });
		const cell = cellWithKey('cell-4');

		bridge.releaseCellPortal(cell, true);

		expect(deps.portalMountManager.releaseCellForScroll).toHaveBeenCalled();
		expect(stateHost.currentScrollPortalOps).toBe(1);
		expect(deps.portalMountManager.releaseCell).not.toHaveBeenCalled();
	});
});

// ─── applyFocus ───────────────────────────────────────────────────────────────

describe('RowRendererRuntimeBridge – applyFocus', () => {
	it('calls cell.focus when not scrolling', () => {
		const { bridge } = makeBridge({ isScrolling: false, isScrollFrameActive: false });
		const cell = document.createElement('div');
		const focusSpy = vi.spyOn(cell, 'focus');

		bridge.applyFocus(cell);

		expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
	});

	it('defers focus when isScrollFrameActive and does NOT call cell.focus', () => {
		const { bridge, stateHost } = makeBridge({ isScrollFrameActive: true });
		const cell = document.createElement('div');
		const focusSpy = vi.spyOn(cell, 'focus');

		bridge.applyFocus(cell);

		expect(focusSpy).not.toHaveBeenCalled();
		expect(stateHost.deferredFocusCell).toBe(cell);
	});

	it('defers focus when isScrolling and does NOT call cell.focus', () => {
		const { bridge, stateHost } = makeBridge({ isScrolling: true });
		const cell = document.createElement('div');
		const focusSpy = vi.spyOn(cell, 'focus');

		bridge.applyFocus(cell);

		expect(focusSpy).not.toHaveBeenCalled();
		expect(stateHost.deferredFocusCell).toBe(cell);
	});

	it('increments focusCallsDuringScroll when deferring', () => {
		const renderStats = { focusCallsDuringScroll: 0 };
		const { bridge } = makeBridge({ isScrolling: true, renderStats });
		const cell = document.createElement('div');

		bridge.applyFocus(cell);

		expect(renderStats.focusCallsDuringScroll).toBe(1);
	});
});

// ─── cancelPendingPortalRelease ───────────────────────────────────────────────

describe('RowRendererRuntimeBridge – cancelPendingPortalRelease', () => {
	it('removes the key from pendingPortalReleasesAfterScroll', () => {
		const { bridge, stateHost } = makeBridge();
		stateHost.pendingPortalReleasesAfterScroll.set('key-abc', {});

		bridge.cancelPendingPortalRelease('key-abc');

		expect(stateHost.pendingPortalReleasesAfterScroll.has('key-abc')).toBe(false);
	});

	it('is a no-op when the key does not exist', () => {
		const { bridge, stateHost } = makeBridge();

		bridge.cancelPendingPortalRelease('nonexistent');

		expect(stateHost.pendingPortalReleasesAfterScroll.size).toBe(0);
	});
});
