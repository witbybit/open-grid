import { describe, expect, it } from 'vitest';
import { GridEventName } from '../api/GridEvents.js';
import { EventBus } from '../events/EventBus.js';
import { RenderRequestCoordinator } from './RenderRequestCoordinator.js';

describe('RenderRequestCoordinator causal lifetime', () => {
	it('does not leak a headless commit cause into a later mounted render', () => {
		const eventBus = new EventBus();
		const coordinator = new RenderRequestCoordinator(eventBus);
		coordinator.request('headless', 1);
		const observed: readonly number[][] = [];
		eventBus.addEventListener(GridEventName.renderInvalidated, () => {
			(observed as number[][]).push([...coordinator.takeChangeIds()]);
		});
		coordinator.request('mounted', 2);
		expect(observed).toEqual([[2]]);
	});
});
