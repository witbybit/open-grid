import { afterEach, describe, expect, it, vi } from 'vitest';

import { RenderScheduler } from './renderScheduler.js';

describe('RenderScheduler', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('coalesces multiple requests into one flush', async () => {
		const flush = vi.fn();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const scheduler = new RenderScheduler(flush);

		scheduler.requestFlush('a');
		scheduler.requestFlush('b');
		await Promise.resolve();

		expect(flush).toHaveBeenCalledTimes(1);
	});

	it('does not flush after destroy', async () => {
		const flush = vi.fn();
		const scheduler = new RenderScheduler(flush);

		scheduler.requestFlush('a');
		scheduler.destroy();
		await Promise.resolve();

		expect(flush).not.toHaveBeenCalled();
	});
});
