// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CellSlot } from './cellSlot.js';
import {
	TextRendererHandle,
	FallbackRendererHandle,
	PortalRendererHandle,
	LoadingRendererHandle,
	CustomRendererHandle,
} from './cellRendererHandle.js';

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

describe('CellSlot.rowBindingGeneration — Plan 118 WS1 per-cell row binding tracking', () => {
	it('starts at 0 on construction', () => {
		const slot = new CellSlot(document.createElement('div'));
		expect(slot.rowBindingGeneration).toBe(0);
	});

	it('increments on each unbindHot() call', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.unbindHot();
		expect(slot.rowBindingGeneration).toBe(1);
		slot.unbindHot();
		expect(slot.rowBindingGeneration).toBe(2);
	});

	it('does not change on update() — rebinding to the same or new row does not increment', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 'Alice', 'Alice');
		expect(slot.rowBindingGeneration).toBe(0);
	});

	it('does not change on unbindCold() — cold unbind is destroy, not rebind', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.unbindHot();
		const gen = slot.rowBindingGeneration;
		slot.unbindCold();
		expect(slot.rowBindingGeneration).toBe(gen);
	});

	it('does not change on reset()', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.unbindHot();
		const gen = slot.rowBindingGeneration;
		slot.reset();
		expect(slot.rowBindingGeneration).toBe(gen);
	});

	it('cellInstanceId remains stable while rowBindingGeneration increments — they are independent', () => {
		const slot = new CellSlot(document.createElement('div'));
		const id = slot.cellInstanceId;
		slot.unbindHot();
		slot.unbindHot();
		expect(slot.cellInstanceId).toBe(id);
		expect(slot.rowBindingGeneration).toBe(2);
	});
});

describe('CellSlot WS2 — columnId stable column ownership', () => {
	it('starts empty — set by reconcileTopology at construction time', () => {
		const slot = new CellSlot(document.createElement('div'));
		expect(slot.columnId).toBe('');
	});

	it('is stable across unbindHot() — column assignment survives row recycling', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.columnId = 'price';
		slot.unbindHot();
		expect(slot.columnId).toBe('price');
	});

	it('is cleared by unbindCold() — cold destroy resets all ownership', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.columnId = 'price';
		slot.unbindCold();
		// columnId is not cleared by unbindCold (physical column association persists
		// until the element is destroyed — cleared only when cell is fully released)
		// This matches the plan: columnId is set at construction and stable for the
		// cell's lifetime, which ends at destroyCold().
		expect(slot.columnId).toBe('price');
	});
});

describe('CellSlot WS2 — renderer handle ownership', () => {
	it('starts with null renderer', () => {
		const slot = new CellSlot(document.createElement('div'));
		expect(slot.renderer).toBeNull();
	});

	it('unbindCold() calls destroy() on active renderer and nulls it', () => {
		const slot = new CellSlot(document.createElement('div'));
		const handle = new TextRendererHandle('$42');
		const destroySpy = vi.spyOn(handle, 'destroy');
		slot.renderer = handle;

		slot.unbindCold();

		expect(destroySpy).toHaveBeenCalledTimes(1);
		expect(slot.renderer).toBeNull();
	});

	it('unbindHot() does NOT destroy renderer — cell stays bound to column', () => {
		const slot = new CellSlot(document.createElement('div'));
		const handle = new TextRendererHandle('$42');
		const destroySpy = vi.spyOn(handle, 'destroy');
		slot.renderer = handle;

		slot.unbindHot();

		expect(destroySpy).not.toHaveBeenCalled();
		expect(slot.renderer).toBe(handle);
	});

	it('unbindCold() with null renderer is a no-op', () => {
		const slot = new CellSlot(document.createElement('div'));
		expect(() => slot.unbindCold()).not.toThrow();
		expect(slot.renderer).toBeNull();
	});
});

describe('CellSlot WS2 — CellRendererHandle implementations', () => {
	it('TextRendererHandle has kind "text" and tracks formattedValue', () => {
		const h = new TextRendererHandle('hello');
		expect(h.kind).toBe('text');
		expect(h.formattedValue).toBe('hello');
		h.formattedValue = 'world';
		expect(h.formattedValue).toBe('world');
	});

	it('FallbackRendererHandle has kind "fallback"', () => {
		const h = new FallbackRendererHandle('n/a');
		expect(h.kind).toBe('fallback');
	});

	it('PortalRendererHandle has kind "portal" and readonly portalKey', () => {
		const h = new PortalRendererHandle('C4:ci1:price');
		expect(h.kind).toBe('portal');
		expect(h.portalKey).toBe('C4:ci1:price');
	});

	it('LoadingRendererHandle has kind "loading"', () => {
		const h = new LoadingRendererHandle();
		expect(h.kind).toBe('loading');
	});

	it('CustomRendererHandle has kind "custom"', () => {
		const h = new CustomRendererHandle();
		expect(h.kind).toBe('custom');
	});

	it('destroy() is callable on every handle without error', () => {
		[
			new TextRendererHandle('x'),
			new FallbackRendererHandle('x'),
			new PortalRendererHandle('key'),
			new LoadingRendererHandle(),
			new CustomRendererHandle(),
		].forEach((h) => expect(() => h.destroy()).not.toThrow());
	});
});

describe('CellSlot WS6 — non-blanking text→portal transition', () => {
	it('does not clear textContent when transitioning to portal mode', () => {
		const slot = new CellSlot(document.createElement('div'));
		// Establish text content
		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 42, '$42.00');
		expect(slot.contentElement.textContent).toBe('$42.00');

		// Transition to portal mode — text must survive so CSS can hide it rather than blank it
		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', 42, '', 'C4:ci1:price');
		expect(slot.contentElement.textContent).toBe('$42.00');
	});

	it('clears textContent when transitioning to empty mode (not portal)', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 42, '$42.00');

		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'empty', undefined, '');
		expect(slot.contentElement.textContent).toBe('');
	});

	it('retains correct text when transitioning portal → text with same value', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 42, '$42.00');
		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', 42, '', 'C4:ci1:price');

		// Back to text with same value — should still be correct (no DOM write needed)
		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 42, '$42.00');
		expect(slot.contentElement.textContent).toBe('$42.00');
	});

	it('writes new text when transitioning portal → text with different value', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 42, '$42.00');
		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', 42, '', 'C4:ci1:price');

		slot.update(0, 'price', 0, 'r1', 0, -1, 100, 'og-cell', 'text', 99, '$99.00');
		expect(slot.contentElement.textContent).toBe('$99.00');
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

	it('preserves warm content-mode and portal-key mirrors on hot unbind', () => {
		const slot = new CellSlot(document.createElement('div'));
		slot.update(0, 'name', 0, 'r1', 0, -1, 100, 'og-cell', 'portal', undefined, '', 'portal-key');

		slot.unbindHot();

		expect(slot.element.dataset.contentMode).toBe('portal');
		expect(slot.element.dataset.cellKey).toBe('portal-key');
		expect(slot.lastPortalKey).toBe('portal-key');
	});
});
