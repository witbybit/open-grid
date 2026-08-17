import type { ServerSideRoute } from './serverSideRowModel.js';

const ROOT_ROUTE: readonly string[] = Object.freeze([]);

/**
 * Normalize a route into an immutable canonical array.
 * `undefined` and empty routes both resolve to the shared root route.
 */
export function normalizeServerSideRoute(route?: readonly string[] | null): ServerSideRoute {
	if (!route || route.length === 0) return ROOT_ROUTE;
	return Object.freeze([...route]);
}

/**
 * Stable route key for Maps/Sets. Root is the empty string.
 */
export function createServerSideRouteKey(route?: readonly string[] | null): string {
	const normalized = normalizeServerSideRoute(route);
	if (normalized.length === 0) return '';
	return JSON.stringify(normalized);
}

export function areServerSideRoutesEqual(a?: readonly string[] | null, b?: readonly string[] | null): boolean {
	const left = normalizeServerSideRoute(a);
	const right = normalizeServerSideRoute(b);
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

export function isRootServerSideRoute(route?: readonly string[] | null): boolean {
	return normalizeServerSideRoute(route).length === 0;
}
