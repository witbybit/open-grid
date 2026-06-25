import type { ColumnId } from '../columns/ColumnId.js';
import type { RowId } from '../rows/RowId.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChartType = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'histogram';

export interface ChartDataPoint {
	readonly label: string;
	readonly value: number;
	readonly rowId: RowId;
}

export interface ChartSeries {
	readonly field: string;
	readonly label: string;
	readonly color?: string;
	readonly data: readonly ChartDataPoint[];
}

export interface ChartConfig {
	readonly type: ChartType;
	/** Category field (X axis label source). */
	readonly categoryField: string;
	/** One or more value fields (Y axis). */
	readonly valueFields: readonly string[];
	/** Optional filter: only chart these row IDs. */
	readonly rowIds?: ReadonlySet<RowId>;
	/** Title shown above the chart. */
	readonly title?: string;
}

export interface ChartSnapshot {
	readonly config: ChartConfig;
	readonly series: readonly ChartSeries[];
	readonly categories: readonly string[];
}

// ---------------------------------------------------------------------------
// ChartOverlayController
// ---------------------------------------------------------------------------

/**
 * Builds chart data from the grid's cell values. The controller is renderer-agnostic:
 * it produces a `ChartSnapshot` that any charting library (Chart.js, Recharts, d3, …)
 * can consume. The grid renders a DOM overlay element; the snapshot drives the chart
 * content inside it.
 */
export class ChartOverlayController<TRow = unknown> {
	private _config: ChartConfig | null = null;
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly getCellValue: (rowId: RowId, field: string) => unknown,
		private readonly getVisibleRowIds: () => readonly RowId[]
	) {}

	isActive(): boolean {
		return this._config !== null;
	}
	getConfig(): ChartConfig | null {
		return this._config;
	}

	open(config: ChartConfig): void {
		this._config = config;
		this._notify();
	}

	close(): void {
		this._config = null;
		this._notify();
	}

	/**
	 * Build a chart snapshot from the current config + live cell values.
	 * Returns null if no config is active.
	 */
	buildSnapshot(): ChartSnapshot | null {
		if (!this._config) return null;
		const config = this._config;

		const rowIds = config.rowIds ? [...config.rowIds] : [...this.getVisibleRowIds()];

		// Collect categories (X axis)
		const categories = rowIds.map((id) => String(this.getCellValue(id, config.categoryField) ?? id));

		// Build one series per value field
		const palette = DEFAULT_PALETTE;
		const series: ChartSeries[] = config.valueFields.map((field, i) => ({
			field,
			label: field,
			color: palette[i % palette.length],
			data: rowIds.map((rowId, j) => ({
				label: categories[j] ?? String(rowId),
				value: numericValue(this.getCellValue(rowId, field)),
				rowId,
			})),
		}));

		return { config, series, categories };
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	}

	destroy(): void {
		this.listeners.clear();
	}

	private _notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PALETTE = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

function numericValue(v: unknown): number {
	const n = Number(v);
	return isNaN(n) ? 0 : n;
}
