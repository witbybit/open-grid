import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RenderPaintCoordinator, type RenderPaintCoordinatorDeps, type RenderPaintCoordinatorState } from './renderPaintCoordinator.js';

const SENTINEL_A = { tag: 'A' };
const SENTINEL_B = { tag: 'B' };

function makeState(overrides?: Partial<RenderPaintCoordinatorState>): RenderPaintCoordinatorState {
	return {
		pendingTransition: false,
		lastStyleRules: undefined,
		lastLoading: undefined,
		...overrides,
	};
}

interface FakeGridState {
	styleRules: unknown;
	loading: unknown;
	defaultColWidth: number;
	defaultRowHeight: number;
}

function makeDeps(
	gridState: Partial<FakeGridState> = {},
	overrides: Partial<RenderPaintCoordinatorDeps<unknown>> = {}
): RenderPaintCoordinatorDeps<unknown> {
	const state: FakeGridState = {
		styleRules: undefined,
		loading: undefined,
		defaultColWidth: 100,
		defaultRowHeight: 40,
		...gridState,
	};
	return {
		engine: {
			stateManager: { getState: () => state },
			invalidation: { consume: vi.fn(() => ({ reasons: [] as string[] })) },
		} as any,
		viewportRenderer: { syncViewportScrollFromDom: vi.fn() } as any,
		rowRenderer: { styleVersion: 0, loadingVersion: 0, syncInteractionAccessibility: vi.fn() } as any,
		headerRenderer: { repaintHeaders: vi.fn() } as any,
		floatingFilterRenderer: { repaintFloatingFilters: vi.fn() } as any,
		overlayRenderer: { repaintOverlay: vi.fn() } as any,
		stickyGroupRenderer: { sync: vi.fn() } as any,
		portalMountManager: {
			beginCellReleaseTransaction: vi.fn(),
			endCellReleaseTransaction: vi.fn(),
		} as any,
		orchestrator: { flush: vi.fn() } as any,
		scrollCoordinator: { getIsScrolling: () => false },
		layoutTransition: { beginAnimation: vi.fn() } as any,
		recycleViewport: vi.fn(),
		syncLayoutPlan: vi.fn(() => ({ renderWindow: {} })) as any,
		updateCachedGeometryBoundsFromState: vi.fn(),
		...overrides,
	};
}

// ─── refreshRendererEpochs ────────────────────────────────────────────────────

describe('RenderPaintCoordinator – refreshRendererEpochs', () => {
	it('increments styleVersion when styleRules reference changes', () => {
		const deps = makeDeps({ styleRules: SENTINEL_A });
		const state = makeState({ lastStyleRules: undefined });
		const coord = new RenderPaintCoordinator(deps, state);

		coord.refreshRendererEpochs();

		expect((deps.rowRenderer as any).styleVersion).toBe(1);
		expect(state.lastStyleRules).toBe(SENTINEL_A);
	});

	it('does NOT increment styleVersion when styleRules is unchanged', () => {
		const deps = makeDeps({ styleRules: SENTINEL_A });
		const state = makeState({ lastStyleRules: SENTINEL_A });
		const coord = new RenderPaintCoordinator(deps, state);

		coord.refreshRendererEpochs();

		expect((deps.rowRenderer as any).styleVersion).toBe(0);
	});

	it('increments loadingVersion when loading state changes', () => {
		const deps = makeDeps({ loading: true });
		const state = makeState({ lastLoading: undefined });
		const coord = new RenderPaintCoordinator(deps, state);

		coord.refreshRendererEpochs();

		expect((deps.rowRenderer as any).loadingVersion).toBe(1);
		expect(state.lastLoading).toBe(true);
	});

	it('does NOT increment loadingVersion when loading is unchanged', () => {
		const deps = makeDeps({ loading: true });
		const state = makeState({ lastLoading: true });
		const coord = new RenderPaintCoordinator(deps, state);

		coord.refreshRendererEpochs();

		expect((deps.rowRenderer as any).loadingVersion).toBe(0);
	});

	it('increments both versions when both change simultaneously', () => {
		const deps = makeDeps({ styleRules: SENTINEL_B, loading: false });
		const state = makeState({ lastStyleRules: SENTINEL_A, lastLoading: true });
		const coord = new RenderPaintCoordinator(deps, state);

		coord.refreshRendererEpochs();

		expect((deps.rowRenderer as any).styleVersion).toBe(1);
		expect((deps.rowRenderer as any).loadingVersion).toBe(1);
	});
});

// ─── flushPaint – sort animation gate ────────────────────────────────────────

describe('RenderPaintCoordinator – flushPaint transition gate', () => {
	function depsForReason(reason: string, isScrolling = false) {
		return makeDeps(
			{},
			{
				engine: {
					stateManager: { getState: () => ({ styleRules: undefined, loading: undefined, defaultColWidth: 100, defaultRowHeight: 40 }) },
					invalidation: { consume: vi.fn(() => ({ reasons: [reason] })) },
				} as any,
				scrollCoordinator: { getIsScrolling: () => isScrolling },
			}
		);
	}

	it('plays the transition (and clears the flag) when a sort frame arrives while not scrolling', () => {
		const deps = depsForReason('sort');
		const state = makeState();
		new RenderPaintCoordinator(deps, state).flushPaint();

		expect((deps.layoutTransition as any).beginAnimation).toHaveBeenCalledTimes(1);
		expect(state.pendingTransition).toBe(false);
	});

	it('does NOT play the transition when a sort frame arrives while scrolling', () => {
		const deps = depsForReason('sort', true);
		const state = makeState();
		new RenderPaintCoordinator(deps, state).flushPaint();

		expect((deps.layoutTransition as any).beginAnimation).not.toHaveBeenCalled();
		expect(state.pendingTransition).toBe(false);
	});

	// Regression: group/tree expansion invalidates the VIEWPORT (not full), so the
	// transition must still fire from flushPaint — not only the full-paint path.
	it('plays the transition for a group/tree expansion (viewport) frame', () => {
		const deps = depsForReason('group expansion');
		const state = makeState();
		new RenderPaintCoordinator(deps, state).flushPaint();

		expect((deps.layoutTransition as any).beginAnimation).toHaveBeenCalledTimes(1);
		expect(state.pendingTransition).toBe(false);
	});

	it('plays the transition for a master-detail (viewport) frame', () => {
		const deps = depsForReason('detail');
		const state = makeState();
		new RenderPaintCoordinator(deps, state).flushPaint();

		expect((deps.layoutTransition as any).beginAnimation).toHaveBeenCalledTimes(1);
		expect(state.pendingTransition).toBe(false);
	});

	it('does NOT play the transition for non-transition frames', () => {
		const deps = depsForReason('filter');
		const state = makeState();
		new RenderPaintCoordinator(deps, state).flushPaint();

		expect((deps.layoutTransition as any).beginAnimation).not.toHaveBeenCalled();
		expect(state.pendingTransition).toBe(false);
	});

	it('plays the transition AFTER orchestrator.flush has repositioned rows', () => {
		const deps = depsForReason('group expansion');
		const order: string[] = [];
		(deps.orchestrator as any).flush = vi.fn(() => order.push('flush'));
		(deps.layoutTransition as any).beginAnimation = vi.fn(() => order.push('beginAnimation'));
		new RenderPaintCoordinator(deps, makeState()).flushPaint();

		expect(order).toEqual(['flush', 'beginAnimation']);
	});

	it('wraps orchestrator.flush in a portal release transaction', () => {
		const begin = vi.fn();
		const end = vi.fn();
		let beginCalledBeforeFlush = false;
		const flush = vi.fn(() => {
			beginCalledBeforeFlush = begin.mock.calls.length > 0;
		});
		const deps = makeDeps(
			{},
			{
				engine: {
					stateManager: { getState: () => ({ styleRules: undefined, loading: undefined, defaultColWidth: 100, defaultRowHeight: 40 }) },
					invalidation: { consume: vi.fn(() => ({ reasons: [] })) },
				} as any,
				portalMountManager: { beginCellReleaseTransaction: begin, endCellReleaseTransaction: end } as any,
				orchestrator: { flush } as any,
				scrollCoordinator: { getIsScrolling: () => false },
			}
		);
		const coord = new RenderPaintCoordinator(deps, makeState());

		coord.flushPaint();

		expect(beginCalledBeforeFlush).toBe(true);
		expect(end).toHaveBeenCalled();
		expect(begin.mock.calls.length).toBe(1);
		expect(end.mock.calls.length).toBe(1);
	});
});
