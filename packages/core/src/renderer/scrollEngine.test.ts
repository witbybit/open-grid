// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ScrollEngine } from './scrollEngine.js';
import { GridEngine } from '../engine/GridEngine.js';

describe('ScrollEngine', () => {
	it('should capture passive scroll events and compute velocities', () => {
		const engine = new GridEngine({ columns: [] });
		const scrollEngine = new ScrollEngine(engine);
		const container = document.createElement('div');
		container.style.width = '100px';
		container.style.height = '100px';

		const onScrollMock = vi.fn();

		// Mock high-resolution time before binding
		let time = 1000;
		const originalNow = performance.now;
		performance.now = () => time;

		// Bind to mock element
		scrollEngine.bind(container, onScrollMock);

		try {
			// Simulate first scroll event
			container.scrollTop = 10;
			container.scrollLeft = 5;
			time = 1010; // 10ms later

			// Dispatch scroll event
			container.dispatchEvent(new Event('scroll'));

			expect(onScrollMock).toHaveBeenCalledWith(10, 5, 1010);

			// Velocity calculations:
			// scrollTop went 0 -> 10 over 10ms => 1.0 px/ms
			// scrollLeft went 0 -> 5 over 10ms => 0.5 px/ms
			const velocity = scrollEngine.getVelocity();
			expect(velocity.vy).toBeCloseTo(1.0);
			expect(velocity.vx).toBeCloseTo(0.5);

			// Simulate next scroll event
			container.scrollTop = 30;
			container.scrollLeft = 5;
			time = 1020; // 10ms later
			container.dispatchEvent(new Event('scroll'));

			expect(onScrollMock).toHaveBeenLastCalledWith(30, 5, 1020);
			const velocity2 = scrollEngine.getVelocity();
			expect(velocity2.vy).toBeCloseTo(2.0); // 20px / 10ms
			expect(velocity2.vx).toBeCloseTo(0.0); // 0px change
		} finally {
			performance.now = originalNow;
			scrollEngine.unbind();
		}
	});

	it('should scroll programmatically and reset tracking counters', () => {
		const engine = new GridEngine({ columns: [] });
		const scrollEngine = new ScrollEngine(engine);
		const container = document.createElement('div');

		scrollEngine.bind(container, vi.fn());

		scrollEngine.scrollTo(50, 100);
		expect(container.scrollTop).toBe(50);
		expect(container.scrollLeft).toBe(100);

		const velocity = scrollEngine.getVelocity();
		expect(velocity.vy).toBe(0);
		expect(velocity.vx).toBe(0);

		scrollEngine.unbind();
	});
});
