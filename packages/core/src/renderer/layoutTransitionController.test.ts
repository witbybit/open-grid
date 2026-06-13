// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutTransitionController } from './layoutTransitionController.js';

interface FakeSlot {
	element: HTMLElement;
	visualRowId: string;
	lastTop: number;
}

function makeRows(slots: FakeSlot[]): () => ReadonlyMap<number, any> {
	const map = new Map<number, any>();
	slots.forEach((s, i) => map.set(i, s));
	return () => map;
}

function slot(id: string, top: number): FakeSlot {
	const element = document.createElement('div');
	element.style.transform = `translateY(${top}px)`;
	return { element, visualRowId: id, lastTop: top };
}

describe('LayoutTransitionController', () => {
	const originalAnimate = (HTMLElement.prototype as any).animate;

	afterEach(() => {
		(HTMLElement.prototype as any).animate = originalAnimate;
	});

	it('no-ops safely when WAAPI is unavailable (jsdom default)', () => {
		// jsdom does not implement element.animate — controller must apply instantly.
		(HTMLElement.prototype as any).animate = undefined;
		const a = slot('a', 0);
		const c = new LayoutTransitionController(makeRows([a]));
		c.captureSnapshot();
		a.lastTop = 80;
		expect(() => c.beginAnimation()).not.toThrow();
		c.destroy();
	});

	it('animates moved rows from old top to new top via WAAPI', () => {
		const calls: { kf: Keyframe[]; el: HTMLElement }[] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			calls.push({ kf, el: this });
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};

		const a = slot('a', 0);
		const b = slot('b', 40);
		const c = new LayoutTransitionController(makeRows([a, b]));
		c.captureSnapshot(); // a@0, b@40
		// simulate sort: b moves to top, a moves down (recycleViewport wrote new lastTop)
		a.lastTop = 40;
		b.lastTop = 0;
		c.beginAnimation();

		expect(calls).toHaveLength(2);
		const aCall = calls.find((x) => x.el === a.element)!;
		expect(aCall.kf[0].transform).toBe('translateY(0px)'); // from old
		expect(aCall.kf[1].transform).toBe('translateY(40px)'); // to new
		c.destroy();
	});

	it('fades in entering rows but not on a first paint (empty snapshot)', () => {
		const calls: Keyframe[][] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			calls.push(kf);
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};

		// First paint: no snapshot captured → no enter animation for initial rows.
		const a = slot('a', 0);
		const c = new LayoutTransitionController(makeRows([a]));
		c.beginAnimation();
		expect(calls).toHaveLength(0);

		// After a real change: capture (a only), then a new row 'b' appears → it fades in.
		c.captureSnapshot();
		const b = slot('b', 40);
		const rows = makeRows([a, b]);
		(c as any).getActiveRows = rows;
		c.beginAnimation();
		const enter = calls.find((kf) => kf[0].opacity === 0);
		expect(enter).toBeDefined();
		expect(enter![0].transform).toBe('translateY(40px)');
		c.destroy();
	});

	it('cancel() tears down in-flight animations', () => {
		const cancels: Array<() => void> = [];
		(HTMLElement.prototype as any).animate = function () {
			const cancel = vi.fn();
			cancels.push(cancel);
			return { cancel, onfinish: null, oncancel: null } as unknown as Animation;
		};
		const a = slot('a', 0);
		const c = new LayoutTransitionController(makeRows([a]));
		c.captureSnapshot();
		a.lastTop = 80;
		c.beginAnimation();
		c.cancel();
		expect(cancels[0]).toHaveBeenCalled();
		c.destroy();
	});
});
