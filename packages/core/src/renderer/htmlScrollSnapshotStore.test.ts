import { describe, expect, it } from 'vitest';
import { HtmlScrollSnapshotStore } from './htmlScrollSnapshotStore.js';

describe('HtmlScrollSnapshotStore', () => {
	it('returns undefined for a never-captured cell', () => {
		const store = new HtmlScrollSnapshotStore();
		expect(store.get('r1', 'name', 1)).toBeUndefined();
	});

	it('returns the captured html when the row version matches', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', 1, 40);
		expect(store.get('r1', 'name', 1)).toEqual({ html: '<span>hi</span>', rowVersion: 1, rowHeight: 40 });
	});

	it('refuses to return a stale capture whose row version no longer matches', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', 1, 40);
		expect(store.get('r1', 'name', 2)).toBeUndefined();
	});

	it('keeps entries for different cells independent', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>a</span>', 1, 40);
		store.set('r2', 'name', '<span>b</span>', 1, 40);
		expect(store.get('r1', 'name', 1)?.html).toBe('<span>a</span>');
		expect(store.get('r2', 'name', 1)?.html).toBe('<span>b</span>');
	});

	it('overwrites a previous capture for the same cell and rebases byte accounting', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>aaaaaaaaaa</span>', 1, 40);
		store.set('r1', 'name', '<span>b</span>', 2, 44);
		expect(store.get('r1', 'name', 2)).toEqual({ html: '<span>b</span>', rowVersion: 2, rowHeight: 44 });
		expect(store.getStats().bytesRetained).toBe('<span>b</span>'.length);
	});

	it('delete removes an entry and its byte accounting', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', 1, 40);
		store.delete('r1', 'name');
		expect(store.get('r1', 'name', 1)).toBeUndefined();
		expect(store.getStats().bytesRetained).toBe(0);
	});

	it('clear empties every entry and resets byte accounting', () => {
		const store = new HtmlScrollSnapshotStore();
		store.set('r1', 'name', '<span>hi</span>', 1, 40);
		store.set('r2', 'name', '<span>bye</span>', 1, 40);
		store.clear();
		expect(store.getStats()).toEqual({ entries: 0, bytesRetained: 0, evictions: 0 });
	});

	it('evicts the least-recently-set entry once the byte budget is exceeded', () => {
		const store = new HtmlScrollSnapshotStore(20);
		store.set('r1', 'name', 'a'.repeat(10), 1, undefined);
		store.set('r2', 'name', 'b'.repeat(10), 1, undefined);
		// 20 bytes retained, at budget — no eviction yet.
		expect(store.get('r1', 'name', 1)).toBeDefined();
		store.set('r3', 'name', 'c'.repeat(10), 1, undefined);
		// Now 30 bytes would be retained — the oldest (r1) must be evicted to get back under budget.
		expect(store.get('r1', 'name', 1)).toBeUndefined();
		expect(store.get('r2', 'name', 1)).toBeDefined();
		expect(store.get('r3', 'name', 1)).toBeDefined();
		expect(store.getStats().evictions).toBe(1);
	});

	it('re-setting an existing key moves it to the most-recently-used end', () => {
		const store = new HtmlScrollSnapshotStore(20);
		store.set('r1', 'name', 'a'.repeat(10), 1, undefined);
		store.set('r2', 'name', 'b'.repeat(10), 1, undefined);
		store.set('r1', 'name', 'a'.repeat(10), 2, undefined); // refresh r1 — now r2 is oldest
		store.set('r3', 'name', 'c'.repeat(10), 1, undefined);
		expect(store.get('r2', 'name', 1)).toBeUndefined(); // evicted, not r1
		expect(store.get('r1', 'name', 2)).toBeDefined();
		expect(store.get('r3', 'name', 1)).toBeDefined();
	});

	it('never evicts down to zero entries even if a single entry exceeds the byte budget', () => {
		const store = new HtmlScrollSnapshotStore(5);
		store.set('r1', 'name', 'a'.repeat(100), 1, undefined);
		expect(store.get('r1', 'name', 1)).toBeDefined();
		expect(store.getStats().evictions).toBe(0);
	});
});
