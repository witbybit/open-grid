import { describe, expect, it } from 'vitest';
import { HtmlScrollSnapshotStore } from './htmlScrollSnapshotStore.js';
import type { VisualFreshness } from './visualFreshness.js';

function freshness(overrides: Partial<VisualFreshness> = {}): VisualFreshness {
	return { rowVersion: 1, globalVersion: 1, insightVersion: 0, styleVersion: 0, loadingVersion: 0, selectionVersion: 0, ...overrides };
}

describe('HtmlScrollSnapshotStore', () => {
	it('returns undefined for a never-captured cell', () => {
		const store = new HtmlScrollSnapshotStore();
		expect(store.get('r1', 'name', freshness())).toBeUndefined();
	});

	it('returns the captured html when freshness matches (row-version-only mode by default)', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness({ rowVersion: 1 }), 40, 100);
		const result = store.get('r1', 'name', freshness({ rowVersion: 1 }));
		expect(result?.html).toBe('<span>hi</span>');
		expect(result?.rowHeight).toBe(40);
		expect(result?.colWidth).toBe(100);
	});

	it('refuses to return a stale capture whose row version no longer matches', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness({ rowVersion: 1 }), 40, 100);
		expect(store.get('r1', 'name', freshness({ rowVersion: 2 }))).toBeUndefined();
	});

	it('row-version-only mode ignores other freshness dimensions by design', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness({ rowVersion: 1, globalVersion: 1, styleVersion: 0 }), 40, 100);
		// globalVersion/styleVersion diverge wildly — must still hit, since only rowVersion is checked.
		const result = store.get('r1', 'name', freshness({ rowVersion: 1, globalVersion: 999, styleVersion: 999 }));
		expect(result?.html).toBe('<span>hi</span>');
	});

	it('full mode requires every freshness dimension to match', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness({ rowVersion: 1, styleVersion: 2 }), 40, 100);
		expect(store.get('r1', 'name', freshness({ rowVersion: 1, styleVersion: 2 }), { mode: 'full' })?.html).toBe('<span>hi</span>');
		expect(store.get('r1', 'name', freshness({ rowVersion: 1, styleVersion: 3 }), { mode: 'full' })).toBeUndefined();
	});

	it('invalidates a capture when the row has been resized since', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness(), 40, 100);
		expect(store.get('r1', 'name', freshness(), { rowHeight: 40 })?.html).toBe('<span>hi</span>');
		expect(store.get('r1', 'name', freshness(), { rowHeight: 60 })).toBeUndefined();
	});

	it('invalidates a capture when the column has been resized since', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness(), 40, 100);
		expect(store.get('r1', 'name', freshness(), { colWidth: 100 })?.html).toBe('<span>hi</span>');
		expect(store.get('r1', 'name', freshness(), { colWidth: 150 })).toBeUndefined();
	});

	it('does not invalidate on height/width when the captured dimension is unknown (undefined)', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness(), undefined, undefined);
		expect(store.get('r1', 'name', freshness(), { rowHeight: 999, colWidth: 999 })?.html).toBe('<span>hi</span>');
	});

	it('keeps entries for different cells independent', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>a</span>', freshness(), 40, 100);
		store.set('r2', 'name', '<span>b</span>', freshness(), 40, 100);
		expect(store.get('r1', 'name', freshness())?.html).toBe('<span>a</span>');
		expect(store.get('r2', 'name', freshness())?.html).toBe('<span>b</span>');
	});

	it('overwrites a previous capture for the same cell and rebases byte accounting', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>aaaaaaaaaa</span>', freshness({ rowVersion: 1 }), 40, 100);
		store.set('r1', 'name', '<span>b</span>', freshness({ rowVersion: 2 }), 44, 120);
		const result = store.get('r1', 'name', freshness({ rowVersion: 2 }));
		expect(result).toMatchObject({ html: '<span>b</span>', rowHeight: 44, colWidth: 120 });
		expect(store.getStats().bytesRetained).toBe('<span>b</span>'.length);
	});

	it('tracks capturedAtSequence and lastUsedSequence, bumping lastUsedSequence on every hit', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', 'a', freshness(), undefined, undefined);
		const first = store.get('r1', 'name', freshness());
		const second = store.get('r1', 'name', freshness());
		expect(first?.capturedAtSequence).toBe(second?.capturedAtSequence);
		expect(second!.lastUsedSequence).toBeGreaterThan(first!.capturedAtSequence);
	});

	it('delete removes an entry and its byte accounting', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness(), 40, 100);
		store.delete('r1', 'name');
		expect(store.get('r1', 'name', freshness())).toBeUndefined();
		expect(store.getStats().bytesRetained).toBe(0);
	});

	it('clear empties every entry and resets byte accounting', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', freshness(), 40, 100);
		store.set('r2', 'name', '<span>bye</span>', freshness(), 40, 100);
		store.clear();
		expect(store.getStats()).toEqual({ entries: 0, bytesRetained: 0, evictions: 0 });
	});

	it('evicts the least-recently-used entry once the byte budget is exceeded', () => {
		const store = new HtmlScrollSnapshotStore(20);
		store.set('r1', 'name', 'a'.repeat(10), freshness(), undefined, undefined);
		store.set('r2', 'name', 'b'.repeat(10), freshness(), undefined, undefined);
		// 20 bytes retained, at budget — no eviction yet. getStats() is read-only, unlike get(), so
		// checking entry count here doesn't disturb LRU order.
		expect(store.getStats().entries).toBe(2);
		store.set('r3', 'name', 'c'.repeat(10), freshness(), undefined, undefined);
		// Now 30 bytes would be retained — the oldest (r1, never touched since its initial set) must
		// be evicted to get back under budget.
		expect(store.get('r1', 'name', freshness())).toBeUndefined();
		expect(store.get('r2', 'name', freshness())).toBeDefined();
		expect(store.get('r3', 'name', freshness())).toBeDefined();
		expect(store.getStats().evictions).toBe(1);
	});

	it('a get() hit moves an entry to the most-recently-used end, protecting it from the next eviction', () => {
		const store = new HtmlScrollSnapshotStore(20);
		store.set('r1', 'name', 'a'.repeat(10), freshness(), undefined, undefined);
		store.set('r2', 'name', 'b'.repeat(10), freshness(), undefined, undefined);
		store.get('r1', 'name', freshness()); // touch r1 — now r2 is the least-recently-used
		store.set('r3', 'name', 'c'.repeat(10), freshness(), undefined, undefined);
		expect(store.get('r2', 'name', freshness())).toBeUndefined(); // evicted, not r1
		expect(store.get('r1', 'name', freshness())).toBeDefined();
		expect(store.get('r3', 'name', freshness())).toBeDefined();
	});

	it('re-setting an existing key also moves it to the most-recently-used end', () => {
		const store = new HtmlScrollSnapshotStore(20);
		store.set('r1', 'name', 'a'.repeat(10), freshness({ rowVersion: 1 }), undefined, undefined);
		store.set('r2', 'name', 'b'.repeat(10), freshness(), undefined, undefined);
		store.set('r1', 'name', 'a'.repeat(10), freshness({ rowVersion: 2 }), undefined, undefined); // refresh r1
		store.set('r3', 'name', 'c'.repeat(10), freshness(), undefined, undefined);
		expect(store.get('r2', 'name', freshness())).toBeUndefined(); // evicted, not r1
		expect(store.get('r1', 'name', freshness({ rowVersion: 2 }))).toBeDefined();
		expect(store.get('r3', 'name', freshness())).toBeDefined();
	});

	it('never evicts down to zero entries even if a single entry exceeds the byte budget', () => {
		const store = new HtmlScrollSnapshotStore(5);
		store.set('r1', 'name', 'a'.repeat(100), freshness(), undefined, undefined);
		expect(store.get('r1', 'name', freshness())).toBeDefined();
		expect(store.getStats().evictions).toBe(0);
	});
});
