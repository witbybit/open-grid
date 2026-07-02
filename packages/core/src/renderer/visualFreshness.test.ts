import { describe, expect, it } from 'vitest';
import { createVisualFreshness, explainVisualStaleness, isVisualFresh, type VisualFreshness } from './visualFreshness.js';

function freshness(overrides: Partial<VisualFreshness> = {}): VisualFreshness {
	return {
		rowVersion: 1,
		globalVersion: 2,
		insightVersion: 3,
		styleVersion: 4,
		loadingVersion: 5,
		selectionVersion: 6,
		...overrides,
	};
}

describe('visualFreshness', () => {
	describe('createVisualFreshness', () => {
		it('copies all six dimensions into a new object', () => {
			const input = freshness();
			const result = createVisualFreshness(input);
			expect(result).toEqual(input);
			expect(result).not.toBe(input);
		});
	});

	describe('isVisualFresh', () => {
		it('is fresh when all six dimensions match exactly', () => {
			expect(isVisualFresh(freshness(), freshness())).toBe(true);
		});

		it('is stale when actual is undefined (nothing mounted/cached yet)', () => {
			expect(isVisualFresh(undefined, freshness())).toBe(false);
		});

		it.each(['rowVersion', 'globalVersion', 'insightVersion', 'styleVersion', 'loadingVersion', 'selectionVersion'] as const)(
			'is stale when only %s diverges',
			(dimension) => {
				const actual = freshness();
				const expected = freshness({ [dimension]: actual[dimension] + 1 });
				expect(isVisualFresh(actual, expected)).toBe(false);
			}
		);

		it('is stale when every dimension diverges', () => {
			const actual = freshness();
			const expected = freshness({
				rowVersion: 100,
				globalVersion: 100,
				insightVersion: 100,
				styleVersion: 100,
				loadingVersion: 100,
				selectionVersion: 100,
			});
			expect(isVisualFresh(actual, expected)).toBe(false);
		});
	});

	describe('explainVisualStaleness', () => {
		it('reports a single missing reason when actual is undefined', () => {
			const reasons = explainVisualStaleness(undefined, freshness());
			expect(reasons).toHaveLength(1);
			expect(reasons[0]).toMatch(/missing/i);
		});

		it('reports no reasons when fresh', () => {
			expect(explainVisualStaleness(freshness(), freshness())).toEqual([]);
		});

		it.each(['rowVersion', 'globalVersion', 'insightVersion', 'styleVersion', 'loadingVersion', 'selectionVersion'] as const)(
			'names %s specifically when it diverges',
			(dimension) => {
				const actual = freshness();
				const expected = freshness({ [dimension]: actual[dimension] + 1 });
				const reasons = explainVisualStaleness(actual, expected);
				expect(reasons).toHaveLength(1);
				expect(reasons[0]).toContain(dimension);
			}
		);

		it('reports all six reasons when every dimension diverges', () => {
			const actual = freshness();
			const expected = freshness({
				rowVersion: 100,
				globalVersion: 100,
				insightVersion: 100,
				styleVersion: 100,
				loadingVersion: 100,
				selectionVersion: 100,
			});
			expect(explainVisualStaleness(actual, expected)).toHaveLength(6);
		});
	});
});
