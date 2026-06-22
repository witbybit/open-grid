import type { GridCellDecoration } from '../../../insights/insightTypes.js';
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
	commitCellValue: (rowId: string, colField: string, value: unknown) => Promise<GridCommitResult>;
	validateCellProposal?: (params: GridValidateCellProposalParams) => Promise<readonly GridIntegrityIssue[]>;
	canEdit?: (rowId: string, colField: string) => boolean;
	requestRepaint: (cells?: Array<{ rowId: string; colField: string }>) => void;
}

export class ConflictIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'conflicts' as const;

	private options: GridConflictIntegrityOptions;
	private readonly conflicts = new Map<string, GridCellConflict>();
	private readonly cellIndex = new Map<string, string>(); // `rowId\0colField` → conflictId
	private _resolvedConflicts = 0;
	private _lastConflictAt: number | null = null;

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
		for (const conflict of this.conflicts.values()) {
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
		return {
			enabled: this.isEnabled(),
			activeConflicts: this.conflicts.size,
			resolvedConflicts: this._resolvedConflicts,
			lastConflictAt: this._lastConflictAt,
			validateBeforeResolve: this.options.validateBeforeResolve ?? true,
		};
	}

	run(_context: GridIntegrityRunContext<TRowData>): readonly GridIntegrityIssue[] {
		// Conflicts are live — return current issues
		return this.getIssues();
	}

	// ── Cell decorations ───────────────────────────────────────────────────────

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const id = this.cellIndex.get(`${rowId}\0${colField}`);
		if (!id) return _EMPTY;
		const conflict = this.conflicts.get(id);
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

	// ── Conflict management ────────────────────────────────────────────────────

	addConflict(partial: Omit<GridCellConflict, 'id' | 'createdAt'>): GridCellConflict {
		const cellKey = `${partial.rowId}\0${partial.colField}`;
		// Remove existing conflict for same cell
		const existingId = this.cellIndex.get(cellKey);
		if (existingId) this.conflicts.delete(existingId);

		const conflict: GridCellConflict = { ...partial, id: nextConflictId(), createdAt: _now() };
		this.conflicts.set(conflict.id, conflict);
		this.cellIndex.set(cellKey, conflict.id);
		this._lastConflictAt = conflict.createdAt;
		this.deps.requestRepaint([{ rowId: conflict.rowId, colField: conflict.colField }]);
		return conflict;
	}

	getConflicts(): readonly GridCellConflict[] {
		return Array.from(this.conflicts.values());
	}

	getCellConflict(rowId: string, colField: string): GridCellConflict | null {
		const id = this.cellIndex.get(`${rowId}\0${colField}`);
		return id ? (this.conflicts.get(id) ?? null) : null;
	}

	async resolveConflict(conflictId: string, options: ResolveConflictOptions): Promise<ConflictResolutionResult> {
		const conflict = this.conflicts.get(conflictId);
		if (!conflict) return { status: 'notFound' };

		// Check capability
		if (this.options.checkCapabilitiesBeforeResolve !== false && this.deps.canEdit) {
			if (options.strategy !== 'local' && !this.deps.canEdit(conflict.rowId, conflict.colField)) {
				return { status: 'capabilityDenied', reason: 'Cell is not editable' };
			}
		}

		if (options.strategy === 'local') {
			// Keep local: only clear the conflict marker, no mutation
			this._clearConflict(conflictId, conflict);
			this._resolvedConflicts++;
			return { status: 'resolved' };
		}

		const valueToApply = options.strategy === 'custom' ? options.value : conflict.remoteValue;

		// Validate the proposed value (not the current value) before commit
		if (this.options.validateBeforeResolve !== false && this.deps.validateCellProposal) {
			const validationIssues = await this.deps.validateCellProposal({
				rowId: conflict.rowId,
				colField: conflict.colField,
				proposedValue: valueToApply,
				source: 'conflictResolve',
			});
			const blocking = validationIssues.filter((i) => i.blocking);
			if (blocking.length > 0) {
				// Conflict remains — validation failed
				return { status: 'validationFailed', issues: blocking };
			}
		}

		// Commit — only clear conflict marker on success
		const commitResult = await this.deps.commitCellValue(conflict.rowId, conflict.colField, valueToApply);
		if (commitResult.status !== 'applied') {
			return { status: 'failed', error: commitResult.status === 'failed' ? commitResult.error : commitResult.status };
		}

		this._clearConflict(conflictId, conflict);
		this._resolvedConflicts++;
		return { status: 'resolved' };
	}

	clearConflict(conflictId: string): void {
		const conflict = this.conflicts.get(conflictId);
		if (!conflict) return;
		this._clearConflict(conflictId, conflict);
	}

	clearAllConflicts(): void {
		this.conflicts.clear();
		this.cellIndex.clear();
		this.deps.requestRepaint();
	}

	// ── Private ────────────────────────────────────────────────────────────────

	private _clearConflict(id: string, conflict: GridCellConflict): void {
		this.conflicts.delete(id);
		this.cellIndex.delete(`${conflict.rowId}\0${conflict.colField}`);
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
