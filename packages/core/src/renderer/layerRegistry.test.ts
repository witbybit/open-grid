import { describe, expect, it } from 'vitest';
import { LAYER_REGISTRY } from './layerRegistry.js';

const ROOTS = new Set(['scroll-viewport', 'container']);

describe('layer registry (Plan 039)', () => {
	it('has unique layer ids', () => {
		const ids = LAYER_REGISTRY.map((d) => d.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('every parent ref resolves to a root or another registered layer', () => {
		const ids = new Set(LAYER_REGISTRY.map((d) => d.id));
		for (const d of LAYER_REGISTRY) {
			expect(ROOTS.has(d.parent) || ids.has(d.parent), `layer "${d.id}" parent "${d.parent}" is unknown`).toBe(true);
		}
	});

	it('has no cyclic parent chains (every layer reaches a root)', () => {
		const byId = new Map(LAYER_REGISTRY.map((d) => [d.id, d] as const));
		for (const d of LAYER_REGISTRY) {
			let cur: string = d.parent;
			let hops = 0;
			while (!ROOTS.has(cur)) {
				const next = byId.get(cur);
				expect(next, `layer "${d.id}" chain hit dead end at "${cur}"`).toBeDefined();
				cur = next!.parent;
				expect(++hops, `layer "${d.id}" has a cyclic parent chain`).toBeLessThan(LAYER_REGISTRY.length + 1);
			}
		}
	});

	it('classNames follow the og-layer / og-* convention and are unique', () => {
		const classes = LAYER_REGISTRY.map((d) => d.className);
		expect(new Set(classes).size).toBe(classes.length);
		for (const c of classes) {
			expect(c.startsWith('og-')).toBe(true);
		}
	});

	it('every layer with structural positioning exposes an apply()', () => {
		// group-panel/header/rows/etc. are all positioned from the plan, so they must
		// carry an apply. (A future purely-static layer may legitimately omit it.)
		const positioned = LAYER_REGISTRY.filter((d) => d.id !== '__none__');
		expect(positioned.every((d) => typeof d.apply === 'function')).toBe(true);
	});
});
