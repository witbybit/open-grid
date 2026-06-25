import type { ColumnId } from '../columns/ColumnId.js';
import type { RowId } from '../rows/RowId.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FillEnginePort {
	getCellValue(rowId: RowId, field: string): unknown;
	setCellValue(rowId: RowId, field: string, value: unknown): void;
	fieldForColumn(columnId: ColumnId): string | null;
}

export type FillPattern = 'copy' | 'linear' | 'auto';

// ---------------------------------------------------------------------------
// SpreadsheetFillEngine
// ---------------------------------------------------------------------------

/**
 * Spreadsheet-style fill operations:
 * - fillDown: copy values from the topmost selected row into all rows below
 * - fillRight: copy value from the leftmost column into columns to the right
 * - fillLinear: extrapolate a linear trend from the first two rows/columns
 *
 * The engine writes via `port.setCellValue` (each call goes through the cell command
 * pipeline, respecting validators). The caller (plugin/keyboard handler) batches the
 * returned operations into a single transaction.
 */
export class SpreadsheetFillEngine {
	constructor(private readonly port: FillEnginePort) {}

	/**
	 * Fill down: copy values from `sourceRowId` into each of `targetRowIds` for the given columns.
	 * Linear extrapolation: if two source rows are provided in order, projects a trend.
	 */
	fillDown(
		columnIds: readonly ColumnId[],
		sourceRowIds: readonly RowId[], // [anchor, ...] — first used as value source; two for trend
		targetRowIds: readonly RowId[],
		pattern: FillPattern = 'auto',
	): FillOperation[] {
		if (sourceRowIds.length === 0 || targetRowIds.length === 0) return [];

		const ops: FillOperation[] = [];

		for (const columnId of columnIds) {
			const field = this.port.fieldForColumn(columnId);
			if (!field) continue;

			const sourceValues = sourceRowIds.map((id) => this.port.getCellValue(id, field));
			const trend = pattern !== 'copy' ? detectTrend(sourceValues) : null;

			for (let i = 0; i < targetRowIds.length; i++) {
				const rowId = targetRowIds[i];
				const value =
					trend !== null
						? projectLinear(trend, sourceValues.length + i)
						: sourceValues[0];
				ops.push({ rowId, field, value });
				this.port.setCellValue(rowId, field, value);
			}
		}

		return ops;
	}

	/**
	 * Fill right: copy value from `sourceColumnId` into each of `targetColumnIds` for the given row.
	 */
	fillRight(
		rowId: RowId,
		sourceColumnId: ColumnId,
		targetColumnIds: readonly ColumnId[],
	): FillOperation[] {
		const sourceField = this.port.fieldForColumn(sourceColumnId);
		if (!sourceField) return [];
		const sourceValue = this.port.getCellValue(rowId, sourceField);

		const ops: FillOperation[] = [];
		for (const columnId of targetColumnIds) {
			const field = this.port.fieldForColumn(columnId);
			if (!field) continue;
			ops.push({ rowId, field, value: sourceValue });
			this.port.setCellValue(rowId, field, sourceValue);
		}
		return ops;
	}

	/**
	 * Fill selection: given a rectangular selection (rows × columns), fill all cells from
	 * the topmost row's values using the given pattern.
	 */
	fillSelection(
		columnIds: readonly ColumnId[],
		allRowIds: readonly RowId[],
		pattern: FillPattern = 'copy',
	): FillOperation[] {
		if (allRowIds.length <= 1) return [];
		const [first, ...rest] = allRowIds as [RowId, ...RowId[]];
		return this.fillDown(columnIds, [first], rest, pattern);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface FillOperation {
	rowId: RowId;
	field: string;
	value: unknown;
}

interface LinearTrend {
	start: number;
	step: number;
}

function detectTrend(values: unknown[]): LinearTrend | null {
	if (values.length < 2) return null;
	const nums = values.map(Number);
	if (nums.some(isNaN)) return null;
	// Simple linear: use first and last point
	const step = (nums[nums.length - 1]! - nums[0]!) / (nums.length - 1);
	return { start: nums[0]!, step };
}

function projectLinear(trend: LinearTrend, index: number): number {
	return trend.start + trend.step * index;
}
