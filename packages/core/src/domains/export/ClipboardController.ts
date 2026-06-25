import type { RenderColumn } from '../render/RendererEngineView.js';
import type { RowId } from '../rows/RowId.js';
import type { VisualRow } from '../pipeline/VisualRow.js';
import type { SelectionState } from '../selection/SelectionState.js';
import type { GridCommand } from '../../kernel/GridCommand.js';
import type { GridCommandResult } from '../../kernel/GridCommandResult.js';
import { GridExportEngine } from './GridExportEngine.js';

export interface ClipboardPort<TRow> {
	getColumns(): RenderColumn[];
	getCellValue(rowId: RowId, field: string): unknown;
	getVisualRows(): ReadonlyArray<VisualRow<TRow>>;
	getSelection(): SelectionState;
	getRow(rowId: RowId): TRow | null;
	dispatch(command: GridCommand): GridCommandResult;
}

export interface ClipboardOptions {
	/** If true, include column headers in copied TSV (default false). */
	includeHeaders?: boolean;
}

export class ClipboardController<TRow> {
	private _cutRowIds: ReadonlySet<RowId> | null = null;

	constructor(
		private readonly port: ClipboardPort<TRow>,
		private readonly opts: ClipboardOptions = {}
	) {}

	/** True if there's a pending cut operation (rows highlighted for deletion). */
	get hasPendingCut(): boolean {
		return this._cutRowIds !== null && this._cutRowIds.size > 0;
	}

	/** IDs of rows pending cut (for UI highlighting). */
	get pendingCutRowIds(): ReadonlySet<RowId> | null {
		return this._cutRowIds;
	}

	clearCut(): void {
		this._cutRowIds = null;
	}

	async copySelection(): Promise<void> {
		const { selectedRowIds } = this.port.getSelection();
		if (selectedRowIds.size === 0) return;
		const tsv = this._buildTsv(selectedRowIds);
		await writeClipboard(tsv);
		this._cutRowIds = null;
	}

	async cutSelection(): Promise<void> {
		const { selectedRowIds } = this.port.getSelection();
		if (selectedRowIds.size === 0) return;
		const tsv = this._buildTsv(selectedRowIds);
		await writeClipboard(tsv);
		this._cutRowIds = new Set(selectedRowIds);
	}

	/**
	 * Commit pending cut: delete the cut rows from the grid.
	 * Call this after a successful paste if you want cut-and-paste semantics.
	 */
	commitCut(): void {
		if (!this._cutRowIds || this._cutRowIds.size === 0) return;
		const ids = [...this._cutRowIds];
		this._cutRowIds = null;
		this.port.dispatch({
			type: 'rows.applyTransaction',
			payload: { transaction: { remove: ids } },
		});
	}

	async paste(): Promise<void> {
		const text = await readClipboard();
		if (!text) return;

		const parsed = GridExportEngine.parseTabular(text);
		if (parsed.length === 0) return;

		const columns = this.port.getColumns();
		const { selectedRowIds } = this.port.getSelection();
		const selectedArr = [...selectedRowIds];

		if (selectedArr.length === 0) {
			// No selection → append as new rows (if column count matches)
			const newRows = buildNewRows<TRow>(parsed, columns);
			if (newRows.length > 0) {
				this.port.dispatch({
					type: 'rows.applyTransaction',
					payload: { transaction: { add: newRows as TRow[] } },
				});
			}
			return;
		}

		// Paste into existing rows: one parsed row per selected row (wraps if fewer)
		for (let i = 0; i < selectedArr.length; i++) {
			const rowId = selectedArr[i];
			const parsedRow = parsed[i % parsed.length];
			for (let j = 0; j < parsedRow.length && j < columns.length; j++) {
				const col = columns[j];
				const field = col.field;
				this.port.dispatch({
					type: 'cell.setValue',
					payload: {
						address: { rowId, columnId: col.columnId, field },
						value: parsedRow[j],
					},
				});
			}
		}

		// If this was a cut from the same grid instance, delete the source rows
		if (this._cutRowIds) {
			this.commitCut();
		}
	}

	private _buildTsv(rowIds: ReadonlySet<RowId>): string {
		const engine = new GridExportEngine<TRow>(
			() => this.port.getColumns(),
			(rowId, field) => this.port.getCellValue(rowId, field),
			() => this.port.getVisualRows()
		);
		return engine.toCsvString({
			delimiter: '\t',
			includeHeaders: this.opts.includeHeaders ?? false,
			rowIds,
		});
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeClipboard(text: string): Promise<void> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
		} else {
			legacyCopy(text);
		}
	} catch {
		legacyCopy(text);
	}
}

async function readClipboard(): Promise<string> {
	try {
		if (navigator.clipboard?.readText) {
			return await navigator.clipboard.readText();
		}
	} catch {
		// Permission denied or not available
	}
	return '';
}

function legacyCopy(text: string): void {
	const ta = document.createElement('textarea');
	ta.value = text;
	ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
	document.body.appendChild(ta);
	ta.select();
	document.execCommand('copy');
	document.body.removeChild(ta);
}

function buildNewRows<TRow>(parsed: string[][], columns: RenderColumn[]): Partial<TRow>[] {
	return parsed.map((parsedRow) => {
		const row: Record<string, unknown> = {};
		for (let j = 0; j < parsedRow.length && j < columns.length; j++) {
			row[columns[j].field] = parsedRow[j];
		}
		return row as Partial<TRow>;
	});
}
