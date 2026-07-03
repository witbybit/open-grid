/**
 * Sole lifecycle owner of "frozen HTML" captures — the static innerHTML clone of an already-live
 * custom-renderer portal, replayed as a scroll-time impostor (see scrollCellPresentation.ts's
 * `impostor-html` case) so a settled rich cell keeps looking settled instead of degrading to plain
 * text on its first scroll. Previously this string rode along as a raw field on every
 * `CellDisplaySnapshot`, re-copied on every unrelated snapshot rewrite (selection/focus/style
 * changes) and never evicted — a snapshot that ever captured HTML kept it forever, with no size
 * accounting. This store is addressed independently by (rowId, colField), gated by rowVersion, and
 * bounded by total retained byte size (approximated via string length) rather than entry count, so
 * a handful of huge rich cells and thousands of small badge chips both stay within a predictable
 * memory budget. Eviction is plain LRU: Map iteration order is insertion order, and a re-`set`
 * deletes-then-reinserts to move an entry to the most-recently-used end.
 */
export interface HtmlScrollSnapshot {
	readonly html: string;
	readonly rowVersion: number;
	readonly rowHeight: number | undefined;
}

export interface HtmlScrollSnapshotStoreStats {
	readonly entries: number;
	readonly bytesRetained: number;
	readonly evictions: number;
}

function buildKey(rowId: string, colField: string): string {
	return `${rowId}\0${colField}`;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export class HtmlScrollSnapshotStore {
	private readonly entries = new Map<string, HtmlScrollSnapshot>();
	private bytesRetained = 0;
	private evictions = 0;

	constructor(private readonly maxBytes: number = DEFAULT_MAX_BYTES) {}

	/** Returns the captured snapshot only if it still matches the expected row identity (rowVersion) —
	 *  a stale capture from a since-changed row must never be replayed as if it were current. */
	public get(rowId: string, colField: string, expectedRowVersion: number): HtmlScrollSnapshot | undefined {
		const entry = this.entries.get(buildKey(rowId, colField));
		if (!entry || entry.rowVersion !== expectedRowVersion) return undefined;
		return entry;
	}

	public set(rowId: string, colField: string, html: string, rowVersion: number, rowHeight: number | undefined): void {
		const key = buildKey(rowId, colField);
		this.deleteByKey(key);
		this.entries.set(key, { html, rowVersion, rowHeight });
		this.bytesRetained += html.length;
		this.evictWhileOverBudget();
	}

	public delete(rowId: string, colField: string): void {
		this.deleteByKey(buildKey(rowId, colField));
	}

	public clear(): void {
		this.entries.clear();
		this.bytesRetained = 0;
	}

	public getStats(): HtmlScrollSnapshotStoreStats {
		return { entries: this.entries.size, bytesRetained: this.bytesRetained, evictions: this.evictions };
	}

	private deleteByKey(key: string): void {
		const existing = this.entries.get(key);
		if (!existing) return;
		this.bytesRetained -= existing.html.length;
		this.entries.delete(key);
	}

	private evictWhileOverBudget(): void {
		while (this.bytesRetained > this.maxBytes && this.entries.size > 1) {
			const oldestKey = this.entries.keys().next().value;
			if (oldestKey === undefined) break;
			this.deleteByKey(oldestKey);
			this.evictions++;
		}
	}
}
