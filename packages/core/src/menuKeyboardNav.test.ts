// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachRovingMenuKeyboard } from './menuKeyboardNav.js';

function buildMenu(itemCount: number) {
	const container = document.createElement('div');
	const items: HTMLElement[] = [];
	for (let i = 0; i < itemCount; i++) {
		const el = document.createElement('div');
		el.textContent = `Item ${i}`;
		container.appendChild(el);
		items.push(el);
	}
	document.body.appendChild(container);
	return { container, items };
}

function press(container: HTMLElement, key: string): KeyboardEvent {
	const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	(document.activeElement ?? container).dispatchEvent(ev);
	return ev;
}

describe('attachRovingMenuKeyboard', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
	});

	it('auto-focuses the first item and marks it active', () => {
		const { container, items } = buildMenu(3);
		attachRovingMenuKeyboard({ container, items, activeClass: 'on', onActivate: vi.fn(), onClose: vi.fn() });

		expect(items[0].classList.contains('on')).toBe(true);
		expect(items[0].tabIndex).toBe(0);
		expect(document.activeElement).toBe(items[0]);
		expect(items[1].tabIndex).toBe(-1);
	});

	it('ArrowDown moves to the next item and wraps at the end', () => {
		const { container, items } = buildMenu(3);
		attachRovingMenuKeyboard({ container, items, activeClass: 'on', onActivate: vi.fn(), onClose: vi.fn() });

		press(container, 'ArrowDown');
		expect(items[1].classList.contains('on')).toBe(true);
		expect(items[0].classList.contains('on')).toBe(false);
		expect(document.activeElement).toBe(items[1]);

		press(container, 'ArrowDown'); // -> 2
		press(container, 'ArrowDown'); // wrap -> 0
		expect(items[0].classList.contains('on')).toBe(true);
		expect(document.activeElement).toBe(items[0]);
	});

	it('ArrowUp from the first item wraps to the last', () => {
		const { container, items } = buildMenu(3);
		attachRovingMenuKeyboard({ container, items, activeClass: 'on', onActivate: vi.fn(), onClose: vi.fn() });

		press(container, 'ArrowUp');
		expect(items[2].classList.contains('on')).toBe(true);
	});

	it('Home and End jump to the first and last items', () => {
		const { container, items } = buildMenu(4);
		attachRovingMenuKeyboard({ container, items, activeClass: 'on', onActivate: vi.fn(), onClose: vi.fn() });

		press(container, 'End');
		expect(items[3].classList.contains('on')).toBe(true);
		press(container, 'Home');
		expect(items[0].classList.contains('on')).toBe(true);
	});

	it('Enter and Space activate the current item', () => {
		const { container, items } = buildMenu(3);
		const onActivate = vi.fn();
		attachRovingMenuKeyboard({ container, items, activeClass: 'on', onActivate, onClose: vi.fn() });

		press(container, 'ArrowDown'); // active -> 1
		press(container, 'Enter');
		expect(onActivate).toHaveBeenCalledWith(items[1], 1);

		press(container, ' ');
		expect(onActivate).toHaveBeenCalledTimes(2);
	});

	it('Escape and Tab close the menu', () => {
		const { container, items } = buildMenu(2);
		const onClose = vi.fn();
		attachRovingMenuKeyboard({ container, items, activeClass: 'on', onActivate: vi.fn(), onClose });

		press(container, 'Escape');
		expect(onClose).toHaveBeenCalledTimes(1);
		press(container, 'Tab');
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it('does not auto-focus when autoFocusFirst is false', () => {
		const { container, items } = buildMenu(2);
		attachRovingMenuKeyboard({ container, items, activeClass: 'on', onActivate: vi.fn(), onClose: vi.fn(), autoFocusFirst: false });
		expect(items[0].classList.contains('on')).toBe(false);
		expect(document.activeElement).not.toBe(items[0]);
	});

	it('cleanup removes the listener so later keys are ignored', () => {
		const { container, items } = buildMenu(3);
		const onClose = vi.fn();
		const detach = attachRovingMenuKeyboard({ container, items, activeClass: 'on', onActivate: vi.fn(), onClose });

		detach();
		press(container, 'Escape');
		expect(onClose).not.toHaveBeenCalled();
	});

	it('tolerates an empty item list', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		expect(() => attachRovingMenuKeyboard({ container, items: [], activeClass: 'on', onActivate: vi.fn(), onClose: vi.fn() })).not.toThrow();
		expect(() => press(container, 'ArrowDown')).not.toThrow();
	});
});
