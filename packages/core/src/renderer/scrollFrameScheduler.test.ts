import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScrollFrameScheduler } from './scrollFrameScheduler.js';

describe('ScrollFrameScheduler', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('coalesces repeated scroll requests into one direct animation frame', () => {
		const callbacks: FrameRequestCallback[] = [];
		const flush = vi.fn();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});

		const scheduler = new ScrollFrameScheduler(flush);
		scheduler.requestFrame();
		scheduler.requestFrame();
		scheduler.requestFrame();

		expect(callbacks).toHaveLength(1);
		expect(flush).not.toHaveBeenCalled();

		callbacks[0](0);
		expect(flush).toHaveBeenCalledTimes(1);
	});
});
