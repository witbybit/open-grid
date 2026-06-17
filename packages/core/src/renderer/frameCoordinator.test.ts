import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultFrameCoordinator } from './frameCoordinator.js';
import { RenderRuntimeState } from './renderRuntimeState.js';
import type { GridScheduler } from './gridScheduler.js';
import type { FrameCoordinatorDeps } from './frameCoordinator.js';

function makeSyncScheduler(): GridScheduler {
	return {
		microtask: (cb) => cb(),
		raf: (cb) => {
			cb();
			return 0;
		},
		cancelRaf: vi.fn(),
		idle: (cb) => {
			cb();
			return 0;
		},
		cancelIdle: vi.fn(),
		timeout: (cb, ms) => setTimeout(cb, ms),
		clearTimeout: (id) => clearTimeout(id),
	};
}

function makeBaseDeps(overrides: Partial<FrameCoordinatorDeps> = {}): FrameCoordinatorDeps {
	return {
		onScrollFrame: vi.fn(),
		onPaintFrame: vi.fn(),
		onPostScrollWork: vi.fn(),
		gridScheduler: makeSyncScheduler(),
		...overrides,
	};
}

describe('DefaultFrameCoordinator', () => {
	it('requestScrollFrame() triggers the onScrollFrame callback', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onScrollFrame, onPaintFrame }));

		coordinator.requestScrollFrame();

		expect(onScrollFrame).toHaveBeenCalledTimes(1);
		expect(onPaintFrame).not.toHaveBeenCalled();
	});

	it('requestPaintFrame() triggers the onPaintFrame callback', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onScrollFrame, onPaintFrame }));

		coordinator.requestPaintFrame();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
		expect(onScrollFrame).not.toHaveBeenCalled();
	});

	it('requestPostScrollWork() triggers the onPostScrollWork callback (not onPaintFrame)', () => {
		const onPaintFrame = vi.fn();
		const onPostScrollWork = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, onPostScrollWork }));

		coordinator.requestPostScrollWork();

		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
		expect(onPaintFrame).not.toHaveBeenCalled();
	});

	it('flushNowForTests() invokes paint synchronously without scheduling', () => {
		const raf = vi.fn((cb: () => void) => {
			cb();
			return 0;
		});
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, gridScheduler: { ...makeSyncScheduler(), raf } }));

		coordinator.flushNowForTests();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
		expect(raf).not.toHaveBeenCalled();
	});

	it('duplicate requestScrollFrame() calls are coalesced to one callback', () => {
		const onScrollFrame = vi.fn();
		let captured: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				captured = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onScrollFrame, gridScheduler: gs }));

		coordinator.requestScrollFrame();
		coordinator.requestScrollFrame();
		captured?.();

		expect(onScrollFrame).toHaveBeenCalledTimes(1);
	});

	it('duplicate requestPaintFrame() calls are coalesced to one callback', () => {
		const onPaintFrame = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, gridScheduler: gs }));

		coordinator.requestPaintFrame();
		coordinator.requestPaintFrame();
		capturedRaf?.();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
	});

	it('duplicate requestPostScrollWork() calls are coalesced to one callback', () => {
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, gridScheduler: gs }));

		coordinator.requestPostScrollWork();
		coordinator.requestPostScrollWork();
		capturedRaf?.();

		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
	});

	it('destroy() prevents further scheduling', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const onPostScrollWork = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onScrollFrame, onPaintFrame, onPostScrollWork }));

		coordinator.destroy();
		coordinator.requestScrollFrame();
		coordinator.requestPaintFrame();
		coordinator.requestPostScrollWork();

		expect(onScrollFrame).not.toHaveBeenCalled();
		expect(onPaintFrame).not.toHaveBeenCalled();
		expect(onPostScrollWork).not.toHaveBeenCalled();
	});

	it('destroy() cancels pending RAF handles for scroll and post-scroll', () => {
		const cancelRaf = vi.fn();
		let lastRafId = 0;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (_cb) => { /* intentionally do not fire — simulates async microtask */ },
			raf: (_cb) => ++lastRafId,
			cancelRaf,
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ gridScheduler: gs }));

		coordinator.requestScrollFrame();   // RAF scheduled immediately
		coordinator.requestPostScrollWork(); // RAF scheduled immediately
		coordinator.destroy();

		// Scroll and post-scroll RAFs are cancelled; paint RAF never scheduled (microtask pending).
		expect(cancelRaf).toHaveBeenCalledTimes(2);
	});

	it('destroy() cancels paint RAF when it was already scheduled past the microtask', () => {
		const cancelRaf = vi.fn();
		let lastRafId = 0;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(), // fires synchronously so RAF is scheduled
			raf: (_cb) => ++lastRafId,
			cancelRaf,
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ gridScheduler: gs }));

		coordinator.requestPaintFrame(); // microtask fires → RAF scheduled
		coordinator.destroy();

		expect(cancelRaf).toHaveBeenCalledWith(lastRafId);
	});

	it('reports a fault and skips the frame when a reentrant scroll frame is detected', () => {
		const onFault = vi.fn();
		let capturedScrollRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedScrollRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onScrollFrame: () => {
					coordinator.requestScrollFrame();
					capturedScrollRaf?.();
				},
				gridScheduler: gs,
				onFault,
			})
		);

		coordinator.requestScrollFrame();
		capturedScrollRaf?.();

		expect(onFault).toHaveBeenCalledWith(expect.stringContaining('reentrant scroll frame'));
	});

	it('reports a fault and skips the frame when a reentrant paint frame is detected (no runtimeState)', () => {
		const onFault = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					capturedRaf?.();
				},
				gridScheduler: gs,
				onFault,
			})
		);

		coordinator.requestPaintFrame();
		capturedRaf?.();

		expect(onFault).toHaveBeenCalledWith(expect.stringContaining('reentrant paint frame'));
	});
});

describe('DefaultFrameCoordinator – post-scroll epoch semantics (Plan 080)', () => {
	it('post-scroll work fires when scroll epoch matches', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, runtimeState: rs }));

		coordinator.requestPostScrollWork();

		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
	});

	it('post-scroll work is dropped when scroll epoch has advanced', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, gridScheduler: gs, runtimeState: rs }));

		coordinator.requestPostScrollWork();
		// Simulate new scroll session starting before the RAF fires (advances scrollEpoch).
		rs.transitionTo('scroll-pending');
		rs.transitionTo('idle');
		capturedRaf?.();

		expect(onPostScrollWork).not.toHaveBeenCalled();
	});

	it('post-scroll work is dropped when scroll is still active when RAF fires', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, gridScheduler: gs, runtimeState: rs }));

		coordinator.requestPostScrollWork();
		rs.transitionTo('scroll-pending');
		capturedRaf?.();

		expect(onPostScrollWork).not.toHaveBeenCalled();
	});

	it('post-scroll work does not alias requestPaintFrame scheduling', () => {
		const onPaintFrame = vi.fn();
		const onPostScrollWork = vi.fn();
		let rafCount = 0;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				rafCount++;
				cb();
				return rafCount;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, onPostScrollWork, gridScheduler: gs }));

		coordinator.requestPaintFrame();
		coordinator.requestPostScrollWork();

		// Each type scheduled its own RAF independently.
		expect(rafCount).toBe(2);
		expect(onPaintFrame).toHaveBeenCalledTimes(1);
		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
	});
});

describe('DefaultFrameCoordinator – runtime state integration (Plan 079)', () => {
	it('transitions to paint-frame before invoking the callback', () => {
		const rs = new RenderRuntimeState();
		let phaseInsidePaint: string | null = null;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					phaseInsidePaint = rs.phase;
				},
				runtimeState: rs,
			})
		);

		coordinator.requestPaintFrame();

		expect(phaseInsidePaint).toBe('paint-frame');
	});

	it('returns to idle after a successful paint', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ runtimeState: rs }));

		coordinator.requestPaintFrame();

		expect(rs.phase).toBe('idle');
	});

	it('returns to idle after a paint that throws', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					throw new Error('paint failure');
				},
				runtimeState: rs,
			})
		);

		expect(() => coordinator.requestPaintFrame()).toThrow('paint failure');
		expect(rs.phase).toBe('idle');
	});

	it('increments frameEpoch for every paint frame', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ runtimeState: rs }));

		expect(rs.frameEpoch).toBe(0);
		coordinator.requestPaintFrame();
		expect(rs.frameEpoch).toBe(1);
		coordinator.requestPaintFrame();
		expect(rs.frameEpoch).toBe(2);
	});

	it('isFrameActive() is true inside the paint callback', () => {
		const rs = new RenderRuntimeState();
		let frameActiveInsidePaint = false;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					frameActiveInsidePaint = rs.isFrameActive();
				},
				runtimeState: rs,
			})
		);

		coordinator.requestPaintFrame();

		expect(frameActiveInsidePaint).toBe(true);
	});

	it('canRunDecoration() is false inside the paint callback', () => {
		const rs = new RenderRuntimeState();
		let decorationAllowedInsidePaint = true;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					decorationAllowedInsidePaint = rs.canRunDecoration();
				},
				runtimeState: rs,
			})
		);

		coordinator.requestPaintFrame();

		expect(decorationAllowedInsidePaint).toBe(false);
	});

	it('flushNowForTests() also transitions through paint-frame', () => {
		const rs = new RenderRuntimeState();
		let phaseInsidePaint: string | null = null;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					phaseInsidePaint = rs.phase;
				},
				runtimeState: rs,
			})
		);

		coordinator.flushNowForTests();

		expect(phaseInsidePaint).toBe('paint-frame');
		expect(rs.phase).toBe('idle');
	});

	it('reports a fault and skips execution when paint is attempted after destruction', () => {
		const onFault = vi.fn();
		const rs = new RenderRuntimeState();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, onFault, runtimeState: rs }));

		rs.transitionTo('destroyed');
		coordinator.flushNowForTests();

		expect(onFault).toHaveBeenCalledWith(expect.stringContaining('paint frame after destruction'));
		expect(onPaintFrame).not.toHaveBeenCalled();
	});
});
