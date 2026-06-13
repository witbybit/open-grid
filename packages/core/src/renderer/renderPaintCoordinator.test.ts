import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RenderPaintCoordinator, type RenderPaintCoordinatorDeps, type RenderPaintCoordinatorState } from './renderPaintCoordinator.js';

const SENTINEL_A = { tag: 'A' };
const SENTINEL_B = { tag: 'B' };

function makeState(overrides?: Partial<RenderPaintCoordinatorState>): RenderPaintCoordinatorState {
	return {
		pendingSortAnimation: false,
		lastStyleSlots: undefined,
		lastLoading: undefined,
		...overrides,
	};
}

interface FakeGridState {
	styleSlots: unknown;
	loading: unknown;
	defaultColWidth: number;
	defaultRowHeight: number;
}

function makeDeps(
	gridState: Partial<FakeGridState> = {},
	overrides: Partial<RenderPaintCoordinatorDeps<unknown>> = {}
): RenderPaintCoordinatorDeps<unknown> {
	const state: FakeGridState = {
		styleSlots: undefined,
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
		rowRenderer: { styleVersion: 0, loadingVersion: 0 } as any,
		headerRenderer: { repaintHeaders: vi.fn() } as any,
		overlayRenderer: { repaintOverlay: vi.fn() } as any,
		stickyGroupRenderer: { sync: vi.fn() } as any,
		portalMountManager: {
			beginCellReleaseTransaction: vi.fn(),
			endCellReleaseTransaction: vi.fn(),
		} as any,
		orchestrator: { flush: vi.fn() } as any,
		scrollCoordinator: { getIsScrolling: () => false },
		sortAnimation: { beginAnimation: vi.fn() } as any,
		recycleViewport: vi.fn(),
		syncLayoutPlan: vi.fn(() => ({ renderWindow: {} })) as any,
		updateCachedGeometryBoundsFromState: vi.fn(),
		...overrides,
	};
}

// ─── refreshRendererEpochs ────────────────────────────────────────────────────

describe('RenderPaintCoordinator – refreshRendererEpochs', () => {
	it('increments styleVersion when styleSlots reference changes', () => {
		const deps = makeDeps({ styleSlots: SENTINEL_A });
		const state = makeState({ lastStyleSlots: undefined });
		const coord = new RenderPaintCoordinator(deps, state);

		coord.refreshRendererEpochs();

		expect((deps.rowRenderer as any).styleVersion).toBe(1);
		expect(state.lastStyleSlots).toBe(SENTINEL_A);
	});

	it('does NOT increment styleVersion when styleSlots is unchanged', () => {
		const deps = makeDeps({ styleSlots: SENTINEL_A });
		const state = makeState({ lastStyleSlots: SENTINEL_A });
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
		const deps = makeDeps({ styleSlots: SENTINEL_B, loading: false });
		const state = makeState({ lastStyleSlots: SENTINEL_A, lastLoading: true });
		const coord = new RenderPaintCoordinator(deps, state);

		coord.refreshRendererEpochs();

		expect((deps.rowRenderer as any).styleVersion).toBe(1);
		expect((deps.rowRenderer as any).loadingVersion).toBe(1);
	});
});

// ─── flushPaint – sort animation gate ────────────────────────────────────────

describe('RenderPaintCoordinator – flushPaint sort animation gate', () => {
	it('sets pendingSortAnimation when a sort frame arrives while not scrolling', () => {
		const deps = makeDeps(
			{},
			{
				engine: {
					stateManager: { getState: () => ({ styleSlots: undefined, loading: undefined, defaultColWidth: 100, defaultRowHeight: 40 }) },
					invalidation: { consume: vi.fn(() => ({ reasons: ['sort'] })) },
				} as any,
				scrollCoordinator: { getIsScrolling: () => false },
			}
		);
		const state = makeState();
		const coord = new RenderPaintCoordinator(deps, state);

		coord.flushPaint();

		expect(state.pendingSortAnimation).toBe(true);
	});

	it('does NOT set pendingSortAnimation when a sort frame arrives while scrolling', () => {
		const deps = makeDeps(
			{},
			{
				engine: {
					stateManager: { getState: () => ({ styleSlots: undefined, loading: undefined, defaultColWidth: 100, defaultRowHeight: 40 }) },
					invalidation: { consume: vi.fn(() => ({ reasons: ['sort'] })) },
				} as any,
				scrollCoordinator: { getIsScrolling: () => true },
			}
		);
		const state = makeState();
		const coord = new RenderPaintCoordinator(deps, state);

		coord.flushPaint();

		expect(state.pendingSortAnimation).toBe(false);
	});

	it('does NOT set pendingSortAnimation for non-sort frames', () => {
		const deps = makeDeps(
			{},
			{
				engine: {
					stateManager: { getState: () => ({ styleSlots: undefined, loading: undefined, defaultColWidth: 100, defaultRowHeight: 40 }) },
					invalidation: { consume: vi.fn(() => ({ reasons: ['filter'] })) },
				} as any,
				scrollCoordinator: { getIsScrolling: () => false },
			}
		);
		const state = makeState();
		const coord = new RenderPaintCoordinator(deps, state);

		coord.flushPaint();

		expect(state.pendingSortAnimation).toBe(false);
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
					stateManager: { getState: () => ({ styleSlots: undefined, loading: undefined, defaultColWidth: 100, defaultRowHeight: 40 }) },
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
