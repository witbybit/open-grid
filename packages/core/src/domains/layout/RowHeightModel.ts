export const DEFAULT_ROW_HEIGHT = 40;

/**
 * Row geometry (ARCHITECTURE.md §3 R12). A uniform default height with sparse per-row overrides,
 * plus cumulative top offsets for O(1) `getRowTop`/`getRowHeight` and O(log n) `rowIndexAtY`.
 * Offsets are rebuilt lazily after any mutation.
 */
export class RowHeightModel {
	private rowCount: number;
	private defaultHeight: number;
	private readonly overrides = new Map<number, number>();
	private offsets: number[] | null = null; // length rowCount + 1; offsets[i] = top of row i

	constructor(rowCount = 0, defaultHeight = DEFAULT_ROW_HEIGHT) {
		this.rowCount = rowCount;
		this.defaultHeight = defaultHeight;
	}

	getRowCount(): number {
		return this.rowCount;
	}

	setRowCount(count: number): void {
		if (count === this.rowCount) return;
		this.rowCount = count;
		this.offsets = null;
	}

	setDefaultHeight(height: number): void {
		if (height === this.defaultHeight) return;
		this.defaultHeight = height;
		this.offsets = null;
	}

	setRowHeight(index: number, height: number): void {
		if (this.overrides.get(index) === height) return;
		this.overrides.set(index, height);
		this.offsets = null;
	}

	getRowHeight(index: number): number {
		return this.overrides.get(index) ?? this.defaultHeight;
	}

	getRowTop(index: number): number {
		return this.ensureOffsets()[Math.max(0, Math.min(index, this.rowCount))]!;
	}

	getTotalHeight(): number {
		return this.ensureOffsets()[this.rowCount]!;
	}

	/** First row index whose span contains `y` (clamped to [0, rowCount-1]); -1 when empty. */
	rowIndexAtY(y: number): number {
		if (this.rowCount === 0) return -1;
		const offsets = this.ensureOffsets();
		if (y <= 0) return 0;
		if (y >= offsets[this.rowCount]!) return this.rowCount - 1;
		// binary search for the greatest index with offsets[index] <= y
		let lo = 0;
		let hi = this.rowCount;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (offsets[mid]! <= y) lo = mid + 1;
			else hi = mid;
		}
		return lo - 1;
	}

	private ensureOffsets(): number[] {
		if (this.offsets) return this.offsets;
		const offsets = new Array<number>(this.rowCount + 1);
		offsets[0] = 0;
		for (let i = 0; i < this.rowCount; i++) {
			offsets[i + 1] = offsets[i]! + (this.overrides.get(i) ?? this.defaultHeight);
		}
		this.offsets = offsets;
		return offsets;
	}
}
