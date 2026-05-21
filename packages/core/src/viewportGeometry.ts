export class ViewportGeometry {
	public colLefts = new Float64Array(0);
	public colWidths = new Float64Array(0);
	public rowTops = new Float64Array(0);
	public rowHeights = new Float64Array(0);

	public updateColumns(widths: number[], defaultWidth: number): void {
		const len = widths.length;
		this.colWidths = new Float64Array(len);
		this.colLefts = new Float64Array(len);

		let left = 0;
		for (let i = 0; i < len; i++) {
			const w = widths[i] !== undefined ? widths[i] : defaultWidth;
			this.colWidths[i] = w;
			this.colLefts[i] = left;
			left += w;
		}
	}

	public updateRows(heights: number[], defaultHeight: number): void {
		const len = heights.length;
		this.rowHeights = new Float64Array(len);
		this.rowTops = new Float64Array(len);

		let top = 0;
		for (let i = 0; i < len; i++) {
			const h = heights[i] !== undefined ? heights[i] : defaultHeight;
			this.rowHeights[i] = h;
			this.rowTops[i] = top;
			top += h;
		}
	}

	/**
	 * Locates the index corresponding to a pixel offset in cumulative positions (Float64Array).
	 * Utilizes high-performance binary search to execute in O(log N) time complexity.
	 */
	public getIndexAtOffset(offset: number, cumulativePositions: Float64Array): number {
		const len = cumulativePositions.length;
		if (len === 0) return 0;

		let low = 0;
		let high = len - 1;

		while (low <= high) {
			const mid = (low + high) >> 1;
			const pos = cumulativePositions[mid];

			if (pos <= offset) {
				// If mid is the last element or the next element is beyond the offset, we've found our match
				if (mid === len - 1 || cumulativePositions[mid + 1] > offset) {
					return mid;
				}
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		return 0;
	}
}
