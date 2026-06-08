export interface CsvExportOptions {
	/** Downloaded file name. Default: 'export.csv' */
	fileName?: string;
	/** Column delimiter. Default: ',' */
	delimiter?: string;
	/** Include header row. Default: true */
	includeHeader?: boolean;
	/** Restrict export to these column fields (in order). Defaults to all displayed columns. */
	columns?: string[];
	/** Export only selected rows. Default: false */
	onlySelected?: boolean;
}

// Minimal duck-typed interface — avoids a circular import with store.ts
interface Exportable<TRowData> {
	getDisplayedColumns(): Array<{ field: string; header: string }>;
	rows(): { getAll(): TRowData[]; getSelected(): TRowData[] };
	getRowId(row: TRowData): string;
	getCellValue(rowId: string, field: string): unknown;
}

export function exportToCsv<TRowData>(api: Exportable<TRowData>, options: CsvExportOptions = {}): void {
	const { fileName = 'export.csv', delimiter = ',', includeHeader = true, columns: colFilter, onlySelected = false } = options;

	const cols = api.getDisplayedColumns().filter((col) => !colFilter || colFilter.includes(col.field));

	const lines: string[] = [];

	if (includeHeader) {
		lines.push(cols.map((col) => escapeCell(col.header || col.field, delimiter)).join(delimiter));
	}

	const dataRows = onlySelected ? api.rows().getSelected() : api.rows().getAll();

	for (const row of dataRows) {
		const rowId = api.getRowId(row);
		lines.push(cols.map((col) => escapeCell(fmt(api.getCellValue(rowId, col.field)), delimiter)).join(delimiter));
	}

	// UTF-8 BOM makes Excel open the file correctly without re-encoding
	const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
	triggerDownload(blob, fileName);
}

function fmt(value: unknown): string {
	if (value == null) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return String(value);
}

function escapeCell(value: string, delimiter: string): string {
	if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
		return '"' + value.replace(/"/g, '""') + '"';
	}
	return value;
}

function triggerDownload(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
