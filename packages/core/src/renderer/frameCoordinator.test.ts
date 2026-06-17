import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultFrameCoordinator } from './frameCoordinator.js';
import { RenderRuntimeState } from './renderRuntimeState.js';
import type { GridScheduler } from './gridScheduler.js';

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

describe('DefaultFrameCoordinator', () => {
	it('requestScrollFrame() triggers the onScrollFrame callback', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame,
			onPaintFrame,
			gridScheduler: makeSyncScheduler(),
		});

		coordinator.requestScrollFrame();

		expect(onScrollFrame).toHaveBeenCalledTimes(1);
		expect(onPaintFrame).not.toHaveBeenCalled();
	});

	it('requestPaintFrame() triggers the onPaintFrame callback', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame,
			onPaintFrame,
			gridScheduler: makeSyncScheduler(),
		});

		coordinator.requestPaintFrame();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
		expect(onScrollFrame).not.toHaveBeenCalled();
	});

	it('requestPostScrollWork() triggers the onPaintFrame callback', () => {
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame,
			gridScheduler: makeSyncScheduler(),
		});

		coordinator.requestPostScrollWork();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
	});

	it('flushNowForTests() invokes paint synchronously without scheduling', () => {
		const raf = vi.fn((cb: () => void) => {
			cb();
			return 0;
		});
		const onPaintFrame = vi.fn();
		const gs: GridScheduler = { ...makeSyncScheduler(), raf };
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame,
			gridScheduler: gs,
		});

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
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame,
			onPaintFrame: vi.fn(),
			gridScheduler: gs,
		});

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
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame,
			gridScheduler: gs,
		});

		coordinator.requestPaintFrame();
		coordinator.requestPaintFrame();
		capturedRaf?.();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
	});

	it('destroy() prevents further scheduling', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame,
			onPaintFrame,
			gridScheduler: makeSyncScheduler(),
		});

		coordinator.destroy();
		coordinator.requestScrollFrame();
		coordinator.requestPaintFrame();
		coordinator.requestPostScrollWork();

		expect(onScrollFrame).not.toHaveBeenCalled();
		expect(onPaintFrame).not.toHaveBeenCalled();
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
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: () => {
				// Try to request another scroll frame from inside the scroll callback
				coordinator.requestScrollFrame();
				// Manually fire the inner RAF immediately to simulate reentrancy
				capturedScrollRaf?.();
			},
			onPaintFrame: vi.fn(),
			gridScheduler: gs,
			onFault,
		});

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
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: () => {
				// Simulate reentrancy: fire a stale inner RAF from inside the paint callback
				capturedRaf?.();
			},
			gridScheduler: gs,
			onFault,
		});

		coordinator.requestPaintFrame();
		capturedRaf?.();

		expect(onFault).toHaveBeenCalledWith(expect.stringContaining('reentrant paint frame'));
	});
});

describe('DefaultFrameCoordinator – runtime state integration (Plan 079)', () => {
	it('transitions to paint-frame before invoking the callback', () => {
		const rs = new RenderRuntimeState();
		let phaseInsidePaint: string | null = null;
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: () => {
				phaseInsidePaint = rs.phase;
			},
			gridScheduler: makeSyncScheduler(),
			runtimeState: rs,
		});

		coordinator.requestPaintFrame();

		expect(phaseInsidePaint).toBe('paint-frame');
	});

	it('returns to idle after a successful paint', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: vi.fn(),
			gridScheduler: makeSyncScheduler(),
			runtimeState: rs,
		});

		coordinator.requestPaintFrame();

		expect(rs.phase).toBe('idle');
	});

	it('returns to idle after a paint that throws', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: () => {
				throw new Error('paint failure');
			},
			gridScheduler: makeSyncScheduler(),
			runtimeState: rs,
		});

		expect(() => coordinator.requestPaintFrame()).toThrow('paint failure');
		expect(rs.phase).toBe('idle');
	});

	it('increments frameEpoch for every paint frame', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: vi.fn(),
			gridScheduler: makeSyncScheduler(),
			runtimeState: rs,
		});

		expect(rs.frameEpoch).toBe(0);
		coordinator.requestPaintFrame();
		expect(rs.frameEpoch).toBe(1);
		coordinator.requestPaintFrame();
		expect(rs.frameEpoch).toBe(2);
	});

	it('isFrameActive() is true inside the paint callback', () => {
		const rs = new RenderRuntimeState();
		let frameActiveInsidePaint = false;
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: () => {
				frameActiveInsidePaint = rs.isFrameActive();
			},
			gridScheduler: makeSyncScheduler(),
			runtimeState: rs,
		});

		coordinator.requestPaintFrame();

		expect(frameActiveInsidePaint).toBe(true);
	});

	it('canRunDecoration() is false inside the paint callback', () => {
		const rs = new RenderRuntimeState();
		let decorationAllowedInsidePaint = true;
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: () => {
				decorationAllowedInsidePaint = rs.canRunDecoration();
			},
			gridScheduler: makeSyncScheduler(),
			runtimeState: rs,
		});

		coordinator.requestPaintFrame();

		expect(decorationAllowedInsidePaint).toBe(false);
	});

	it('flushNowForTests() also transitions through paint-frame', () => {
		const rs = new RenderRuntimeState();
		let phaseInsidePaint: string | null = null;
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: () => {
				phaseInsidePaint = rs.phase;
			},
			gridScheduler: makeSyncScheduler(),
			runtimeState: rs,
		});

		coordinator.flushNowForTests();

		expect(phaseInsidePaint).toBe('paint-frame');
		expect(rs.phase).toBe('idle');
	});

	it('reports a fault and skips execution when paint is attempted after destruction', () => {
		const onFault = vi.fn();
		const rs = new RenderRuntimeState();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame,
			gridScheduler: makeSyncScheduler(),
			onFault,
			runtimeState: rs,
		});

		rs.transitionTo('destroyed');
		coordinator.flushNowForTests();

		expect(onFault).toHaveBeenCalledWith(expect.stringContaining('paint frame after destruction'));
		expect(onPaintFrame).not.toHaveBeenCalled();
	});
});
