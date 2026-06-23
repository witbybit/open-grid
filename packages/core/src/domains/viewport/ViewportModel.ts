import type { RowHeightModel } from '../layout/RowHeightModel.js';
import { computeVisibleWindow } from './VisibleWindow.js';
import type { VisibleWindow } from './VisibleWindow.js';

export interface ViewportSnapshot {
	readonly scrollTop: number;
	readonly scrollLeft: number;
	readonly width: number;
	readonly height: number;
}

const ZERO_VIEWPORT: ViewportSnapshot = { scrollTop: 0, scrollLeft: 0, width: 0, height: 0 };

/**
 * Runtime viewport state (ARCHITECTURE.md §3 R11–R12). Scroll/size are ephemeral, high-frequency
 * runtime state — they update here directly and trigger a render-plan recompute. They deliberately
 * do NOT route through the undoable kernel commit pipeline (see plan 132g). Business writes still
 * go only through the kernel.
 */
export class ViewportModel {
	private snapshot: ViewportSnapshot = ZERO_VIEWPORT;

	constructor(private overscanPx = 0) {}

	getSnapshot(): ViewportSnapshot {
		return this.snapshot;
	}

	/** Update scroll. Returns true if anything changed. */
	setScroll(scrollTop: number, scrollLeft: number): boolean {
		if (scrollTop === this.snapshot.scrollTop && scrollLeft === this.snapshot.scrollLeft) return false;
		this.snapshot = { ...this.snapshot, scrollTop, scrollLeft };
		return true;
	}

	/** Update viewport size. Returns true if anything changed. */
	setSize(width: number, height: number): boolean {
		if (width === this.snapshot.width && height === this.snapshot.height) return false;
		this.snapshot = { ...this.snapshot, width, height };
		return true;
	}

	setOverscan(overscanPx: number): void {
		this.overscanPx = overscanPx;
	}

	getVisibleWindow(rows: RowHeightModel): VisibleWindow {
		return computeVisibleWindow(rows, this.snapshot.scrollTop, this.snapshot.height, this.overscanPx);
	}
}
