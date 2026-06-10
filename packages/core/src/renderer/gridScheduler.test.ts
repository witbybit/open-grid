import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultGridScheduler } from './gridScheduler.js';
import { RenderScheduler } from './renderScheduler.js';

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
		await Promise.resolve(); // drain microtask queue
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('raf() falls back to an async setTimeout when requestAnimationFrame is unavailable', () => {
		const originalRaf = globalThis.requestAnimationFrame;
		// @ts-expect-error intentionally removing raf
		delete globalThis.requestAnimationFrame;
		const cb = vi.fn();
		scheduler.raf(cb);
		// Must NOT fire synchronously — a synchronous fallback breaks render batching.
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

		// In the Node test environment window.requestIdleCallback doesn't exist —
		// the scheduler must fall through to raf().
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

describe('RenderScheduler with GridScheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('multiple requestFlush calls before microtask drains coalesce into one flush', async () => {
		const flush = vi.fn();
		const mockScheduler = new DefaultGridScheduler();
		vi.spyOn(mockScheduler, 'raf').mockImplementation((cb) => {
			cb();
			return 0;
		});

		const rs = new RenderScheduler(flush, mockScheduler);
		rs.requestFlush();
		rs.requestFlush();
		rs.requestFlush();

		await Promise.resolve(); // drain microtask
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it('does not flush after destroy()', async () => {
		const flush = vi.fn();
		const mockScheduler = new DefaultGridScheduler();
		vi.spyOn(mockScheduler, 'raf').mockImplementation((cb) => {
			cb();
			return 0;
		});

		const rs = new RenderScheduler(flush, mockScheduler);
		rs.requestFlush();
		rs.destroy();

		await Promise.resolve();
		expect(flush).not.toHaveBeenCalled();
	});

	it('flushNow() calls flush immediately without waiting for RAF', () => {
		const flush = vi.fn();
		const rs = new RenderScheduler(flush);
		rs.flushNow();
		expect(flush).toHaveBeenCalledTimes(1);
	});
});
