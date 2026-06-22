import type { ColumnDef } from '../../../columnDef.js';
import type { GridCellDecoration, GridRowDecoration } from '../../../insights/insightTypes.js';
import type {
	GridIntegrityIssue,
	GridIntegrityModule,
	GridIntegrityRunContext,
	GridDiffModel,
	GridDiffResult,
	GridCellDiff,
	GridDiffAcceptResult,
	GridDiffIntegrityOptions,
	GridCommitResult,
	GridValidateCellProposalParams,
} from '../integrityTypes.js';

export interface DiffModuleDeps<TRowData> {
	getColumns: () => readonly ColumnDef<TRowData>[];
	commitCellValue: (rowId: string, colField: string, value: unknown) => Promise<GridCommitResult>;
	validateCellProposal?: (params: GridValidateCellProposalParams) => Promise<readonly GridIntegrityIssue[]>;
	canEdit?: (rowId: string, colField: string) => boolean;
	requestRepaint: (cells?: Array<{ rowId: string; colField: string }>) => void;
}

export class DiffIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'diff' as const;

	private options: GridDiffIntegrityOptions;
	private model: GridDiffModel<TRowData> | null = null;
	private result: GridDiffResult | null = null;
	private lastComputedAt: number | null = null;

	private readonly cellDecMap = new Map<string, GridCellDecoration[]>();
	private readonly rowDecMap = new Map<string, GridRowDecoration[]>();
	private readonly cellDiffMap = new Map<string, GridCellDiff>();

	private issues: GridIntegrityIssue[] = [];

	constructor(
		options: GridDiffIntegrityOptions,
		private readonly deps: DiffModuleDeps<TRowData>
	) {
		this.options = options;
	}

	isEnabled(): boolean {
		return this.options.enabled !== false;
	}

	getIssues(): readonly GridIntegrityIssue[] {
		return this.issues;
	}

	getDiagnostics(): unknown {
		return {
			enabled: this.isEnabled(),
			active: this.model !== null,
			addedRows: this.result?.addedRows.length ?? 0,
			removedRows: this.result?.removedRows.length ?? 0,
			changedRows: this.result?.changedRows.length ?? 0,
			changedCells: this.result?.changedCells.length ?? 0,
			lastComputedAt: this.lastComputedAt,
			validateChangedValues: this.options.validateChangedValues ?? false,
		};
	}

	// ── Module run ─────────────────────────────────────────────────────────────

	run(_context: GridIntegrityRunContext<TRowData>): readonly GridIntegrityIssue[] {
		// Diff issues are computed from the diff model, not from row scanning.
		return this.issues;
	}

	// ── Diff model management ──────────────────────────────────────────────────

	setDiffModel(model: GridDiffModel<TRowData> | null): void {
		this.model = model;
		if (model === null) {
			this._clearMaps();
			this.result = null;
			this.lastComputedAt = null;
			this.issues = [];
		} else {
			this._validateRowIdentity(model);
			this._compute(model);
			this._buildIssues();
		}
		this.deps.requestRepaint();
	}

	getDiffModel(): GridDiffModel<TRowData> | null {
		return this.model;
	}

	getDiffResult(): GridDiffResult | null {
		return this.result;
	}

	getCellDiff(rowId: string, colField: string): GridCellDiff | null {
		return this.cellDiffMap.get(`${rowId}\0${colField}`) ?? null;
	}

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		return this.cellDecMap.get(`${rowId}\0${colField}`) ?? _EMPTY_DECS;
	}

	getRowDecorations(rowId: string): readonly GridRowDecoration[] {
		return this.rowDecMap.get(rowId) ?? _EMPTY_ROW_DECS;
	}

	async acceptCellDiff(rowId: string, colField: string): Promise<GridDiffAcceptResult> {
		if (!this.isEnabled()) return { status: 'unsupported', reason: 'Diff module is disabled' };

		const cellKey = `${rowId}\0${colField}`;
		const diff = this.cellDiffMap.get(cellKey);
		if (!diff) return { status: 'notFound', reason: `No diff found for ${rowId}:${colField}` };
		if (diff.status !== 'changed') return { status: 'unsupported', reason: 'Only changed-cell accept is supported' };

		// Check capability
		if (this.deps.canEdit && !this.deps.canEdit(rowId, colField)) {
			return { status: 'capabilityDenied', reason: 'Cell is not editable' };
		}

		// Validate proposed value (not current) if validation is enabled
		if (this.options.validateChangedValues && this.deps.validateCellProposal) {
			const validationIssues = await this.deps.validateCellProposal({ rowId, colField, proposedValue: diff.newValue, source: 'diffAccept' });
			const blocking = validationIssues.filter((i) => i.blocking);
			if (blocking.length > 0) {
				return { status: 'validationFailed', issues: blocking };
			}
		}

		// Commit the new value — only clear diff state on success
		const commitResult = await this.deps.commitCellValue(rowId, colField, diff.newValue);
		if (commitResult.status !== 'applied') {
			return { status: 'failed', error: commitResult.status === 'failed' ? commitResult.error : commitResult.status };
		}

		this._rejectCellDiff(rowId, colField);
		this.deps.requestRepaint([{ rowId, colField }]);
		return { status: 'accepted' };
	}

	rejectCellDiff(rowId: string, colField: string): void {
		this._rejectCellDiff(rowId, colField);
		this.deps.requestRepaint([{ rowId, colField }]);
	}

	clearDiff(): void {
		this.model = null;
		this.result = null;
		this.lastComputedAt = null;
		this.issues = [];
		this._clearMaps();
		this.deps.requestRepaint();
	}

	// ── Private ────────────────────────────────────────────────────────────────

	private _validateRowIdentity(model: GridDiffModel<TRowData>): void {
		const hasBaseId = !!model.base.getRowId;
		const hasCompareId = !!model.compare.getRowId;
		if (!hasBaseId && !hasCompareId) {
			throw new Error(
				'[DataIntegrity] Diff module requires a getRowId function on base or compare dataset. ' +
					'JSON.stringify fallback is not allowed (breaks on undefined fields, circular refs, and key ordering).'
			);
		}
	}

	private _compute(model: GridDiffModel<TRowData>): void {
		this._clearMaps();

		const { base, compare, options } = model;
		const getBaseRowId = base.getRowId ?? compare.getRowId!;
		const getCompareRowId = compare.getRowId ?? base.getRowId!;

		const baseMap = new Map<string, TRowData>();
		for (const row of base.rows) baseMap.set(getBaseRowId(row), row);

		const compareMap = new Map<string, TRowData>();
		for (const row of compare.rows) compareMap.set(getCompareRowId(row), row);

		const columns = this.deps.getColumns();
		let fields: string[];
		if (options?.compareFields?.length) {
			fields = options.compareFields.slice() as string[];
		} else {
			const ignore = new Set(options?.ignoreFields ?? []);
			fields = columns.map((c) => c.field).filter((f): f is string => !!f && !ignore.has(f));
		}

		const addedRows: string[] = [];
		for (const id of compareMap.keys()) {
			if (!baseMap.has(id)) addedRows.push(id);
		}

		const removedRows: string[] = [];
		for (const id of baseMap.keys()) {
			if (!compareMap.has(id)) removedRows.push(id);
		}

		const changedRows = new Set<string>();
		const changedCells: GridCellDiff[] = [];

		for (const [id, baseRow] of baseMap) {
			const compareRow = compareMap.get(id);
			if (!compareRow) continue;
			for (const field of fields) {
				const oldValue = (baseRow as Record<string, unknown>)[field];
				const newValue = (compareRow as Record<string, unknown>)[field];
				if (!Object.is(oldValue, newValue)) {
					const diff: GridCellDiff = { rowId: id, colField: field, oldValue, newValue, status: 'changed' };
					changedCells.push(diff);
					changedRows.add(id);
					this.cellDiffMap.set(`${id}\0${field}`, diff);
				}
			}
		}

		this.result = {
			addedRows,
			removedRows,
			changedRows: Array.from(changedRows),
			changedCells,
		};
		this.lastComputedAt = _now();

		// Build decoration maps
		for (const cellDiff of changedCells) {
			const key = `${cellDiff.rowId}\0${cellDiff.colField}`;
			const list = this.cellDecMap.get(key) ?? [];
			list.push({
				layerId: 'dataIntegrity',
				kind: 'diffChanged',
				severity: 'warning',
				className: 'og-cell-diff-changed',
				title: `Old: ${_fmt(cellDiff.oldValue)}\nNew: ${_fmt(cellDiff.newValue)}`,
				data: cellDiff,
			});
			this.cellDecMap.set(key, list);
		}

		for (const rowId of addedRows) {
			this.rowDecMap.set(rowId, [
				{ layerId: 'dataIntegrity', kind: 'diffAdded', severity: 'info', className: 'og-row-diff-added', data: { rowId } },
			]);
			for (const field of fields) {
				const key = `${rowId}\0${field}`;
				const compareRow = compareMap.get(rowId);
				const newValue = compareRow ? (compareRow as Record<string, unknown>)[field] : undefined;
				const addedDiff: GridCellDiff = { rowId, colField: field, oldValue: undefined, newValue, status: 'added' };
				this.cellDiffMap.set(key, addedDiff);
				const list = this.cellDecMap.get(key) ?? [];
				list.push({ layerId: 'dataIntegrity', kind: 'diffAdded', severity: 'info', className: 'og-cell-diff-added', data: addedDiff });
				this.cellDecMap.set(key, list);
			}
		}

		for (const rowId of changedRows) {
			const list = this.rowDecMap.get(rowId) ?? [];
			list.push({ layerId: 'dataIntegrity', kind: 'diffChanged', severity: 'warning', className: 'og-row-diff-changed', data: { rowId } });
			this.rowDecMap.set(rowId, list);
		}
	}

	clearIssues(): void {
		this.clearDiff();
	}

	private _buildIssues(): void {
		if (!this.result) {
			this.issues = [];
			return;
		}

		const issues: GridIntegrityIssue[] = [];

		for (const cell of this.result.changedCells) {
			issues.push({
				id: `diff:changed:${cell.rowId}:${cell.colField}`,
				source: 'diff',
				type: 'diffChanged',
				severity: 'info',
				blocking: false,
				rowId: cell.rowId,
				colField: cell.colField,
				message: `Changed: ${_fmt(cell.oldValue)} → ${_fmt(cell.newValue)}`,
				value: cell.newValue,
				createdAt: _now(),
				data: cell,
			});
		}

		for (const rowId of this.result.addedRows) {
			issues.push({
				id: `diff:added:${rowId}`,
				source: 'diff',
				type: 'diffAdded',
				severity: 'info',
				blocking: false,
				rowId,
				message: 'Row added',
				createdAt: _now(),
			});
		}

		for (const rowId of this.result.removedRows) {
			issues.push({
				id: `diff:removed:${rowId}`,
				source: 'diff',
				type: 'diffRemoved',
				severity: 'info',
				blocking: false,
				rowId,
				message: 'Row removed',
				createdAt: _now(),
			});
		}

		this.issues = issues;
	}

	private _rejectCellDiff(rowId: string, colField: string): void {
		const cellKey = `${rowId}\0${colField}`;
		this.cellDecMap.delete(cellKey);
		this.cellDiffMap.delete(cellKey);
		this.issues = this.issues.filter((i) => !(i.rowId === rowId && i.colField === colField && i.source === 'diff'));
		if (this.result) {
			const changedCells = this.result.changedCells.filter((c) => !(c.rowId === rowId && c.colField === colField));
			const changedRows = changedCells.some((c) => c.rowId === rowId)
				? this.result.changedRows
				: this.result.changedRows.filter((id) => id !== rowId);
			this.result = { ...this.result, changedCells, changedRows };
			if (!changedRows.includes(rowId)) {
				const rowDecs = (this.rowDecMap.get(rowId) ?? []).filter((d) => d.kind !== 'diffChanged');
				if (rowDecs.length === 0) this.rowDecMap.delete(rowId);
				else this.rowDecMap.set(rowId, rowDecs);
			}
		}
	}

	private _clearMaps(): void {
		this.cellDecMap.clear();
		this.rowDecMap.clear();
		this.cellDiffMap.clear();
	}

	destroy(): void {
		this.clearDiff();
	}
}

function _fmt(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	return String(value);
}

function _now(): number {
	return typeof performance !== 'undefined' ? Math.floor(performance.timeOrigin + performance.now()) : 0;
}

const _EMPTY_DECS: readonly GridCellDecoration[] = [];
const _EMPTY_ROW_DECS: readonly GridRowDecoration[] = [];
