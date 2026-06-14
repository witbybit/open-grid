// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CellSlot } from './cellSlot.js';

describe('CellSlot transient style reset', () => {
	it('clears stale visibility on hot rebind', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.element.style.visibility = 'hidden';

		slot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 'Alice', 'Alice');

		expect(slot.element.style.visibility).toBe('');
	});

	it('clears stale visibility on hot unbind', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.element.style.visibility = 'hidden';

		slot.unbindHot();

		expect(slot.element.style.visibility).toBe('');
	});
});
