// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CellSlot } from './cellSlot.js';

describe('CellSlot.cellInstanceId — Plan 118 physical identity', () => {
	it('is assigned at construction and is a non-empty string', () => {
		const slot = new CellSlot(document.createElement('div'));
		expect(typeof slot.cellInstanceId).toBe('string');
		expect(slot.cellInstanceId.length).toBeGreaterThan(0);
	});

	it('is unique across distinct CellSlot instances', () => {
		const a = new CellSlot(document.createElement('div'));
		const b = new CellSlot(document.createElement('div'));
		expect(a.cellInstanceId).not.toBe(b.cellInstanceId);
	});

	it('is stable across update() calls', () => {
		const slot = new CellSlot(document.createElement('div'));
		const id = slot.cellInstanceId;
		slot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 'Alice', 'Alice');
		expect(slot.cellInstanceId).toBe(id);
	});

	it('is stable across unbindHot()', () => {
		const slot = new CellSlot(document.createElement('div'));
		const id = slot.cellInstanceId;
		slot.unbindHot();
		expect(slot.cellInstanceId).toBe(id);
	});

	it('is stable across unbindCold()', () => {
		const slot = new CellSlot(document.createElement('div'));
		const id = slot.cellInstanceId;
		slot.unbindCold();
		expect(slot.cellInstanceId).toBe(id);
	});

	it('is stable across reset()', () => {
		const slot = new CellSlot(document.createElement('div'));
		const id = slot.cellInstanceId;
		slot.reset();
		expect(slot.cellInstanceId).toBe(id);
	});

	it('fromElement() returns the same cellInstanceId for the same element', () => {
		const el = document.createElement('div');
		const first = CellSlot.fromElement(el);
		const second = CellSlot.fromElement(el);
		expect(first.cellInstanceId).toBe(second.cellInstanceId);
	});

	it('fromElement() on a fresh element produces a new cellInstanceId', () => {
		const a = CellSlot.fromElement(document.createElement('div'));
		const b = CellSlot.fromElement(document.createElement('div'));
		expect(a.cellInstanceId).not.toBe(b.cellInstanceId);
	});
});

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
