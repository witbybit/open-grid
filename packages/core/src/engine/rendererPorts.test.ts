import { describe, it, expect, vi } from 'vitest';
import {
	headlessRendererPort,
	headlessThemePort,
	createHeadlessPorts,
} from './rendererPorts.js';
import { DARK_THEME } from '../renderer/themes.js';

describe('headlessRendererPort', () => {
	it('requestRender is a no-op (does not throw)', () => {
		expect(() => headlessRendererPort.requestRender('test')).not.toThrow();
	});

	it('getStats returns a zero-value RenderStats object', () => {
		const stats = headlessRendererPort.getStats();
		expect(typeof stats).toBe('object');
		// All numeric counters should be 0
		for (const [, v] of Object.entries(stats)) {
			if (typeof v === 'number') expect(v).toBe(0);
		}
	});

	it('resetStats is a no-op (does not throw)', () => {
		expect(() => headlessRendererPort.resetStats()).not.toThrow();
	});

	it('getContainer returns null — no DOM in headless context', () => {
		expect(headlessRendererPort.getContainer()).toBeNull();
	});
});

describe('headlessThemePort', () => {
	it('getTheme returns a stable theme object (dark by default)', () => {
		expect(headlessThemePort.getTheme()).toBe(DARK_THEME);
	});

	it('getThemeName returns null — no theme manager in headless context', () => {
		expect(headlessThemePort.getThemeName()).toBeNull();
	});

	it('getAvailableThemes returns an empty array', () => {
		expect(headlessThemePort.getAvailableThemes()).toEqual([]);
	});

	it('switchTheme is a no-op (does not throw)', () => {
		expect(() => headlessThemePort.switchTheme('light')).not.toThrow();
	});

	it('mergeTheme is a no-op (does not throw)', () => {
		expect(() => headlessThemePort.mergeTheme({ gridBackground: '#fff' })).not.toThrow();
	});

	it('onThemeChange returns an unsubscribe function that does not throw', () => {
		const listener = vi.fn();
		const unsub = headlessThemePort.onThemeChange(listener);
		expect(typeof unsub).toBe('function');
		expect(() => unsub()).not.toThrow();
		expect(listener).not.toHaveBeenCalled();
	});
});

describe('createHeadlessPorts', () => {
	it('returns an object with renderer and theme ports', () => {
		const ports = createHeadlessPorts();
		expect(ports.renderer).toBe(headlessRendererPort);
		expect(ports.theme).toBe(headlessThemePort);
	});

	it('can be called multiple times — each call returns the same singleton ports', () => {
		const a = createHeadlessPorts();
		const b = createHeadlessPorts();
		expect(a.renderer).toBe(b.renderer);
		expect(a.theme).toBe(b.theme);
	});
});
