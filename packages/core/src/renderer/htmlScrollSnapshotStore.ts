import { isRowVersionFresh, isVisualFresh, type VisualFreshness } from './visualFreshness.js';

/**
 * Sole lifecycle owner of "frozen HTML" captures — the static innerHTML clone of an already-live
 * custom-renderer portal, replayed as a scroll-time impostor (see scrollCellPresentation.ts's
 * `impostor-html` case) so a settled rich cell keeps looking settled instead of degrading to plain
 * text on its first scroll. Previously this string rode along as a raw field on every
 * `CellDisplaySnapshot`, re-copied on every unrelated snapshot rewrite (selection/focus/style
 * changes) and never evicted — a snapshot that ever captured HTML kept it forever, with no size
 * accounting. This store is addressed independently by (rowId, colField), bounded by total retained
 * byte size (approximated via string length) rather than entry count, so a handful of huge rich
 * cells and thousands of small badge chips both stay within a predictable memory budget. Eviction is
 * plain LRU: Map iteration order is insertion order, and a re-`set` (or a `get` hit, which touches
 * the entry) deletes-then-reinserts to move an entry to the most-recently-used end.
 */
export interface HtmlScrollSnapshot {
	readonly html: string;
	/** Full identity/version stamp captured at write time — every dimension `isVisualFresh` checks. */
	readonly freshness: VisualFreshness;
	readonly rowHeight: number | undefined;
	readonly colWidth: number | undefined;
	/** `html.length` at capture time — UTF-16 code units, an approximation not a precise byte count,
	 *  close enough for a soft memory budget. Stored so eviction never has to re-measure the string. */
	readonly estimatedBytes: number;
	/** Monotonic store-local sequence number, not a wall-clock timestamp (matches the lruCounter
	 *  convention used elsewhere in the renderer — see customRendererManager.ts) — avoids relying on
	 *  Date.now() for eviction ordering, which is unnecessary here and untestable deterministically. */
	readonly capturedAtSequence: number;
	lastUsedSequence: number;
}

export interface HtmlScrollSnapshotStoreStats {
	readonly entries: number;
	readonly bytesRetained: number;
	readonly evictions: number;
}

/**
 * Controls how strict a `get()` lookup's freshness check is.
 * - 'row-version-only' (default): matches only `rowVersion`, the narrowest test already proven
 *   correct for this data — frozenHtml is a custom renderer's own committed DOM output, which tracks
 *   row data but is largely independent of style/insight/selection/loading state layered outside the
 *   portal (see visualFreshness.ts's `isRowVersionFresh` for the same reasoning applied elsewhere).
 *   Using full freshness as the DEFAULT would be a regression: unrelated version bumps (a selection
 *   change elsewhere in the grid) would over-invalidate perfectly good cached HTML.
 * - 'full': every `VisualFreshness` dimension must match. Opt in for renderers whose committed
 *   output is known to depend on style/insight/selection/loading state, not just row data.
 */
export type HtmlScrollSnapshotFreshnessMode = 'row-version-only' | 'full';

function buildKey(rowId: string, colField: string): string {
	return `${rowId}\0${colField}`;
}

function matchesFreshness(entry: VisualFreshness, expected: VisualFreshness, mode: HtmlScrollSnapshotFreshnessMode): boolean {
	if (mode === 'full') return isVisualFresh(entry, expected);
	return isRowVersionFresh(entry.rowVersion, expected.rowVersion);
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export interface HtmlScrollSnapshotStoreOptions {
	/** Max entry count, independent of the byte budget. Undefined = unbounded by count. */
	maxEntries?: number;
	/** A single capture larger than this is never stored — see GridRendererOptions.htmlSnapshot.maxSingleSnapshotBytes. */
	maxSingleEntryBytes?: number;
}

export class HtmlScrollSnapshotStore {
	private readonly entries = new Map<string, HtmlScrollSnapshot>();
	private bytesRetained = 0;
	private evictions = 0;
	private sequence = 0;
	private readonly maxEntries: number | undefined;
	private readonly maxSingleEntryBytes: number | undefined;

	constructor(
		private readonly maxBytes: number = DEFAULT_MAX_BYTES,
		options?: HtmlScrollSnapshotStoreOptions
	) {
		this.maxEntries = options?.maxEntries;
		this.maxSingleEntryBytes = options?.maxSingleEntryBytes;
	}

	/** Returns the captured snapshot only if it still matches the expected identity — a stale capture
	 *  from a since-changed row must never be replayed as if it were current. Also invalidated if the
	 *  row has been resized or the column has been resized since capture (a mismatched height/width
	 *  means the captured HTML was laid out for a different container and would render incorrectly).
	 *  A hit refreshes the entry's LRU position, same as a `set`. */
	public get(
		rowId: string,
		colField: string,
		expected: VisualFreshness,
		options?: { rowHeight?: number; colWidth?: number; mode?: HtmlScrollSnapshotFreshnessMode }
	): HtmlScrollSnapshot | undefined {
		const key = buildKey(rowId, colField);
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (!matchesFreshness(entry.freshness, expected, options?.mode ?? 'row-version-only')) return undefined;
		if (options?.rowHeight !== undefined && entry.rowHeight !== undefined && entry.rowHeight !== options.rowHeight) return undefined;
		if (options?.colWidth !== undefined && entry.colWidth !== undefined && entry.colWidth !== options.colWidth) return undefined;
		entry.lastUsedSequence = ++this.sequence;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry;
	}

	public set(
		rowId: string,
		colField: string,
		html: string,
		freshness: VisualFreshness,
		rowHeight: number | undefined,
		colWidth: number | undefined
	): void {
		if (this.maxSingleEntryBytes !== undefined && html.length > this.maxSingleEntryBytes) return;
		const key = buildKey(rowId, colField);
		this.deleteByKey(key);
		const seq = ++this.sequence;
		this.entries.set(key, {
			html,
			freshness,
			rowHeight,
			colWidth,
			estimatedBytes: html.length,
			capturedAtSequence: seq,
			lastUsedSequence: seq,
		});
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
		this.bytesRetained -= existing.estimatedBytes;
		this.entries.delete(key);
	}

	private evictWhileOverBudget(): void {
		while (
			(this.bytesRetained > this.maxBytes || (this.maxEntries !== undefined && this.entries.size > this.maxEntries)) &&
			this.entries.size > 1
		) {
			const oldestKey = this.entries.keys().next().value;
			if (oldestKey === undefined) break;
			this.deleteByKey(oldestKey);
			this.evictions++;
		}
	}
}
