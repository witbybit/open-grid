import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultGridScheduler } from './gridScheduler.js';
import { DefaultFrameCoordinator } from './frameCoordinator.js';

describe('DefaultGridScheduler', () => {
	let scheduler: DefaultGridScheduler;

	beforeEach(() => {
		scheduler = new DefaultGridScheduler();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('microtask() schedules via queueMicrotask', async () => {
		const cb = vi.fn();
		scheduler.microtask(cb);
		expect(cb).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('raf() falls back to an async setTimeout when requestAnimationFrame is unavailable', () => {
		const originalRaf = globalThis.requestAnimationFrame;
		// @ts-expect-error intentionally removing raf
		delete globalThis.requestAnimationFrame;
		const cb = vi.fn();
		scheduler.raf(cb);
		expect(cb).not.toHaveBeenCalled();
		vi.advanceTimersByTime(16);
		expect(cb).toHaveBeenCalledTimes(1);
		globalThis.requestAnimationFrame = originalRaf;
	});

	it('idle() falls back to raf when requestIdleCallback is unavailable', () => {
		const rafCb = vi.fn();
		vi.spyOn(scheduler, 'raf').mockImplementation((cb) => {
			rafCb();
			cb();
			return 0;
		});

		const idleCb = vi.fn();
		scheduler.idle(idleCb);

		expect(rafCb).toHaveBeenCalledTimes(1);
		expect(idleCb).toHaveBeenCalledTimes(1);
	});

	it('timeout() fires after the specified delay', () => {
		const cb = vi.fn();
		scheduler.timeout(cb, 100);
		expect(cb).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('clearTimeout() cancels the pending timeout', () => {
		const cb = vi.fn();
		const id = scheduler.timeout(cb, 100);
		scheduler.clearTimeout(id);
		vi.advanceTimersByTime(200);
		expect(cb).not.toHaveBeenCalled();
	});

	it('cancelRaf() cancels the setTimeout fallback when requestAnimationFrame is unavailable', () => {
		const originalRaf = globalThis.requestAnimationFrame;
		const originalCancel = globalThis.cancelAnimationFrame;
		// @ts-expect-error intentionally removing raf
		delete globalThis.requestAnimationFrame;
		// @ts-expect-error intentionally removing cancelAnimationFrame
		delete globalThis.cancelAnimationFrame;

		const cb = vi.fn();
		const id = scheduler.raf(cb);
		scheduler.cancelRaf(id);
		vi.advanceTimersByTime(100);
		expect(cb).not.toHaveBeenCalled();

		globalThis.requestAnimationFrame = originalRaf;
		globalThis.cancelAnimationFrame = originalCancel;
	});
});

describe('DefaultFrameCoordinator with GridScheduler', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('multiple requestPaintFrame calls before RAF flush coalesce into one paint', async () => {
		const onPaintFrame = vi.fn();
		const mockScheduler = new DefaultGridScheduler();
		let capturedRaf: (() => void) | null = null;
		vi.spyOn(mockScheduler, 'raf').mockImplementation((cb) => {
			capturedRaf = cb;
			return 0;
		});

		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame,
			onPostScrollWork: vi.fn(),
			gridScheduler: mockScheduler,
		});
		coordinator.requestPaintFrame();
		coordinator.requestPaintFrame();
		coordinator.requestPaintFrame();

		expect(onPaintFrame).not.toHaveBeenCalled();
		// Microtask coalescence: all three requests schedule one microtask batch
		await Promise.resolve();
		capturedRaf?.();
		expect(onPaintFrame).toHaveBeenCalledTimes(1);
	});

	it('does not paint after destroy() when the pending RAF never flushes', () => {
		const onPaintFrame = vi.fn();
		const mockScheduler = new DefaultGridScheduler();
		const capturedRafs: Array<() => void> = [];
		vi.spyOn(mockScheduler, 'raf').mockImplementation((cb) => {
			capturedRafs.push(cb);
			return capturedRafs.length;
		});

		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame,
			onPostScrollWork: vi.fn(),
			gridScheduler: mockScheduler,
		});
		coordinator.requestPaintFrame();
		coordinator.destroy();

		capturedRafs[0]?.();
		expect(onPaintFrame).not.toHaveBeenCalled();
	});

	it('flushNowForTests() calls paint immediately without waiting for RAF', () => {
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame,
			onPostScrollWork: vi.fn(),
		});
		coordinator.flushNowForTests();
		expect(onPaintFrame).toHaveBeenCalledTimes(1);
	});
});
