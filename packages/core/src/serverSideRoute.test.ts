import { describe, expect, it } from 'vitest';
import { areServerSideRoutesEqual, createServerSideRouteKey, isRootServerSideRoute, normalizeServerSideRoute } from './serverSideRoute.js';

describe('serverSideRoute helpers', () => {
	it('normalizes undefined and empty routes to the shared root route', () => {
		const undefinedRoute = normalizeServerSideRoute(undefined);
		const emptyRoute = normalizeServerSideRoute([]);

		expect(undefinedRoute).toBe(emptyRoute);
		expect(undefinedRoute).toEqual([]);
	});

	it('clones non-root routes into immutable canonical arrays', () => {
		const source = ['Europe', 'Germany'];
		const route = normalizeServerSideRoute(source);

		expect(route).toEqual(['Europe', 'Germany']);
		expect(route).not.toBe(source);
		expect(Object.isFrozen(route)).toBe(true);
	});

	it('creates stable route keys for root and child routes', () => {
		expect(createServerSideRouteKey(undefined)).toBe('');
		expect(createServerSideRouteKey([])).toBe('');
		expect(createServerSideRouteKey(['Europe', 'Germany'])).toBe('Europe\u001fGermany');
	});

	it('compares routes by canonical segment identity rather than array reference', () => {
		expect(areServerSideRoutesEqual(['Europe'], ['Europe'])).toBe(true);
		expect(areServerSideRoutesEqual(['Europe'], ['Americas'])).toBe(false);
		expect(areServerSideRoutesEqual(undefined, [])).toBe(true);
	});

	it('detects the root route explicitly', () => {
		expect(isRootServerSideRoute(undefined)).toBe(true);
		expect(isRootServerSideRoute([])).toBe(true);
		expect(isRootServerSideRoute(['Europe'])).toBe(false);
	});
});
