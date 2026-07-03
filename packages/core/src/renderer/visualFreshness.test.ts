import { describe, expect, it } from 'vitest';
import {
	applyMountedCellFreshness,
	createVisualFreshness,
	explainVisualStaleness,
	hasMountedDataVersionDrifted,
	isMountedCellVisuallyFresh,
	isRowVersionFresh,
	isSnapshotVisuallyFresh,
	isVisualFresh,
	mountedCellFreshness,
	snapshotFreshness,
	type MountedFreshnessHost,
	type VisualFreshness,
} from './visualFreshness.js';

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

	function mountedHost(overrides: Partial<MountedFreshnessHost> = {}): MountedFreshnessHost {
		return {
			lastMountedRowVersion: 1,
			lastMountedGlobalVersion: 2,
			lastMountedInsightVersion: 3,
			lastMountedStyleVersion: 4,
			lastMountedLoadingVersion: 5,
			lastMountedSelectionVersion: 6,
			...overrides,
		};
	}

	describe('mountedCellFreshness / applyMountedCellFreshness / isMountedCellVisuallyFresh', () => {
		it('reads all six mounted dimensions into a VisualFreshness', () => {
			expect(mountedCellFreshness(mountedHost())).toEqual(freshness());
		});

		it('returns undefined for a virgin (never-mounted) host', () => {
			expect(mountedCellFreshness(mountedHost({ lastMountedRowVersion: -1, lastMountedGlobalVersion: -1 }))).toBeUndefined();
		});

		it('applyMountedCellFreshness writes all six dimensions back onto the host', () => {
			const host = mountedHost({
				lastMountedRowVersion: 0,
				lastMountedGlobalVersion: 0,
				lastMountedInsightVersion: 0,
				lastMountedStyleVersion: 0,
				lastMountedLoadingVersion: 0,
				lastMountedSelectionVersion: 0,
			});
			applyMountedCellFreshness(host, freshness());
			expect(mountedCellFreshness(host)).toEqual(freshness());
		});

		it('isMountedCellVisuallyFresh is the same model as isVisualFresh (fresh case)', () => {
			expect(isMountedCellVisuallyFresh(mountedHost(), freshness())).toBe(true);
		});

		it.each(['rowVersion', 'globalVersion', 'insightVersion', 'styleVersion', 'loadingVersion', 'selectionVersion'] as const)(
			'isMountedCellVisuallyFresh rejects a mounted cell that diverges only on %s',
			(dimension) => {
				const key = `lastMounted${dimension[0].toUpperCase()}${dimension.slice(1)}` as const as keyof MountedFreshnessHost;
				const host = mountedHost();
				const expected = freshness({ [dimension]: (host[key] as number) + 1 });
				expect(isMountedCellVisuallyFresh(host, expected)).toBe(false);
			}
		);

		it('isMountedCellVisuallyFresh rejects a virgin host regardless of expected freshness', () => {
			expect(isMountedCellVisuallyFresh(mountedHost({ lastMountedRowVersion: -1, lastMountedGlobalVersion: -1 }), freshness())).toBe(false);
		});
	});

	describe('snapshotFreshness / isSnapshotVisuallyFresh', () => {
		it('snapshotFreshness is a pure passthrough of the six dimensions (same model as mounted cells)', () => {
			const snapshot = { ...freshness(), rowId: 'r1', colField: 'name' };
			expect(snapshotFreshness(snapshot)).toEqual(freshness());
		});

		it('isSnapshotVisuallyFresh is exactly isVisualFresh under a snapshot-flavored name', () => {
			expect(isSnapshotVisuallyFresh(freshness(), freshness())).toBe(true);
			expect(isSnapshotVisuallyFresh(undefined, freshness())).toBe(false);
			expect(isSnapshotVisuallyFresh(freshness({ styleVersion: 999 }), freshness())).toBe(false);
		});
	});

	describe('hasMountedDataVersionDrifted', () => {
		it('reports no drift when row and global versions match', () => {
			const result = hasMountedDataVersionDrifted(mountedHost(), { rowVersion: 1, globalVersion: 2 });
			expect(result).toEqual({ globalChanged: false, rowChanged: false });
		});

		it('reports globalChanged only when global version diverges', () => {
			const result = hasMountedDataVersionDrifted(mountedHost(), { rowVersion: 1, globalVersion: 999 });
			expect(result).toEqual({ globalChanged: true, rowChanged: false });
		});

		it('reports rowChanged only when row version diverges', () => {
			const result = hasMountedDataVersionDrifted(mountedHost(), { rowVersion: 999, globalVersion: 2 });
			expect(result).toEqual({ globalChanged: false, rowChanged: true });
		});

		it('never reports drift for a dimension that was never mounted (-1 sentinel)', () => {
			const result = hasMountedDataVersionDrifted(mountedHost({ lastMountedRowVersion: -1, lastMountedGlobalVersion: -1 }), {
				rowVersion: 999,
				globalVersion: 999,
			});
			expect(result).toEqual({ globalChanged: false, rowChanged: false });
		});

		it('never reports rowChanged when the expected row version is undefined', () => {
			const result = hasMountedDataVersionDrifted(mountedHost(), { rowVersion: undefined, globalVersion: 2 });
			expect(result.rowChanged).toBe(false);
		});

		it('does NOT depend on insight/style/loading/selection dimensions — narrower than full freshness on purpose', () => {
			const host = mountedHost({
				lastMountedInsightVersion: 1,
				lastMountedStyleVersion: 1,
				lastMountedLoadingVersion: 1,
				lastMountedSelectionVersion: 1,
			});
			// Only row/global match the host; the other four dimensions are wildly different but must
			// not factor into this check at all.
			const result = hasMountedDataVersionDrifted(host, { rowVersion: 1, globalVersion: 2 });
			expect(result).toEqual({ globalChanged: false, rowChanged: false });
		});
	});

	describe('isRowVersionFresh', () => {
		it('is fresh when the row versions match', () => {
			expect(isRowVersionFresh(3, 3)).toBe(true);
		});

		it('is stale when the row versions differ', () => {
			expect(isRowVersionFresh(3, 4)).toBe(false);
		});

		it('is stale when the actual row version is undefined (nothing captured yet)', () => {
			expect(isRowVersionFresh(undefined, 3)).toBe(false);
		});

		it('does not accidentally match two undefined values against each other', () => {
			expect(isRowVersionFresh(undefined, undefined as unknown as number)).toBe(false);
		});
	});
});
