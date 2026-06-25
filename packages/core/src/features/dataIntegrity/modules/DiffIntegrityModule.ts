import type { ColumnDef } from '../../../columnDef.js';
import type { GridCommit } from '../../../engine/GridChangeApplier.js';
import type { GridIntegrityState } from '../../../state/GridState.js';
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
	applyIntegrityChange: (change: GridCommit<TRowData>) => void;
	getIntegrityState: () => GridIntegrityState<TRowData>;
	commitCellValue: (rowId: string, colField: string, value: unknown) => Promise<GridCommitResult>;
	validateCellProposal?: (params: GridValidateCellProposalParams) => Promise<readonly GridIntegrityIssue[]>;
	canEdit?: (rowId: string, colField: string) => boolean;
	requestRepaint: (cells?: Array<{ rowId: string; colField: string }>) => void;
}

export class DiffIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'diff' as const;

	private options: GridDiffIntegrityOptions;
	private lastComputedAt: number | null = null;

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
		const result = this.getDiffResult();
		if (!result) return [];
		const issues: GridIntegrityIssue[] = [];
		for (const cell of result.changedCells) {
			issues.push({
				id: `diff:changed:${cell.rowId}:${cell.colField}`,
				source: 'diff',
				type: 'diffChanged',
				severity: 'info',
				blocking: false,
				rowId: cell.rowId,
				colField: cell.colField,
				message: `Changed: ${_fmt(cell.oldValue)} -> ${_fmt(cell.newValue)}`,
				value: cell.newValue,
				createdAt: this.lastComputedAt ?? 0,
				data: cell,
			});
		}
		for (const rowId of result.addedRows) {
			issues.push({
				id: `diff:added:${rowId}`,
				source: 'diff',
				type: 'diffAdded',
				severity: 'info',
				blocking: false,
				rowId,
				message: 'Row added',
				createdAt: this.lastComputedAt ?? 0,
			});
		}
		for (const rowId of result.removedRows) {
			issues.push({
				id: `diff:removed:${rowId}`,
				source: 'diff',
				type: 'diffRemoved',
				severity: 'info',
				blocking: false,
				rowId,
				message: 'Row removed',
				createdAt: this.lastComputedAt ?? 0,
			});
		}
		return issues;
	}

	getDiagnostics(): unknown {
		const result = this.getDiffResult();
		return {
			enabled: this.isEnabled(),
			active: this.getDiffModel() !== null,
			addedRows: result?.addedRows.length ?? 0,
			removedRows: result?.removedRows.length ?? 0,
			changedRows: result?.changedRows.length ?? 0,
			changedCells: result?.changedCells.length ?? 0,
			lastComputedAt: this.lastComputedAt,
			validateChangedValues: this.options.validateChangedValues ?? false,
		};
	}

	run(_context: GridIntegrityRunContext<TRowData>): readonly GridIntegrityIssue[] {
		return this.getIssues();
	}

	setDiffModel(model: GridDiffModel<TRowData> | null): void {
		if (model === null) {
			this.deps.applyIntegrityChange({
				reason: 'integrity:diff:clear',
				domainMutations: [{ kind: 'integrity-set-diff-state', model: null, result: null, cellDiffIndex: {} }],
			});
			this.lastComputedAt = null;
			this.deps.requestRepaint();
			return;
		}

		this._validateRowIdentity(model);
		const computed = this._compute(model);
		this.lastComputedAt = _now();
		this.deps.applyIntegrityChange({
			reason: 'integrity:diff:set-model',
			domainMutations: [
				{
					kind: 'integrity-set-diff-state',
					model,
					result: computed.result,
					cellDiffIndex: computed.cellDiffIndex,
				},
			],
		});
		this.deps.requestRepaint();
	}

	getDiffModel(): GridDiffModel<TRowData> | null {
		return this.deps.getIntegrityState().diff.model;
	}

	getDiffResult(): GridDiffResult | null {
		return this.deps.getIntegrityState().diff.result;
	}

	getCellDiff(rowId: string, colField: string): GridCellDiff | null {
		return this.deps.getIntegrityState().diff.cellDiffIndex[`${rowId}\0${colField}`] ?? null;
	}

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const diff = this.getCellDiff(rowId, colField);
		if (!diff) return _EMPTY_DECS;
		if (diff.status === 'changed') {
			return [
				{
					layerId: 'dataIntegrity',
					kind: 'diffChanged',
					severity: 'warning',
					className: 'og-cell-diff-changed',
					title: `Old: ${_fmt(diff.oldValue)}\nNew: ${_fmt(diff.newValue)}`,
					data: diff,
				},
			];
		}
		if (diff.status === 'added') {
			return [{ layerId: 'dataIntegrity', kind: 'diffAdded', severity: 'info', className: 'og-cell-diff-added', data: diff }];
		}
		return _EMPTY_DECS;
	}

	getRowDecorations(rowId: string): readonly GridRowDecoration[] {
		const result = this.getDiffResult();
		if (!result) return _EMPTY_ROW_DECS;
		const decs: GridRowDecoration[] = [];
		if (result.addedRows.includes(rowId)) {
			decs.push({ layerId: 'dataIntegrity', kind: 'diffAdded', severity: 'info', className: 'og-row-diff-added', data: { rowId } });
		}
		if (result.changedRows.includes(rowId)) {
			decs.push({ layerId: 'dataIntegrity', kind: 'diffChanged', severity: 'warning', className: 'og-row-diff-changed', data: { rowId } });
		}
		return decs;
	}

	async acceptCellDiff(rowId: string, colField: string): Promise<GridDiffAcceptResult> {
		if (!this.isEnabled()) return { status: 'unsupported', reason: 'Diff module is disabled' };

		const diff = this.getCellDiff(rowId, colField);
		if (!diff) return { status: 'notFound', reason: `No diff found for ${rowId}:${colField}` };
		if (diff.status !== 'changed') return { status: 'unsupported', reason: 'Only changed-cell accept is supported' };

		if (this.deps.canEdit && !this.deps.canEdit(rowId, colField)) {
			return { status: 'capabilityDenied', reason: 'Cell is not editable' };
		}

		if (this.options.validateChangedValues && this.deps.validateCellProposal) {
			const validationIssues = await this.deps.validateCellProposal({ rowId, colField, proposedValue: diff.newValue, source: 'diffAccept' });
			const blocking = validationIssues.filter((issue) => issue.blocking);
			if (blocking.length > 0) {
				return { status: 'validationFailed', issues: blocking };
			}
		}

		const commitResult = await this.deps.commitCellValue(rowId, colField, diff.newValue);
		if (commitResult.status === 'capabilityDenied') {
			return { status: 'capabilityDenied', reason: commitResult.reason };
		}
		if (commitResult.status === 'validationFailed') {
			return { status: 'validationFailed', issues: commitResult.issues };
		}
		if (commitResult.status !== 'applied' && commitResult.status !== 'noop') {
			return {
				status: 'failed',
				error: commitResult.status === 'failed' ? commitResult.error : new Error(commitResult.reason),
			};
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
		this.deps.applyIntegrityChange({
			reason: 'integrity:diff:clear',
			domainMutations: [{ kind: 'integrity-set-diff-state', model: null, result: null, cellDiffIndex: {} }],
		});
		this.lastComputedAt = null;
		this.deps.requestRepaint();
	}

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

	private _compute(model: GridDiffModel<TRowData>): { result: GridDiffResult; cellDiffIndex: Record<string, GridCellDiff> } {
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
			fields = columns.map((column) => column.field).filter((field): field is string => !!field && !ignore.has(field));
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
		const cellDiffIndex: Record<string, GridCellDiff> = {};

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
					cellDiffIndex[`${id}\0${field}`] = diff;
				}
			}
		}

		for (const rowId of addedRows) {
			for (const field of fields) {
				const compareRow = compareMap.get(rowId);
				const newValue = compareRow ? (compareRow as Record<string, unknown>)[field] : undefined;
				cellDiffIndex[`${rowId}\0${field}`] = { rowId, colField: field, oldValue: undefined, newValue, status: 'added' };
			}
		}

		return {
			result: {
				addedRows,
				removedRows,
				changedRows: Array.from(changedRows),
				changedCells,
			},
			cellDiffIndex,
		};
	}

	clearIssues(): void {
		this.clearDiff();
	}

	private _rejectCellDiff(rowId: string, colField: string): void {
		this.deps.applyIntegrityChange({
			reason: 'integrity:diff:resolve-cell',
			domainMutations: [{ kind: 'integrity-resolve-cell-diff', rowId, colField }],
		});
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
