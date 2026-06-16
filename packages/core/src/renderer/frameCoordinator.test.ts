import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultFrameCoordinator } from './frameCoordinator.js';
import type { GridScheduler } from './gridScheduler.js';

function makeSyncScheduler(): GridScheduler {
	return {
		microtask: (cb) => cb(),
		raf: (cb) => { cb(); return 0; },
		cancelRaf: vi.fn(),
		idle: (cb) => { cb(); return 0; },
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
		const raf = vi.fn((cb: () => void) => { cb(); return 0; });
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
			raf: (cb) => { captured = cb; return 0; },
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
			raf: (cb) => { capturedRaf = cb; return 0; },
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
});
