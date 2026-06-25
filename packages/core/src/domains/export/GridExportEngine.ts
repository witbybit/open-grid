import type { ColumnId } from '../columns/ColumnId.js';
import type { RenderColumn } from '../render/RendererEngineView.js';
import type { RowId } from '../rows/RowId.js';
import type { VisualRow } from '../pipeline/VisualRow.js';

export interface ExportOptions {
	/** Include the header row (default true). */
	includeHeaders?: boolean;
	/** Field delimiter (default ','). */
	delimiter?: string;
	/** Only export these columns (default: all visible). */
	columnIds?: readonly ColumnId[];
	/** Only export these data row IDs (default: all data rows in visual order). */
	rowIds?: ReadonlySet<RowId>;
	/** Filename for downloadCsv without extension (default 'export'). */
	filename?: string;
}

type CellValueFn = (rowId: RowId, field: string) => unknown;

export class GridExportEngine<TRow> {
	constructor(
		private readonly getColumns: () => RenderColumn[],
		private readonly getCellValue: CellValueFn,
		private readonly getVisualRows: () => ReadonlyArray<VisualRow<TRow>>,
	) {}

	toCsvString(opts: ExportOptions = {}): string {
		const delimiter = opts.delimiter ?? ',';
		const includeHeaders = opts.includeHeaders ?? true;

		const allColumns = this.getColumns();
		const columns = opts.columnIds
			? allColumns.filter((c) => opts.columnIds!.includes(c.columnId))
			: allColumns;

		if (columns.length === 0) return '';

		const lines: string[] = [];

		if (includeHeaders) {
			lines.push(columns.map((c) => escapeCsvCell(String(c.header ?? c.field), delimiter)).join(delimiter));
		}

		const rows = this.getVisualRows();
		for (const row of rows) {
			if (row.kind !== 'data' && row.kind !== 'tree') continue;
			if (opts.rowIds && !opts.rowIds.has(row.rowId)) continue;

			const cells = columns.map((col) => {
				const value = this.getCellValue(row.rowId, col.field);
				return escapeCsvCell(formatCellValue(value), delimiter);
			});
			lines.push(cells.join(delimiter));
		}

		return lines.join('\r\n');
	}

	downloadCsv(opts: ExportOptions = {}): void {
		const csv = this.toCsvString(opts);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${opts.filename ?? 'export'}.csv`;
		a.style.display = 'none';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	/** TSV string (tab-separated) — used by clipboard. */
	toTsvString(columnIds?: readonly ColumnId[], rowIds?: ReadonlySet<RowId>): string {
		return this.toCsvString({ delimiter: '\t', includeHeaders: false, columnIds, rowIds });
	}

	/** Parse a TSV/CSV string (auto-detect delimiter) into a 2D array of strings. */
	static parseTabular(text: string): string[][] {
		const delimiter = text.includes('\t') ? '\t' : ',';
		return text
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			.split('\n')
			.filter((line) => line.trim() !== '')
			.map((line) => parseCsvLine(line, delimiter));
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCellValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

function escapeCsvCell(value: string, delimiter: string): string {
	if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function parseCsvLine(line: string, delimiter: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') { current += '"'; i += 2; }
				else { inQuotes = false; i++; }
			} else {
				current += ch; i++;
			}
		} else {
			if (ch === '"') { inQuotes = true; i++; }
			else if (ch === delimiter) { result.push(current); current = ''; i++; }
			else { current += ch; i++; }
		}
	}
	result.push(current);
	return result;
}
