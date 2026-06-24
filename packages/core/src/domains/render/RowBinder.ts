import type { VisualRow } from '../pipeline/VisualRow.js';
import type { RendererEngineView } from './RendererEngineView.js';
import { StableSlotAssigner } from './StableSlotAssigner.js';

/** One physical slot's binding for a frame: which visual row it holds and where it sits. */
export interface RowBinding<TRow> {
	readonly slotIndex: number;
	readonly visualRowIndex: number;
	readonly row: VisualRow<TRow>;
	readonly top: number;
	readonly height: number;
}

/**
 * Projects the engine view's visible window into stable physical-slot bindings the DOM renderer
 * paints (ARCHITECTURE.md §3 R12–R13). Reuses {@link StableSlotAssigner} so a row that stays visible
 * keeps its slot (DOM node rebinds, not remounts). Holds per-slot state across frames; the renderer
 * applies each binding's `top`/`height` and content. Pure data — no DOM, no business state.
 */
export class RowBinder<TRow> {
	private readonly assigner = new StableSlotAssigner();
	/** Visual row index currently bound to each slot (-1 when unbound). */
	private slotRows: number[] = [];

	bind(view: RendererEngineView<TRow>): RowBinding<TRow>[] {
		const geo = view.getGeometry();
		const win = view.getVisibleWindow();
		const count = view.getVisualRowCount();

		const windowRows: number[] = [];
		const last = Math.min(win.lastIndex, count - 1);
		for (let i = win.firstIndex; i <= last; i++) windowRows.push(i);

		const assignment = this.assigner.assign(this.slotRows, windowRows);
		// Snapshot the assignment as the next frame's slot state.
		this.slotRows = assignment.slice();

		const bindings: RowBinding<TRow>[] = [];
		for (let slotIndex = 0; slotIndex < assignment.length; slotIndex++) {
			const visualRowIndex = assignment[slotIndex]!;
			if (visualRowIndex < 0) continue;
			const row = view.getVisualRow(visualRowIndex);
			if (!row) continue;
			bindings.push({
				slotIndex,
				visualRowIndex,
				row,
				top: geo.getRowTop(visualRowIndex),
				height: geo.getRowHeight(visualRowIndex),
			});
		}
		return bindings;
	}

	/** Number of physical slots currently in use (the window high-water mark). */
	get slotCount(): number {
		return this.slotRows.length;
	}

	reset(): void {
		this.slotRows = [];
	}
}
