import type { GridCellDecoration } from '../../../insights/insightTypes.js';
import type { GridCommit } from '../../../engine/GridChangeApplier.js';
import type { GridIntegrityState } from '../../../state/GridState.js';
import type {
	GridIntegrityIssue,
	GridIntegrityModule,
	GridIntegrityRunContext,
	GridConflictIntegrityOptions,
	GridCellConflict,
	ResolveConflictOptions,
	ConflictResolutionResult,
	GridConflictSource,
	GridCommitResult,
	GridValidateCellProposalParams,
} from '../integrityTypes.js';

let _conflictSeq = 0;
function nextConflictId(): string {
	return `cfl-${++_conflictSeq}`;
}

export interface ConflictModuleDeps<TRowData> {
	applyIntegrityChange: (change: GridCommit<TRowData>) => void;
	getIntegrityState: () => GridIntegrityState<TRowData>;
	commitCellValue: (rowId: string, colField: string, value: unknown) => Promise<GridCommitResult>;
	validateCellProposal?: (params: GridValidateCellProposalParams) => Promise<readonly GridIntegrityIssue[]>;
	canEdit?: (rowId: string, colField: string) => boolean;
	requestRepaint: (cells?: Array<{ rowId: string; colField: string }>) => void;
}

export class ConflictIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'conflicts' as const;

	private options: GridConflictIntegrityOptions;

	constructor(
		options: GridConflictIntegrityOptions,
		private readonly deps: ConflictModuleDeps<TRowData>
	) {
		this.options = options;
	}

	isEnabled(): boolean {
		return this.options.enabled !== false;
	}

	getIssues(): readonly GridIntegrityIssue[] {
		const issues: GridIntegrityIssue[] = [];
		for (const conflict of this.deps.getIntegrityState().conflicts.conflicts) {
			issues.push({
				id: `conflict:${conflict.id}`,
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: conflict.rowId,
				colField: conflict.colField,
				message: conflict.message ?? `Conflict: local ${_fmt(conflict.localValue)} vs remote ${_fmt(conflict.remoteValue)}`,
				createdAt: conflict.createdAt,
				data: conflict,
			});
		}
		return issues;
	}

	clearIssues(): void {
		this.clearAllConflicts();
	}

	getDiagnostics(): unknown {
		const conflicts = this.deps.getIntegrityState().conflicts;
		return {
			enabled: this.isEnabled(),
			activeConflicts: conflicts.conflicts.length,
			resolvedConflicts: conflicts.resolvedConflicts,
			lastConflictAt: conflicts.lastConflictAt,
			validateBeforeResolve: this.options.validateBeforeResolve ?? true,
		};
	}

	run(_context: GridIntegrityRunContext<TRowData>): readonly GridIntegrityIssue[] {
		return this.getIssues();
	}

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const conflict = this.getCellConflict(rowId, colField);
		if (!conflict) return _EMPTY;
		return [
			{
				layerId: 'dataIntegrity',
				kind: 'conflict',
				severity: 'error',
				className: 'og-cell-conflict',
				title: `Conflict: local ${_fmt(conflict.localValue)} vs remote ${_fmt(conflict.remoteValue)}`,
				data: conflict,
			},
		];
	}

	addConflict(partial: Omit<GridCellConflict, 'id' | 'createdAt'>): GridCellConflict {
		const conflict: GridCellConflict = { ...partial, id: nextConflictId(), createdAt: _now() };
		this.deps.applyIntegrityChange({
			reason: 'integrity:conflict:add',
			domainMutations: [{ kind: 'integrity-upsert-conflict', conflict }],
		});
		this.deps.requestRepaint([{ rowId: conflict.rowId, colField: conflict.colField }]);
		return conflict;
	}

	getConflicts(): readonly GridCellConflict[] {
		return this.deps.getIntegrityState().conflicts.conflicts;
	}

	getCellConflict(rowId: string, colField: string): GridCellConflict | null {
		const state = this.deps.getIntegrityState().conflicts;
		const id = state.cellConflictIndex[`${rowId}\0${colField}`];
		return id ? (state.conflicts.find((conflict) => conflict.id === id) ?? null) : null;
	}

	async resolveConflict(conflictId: string, options: ResolveConflictOptions): Promise<ConflictResolutionResult> {
		const conflict = this.deps.getIntegrityState().conflicts.conflicts.find((entry) => entry.id === conflictId);
		if (!conflict) return { status: 'notFound' };

		if (this.options.checkCapabilitiesBeforeResolve !== false && this.deps.canEdit) {
			if (options.strategy !== 'local' && !this.deps.canEdit(conflict.rowId, conflict.colField)) {
				return { status: 'capabilityDenied', reason: 'Cell is not editable' };
			}
		}

		if (options.strategy === 'local') {
			this._clearConflict(conflictId, conflict);
			return { status: 'resolved' };
		}

		const valueToApply = options.strategy === 'custom' ? options.value : conflict.remoteValue;

		if (this.options.validateBeforeResolve !== false && this.deps.validateCellProposal) {
			const validationIssues = await this.deps.validateCellProposal({
				rowId: conflict.rowId,
				colField: conflict.colField,
				proposedValue: valueToApply,
				source: 'conflictResolve',
			});
			const blocking = validationIssues.filter((issue) => issue.blocking);
			if (blocking.length > 0) {
				return { status: 'validationFailed', issues: blocking };
			}
		}

		const commitResult = await this.deps.commitCellValue(conflict.rowId, conflict.colField, valueToApply);
		if (commitResult.status !== 'applied') {
			return { status: 'failed', error: commitResult.status === 'failed' ? commitResult.error : commitResult.status };
		}

		this._clearConflict(conflictId, conflict);
		return { status: 'resolved' };
	}

	clearConflict(conflictId: string): void {
		const conflict = this.deps.getIntegrityState().conflicts.conflicts.find((entry) => entry.id === conflictId);
		if (!conflict) return;
		this._clearConflict(conflictId, conflict);
	}

	clearAllConflicts(): void {
		this.deps.applyIntegrityChange({
			reason: 'integrity:conflict:clear-all',
			domainMutations: [{ kind: 'integrity-clear-conflicts' }],
		});
		this.deps.requestRepaint();
	}

	private _clearConflict(id: string, conflict: GridCellConflict): void {
		this.deps.applyIntegrityChange({
			reason: 'integrity:conflict:clear',
			domainMutations: [{ kind: 'integrity-clear-conflict', conflictId: id }],
		});
		this.deps.requestRepaint([{ rowId: conflict.rowId, colField: conflict.colField }]);
	}

	destroy(): void {
		this.clearAllConflicts();
	}
}

export function makeConflictFromStream<TRowData>(
	rowId: string,
	colField: string,
	localValue: unknown,
	remoteValue: unknown,
	source: GridConflictSource = 'liveStream'
): Omit<GridCellConflict, 'id' | 'createdAt'> {
	return {
		rowId,
		colField,
		baseValue: localValue,
		localValue,
		remoteValue,
		source,
	};
}

function _fmt(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	return String(value);
}

function _now(): number {
	return typeof performance !== 'undefined' ? Math.floor(performance.timeOrigin + performance.now()) : 0;
}

const _EMPTY: readonly GridCellDecoration[] = [];
