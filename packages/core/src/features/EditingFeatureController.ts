import { GridEventName } from '../api/GridEvents.js';
import { getValueByPath } from '../columnDef.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { DataModel } from '../models/DataModel.js';
import type { RowModel } from '../rowModel.js';
import { canEditCell } from '../visualRow.js';
import type { GridCapabilityAction, GridCapabilityParams, GridCapabilityResult } from '../capabilities/capabilityTypes.js';
import type { GridIntegrityIssue } from './dataIntegrity/integrityTypes.js';
import type { GridEventPayloadMap } from '../api/GridEvents.js';
import { dispatchWriteBlockedEvent } from './writeBlockedEvent.js';
import type { ActiveEditState } from '../api/GridApi.js';

export interface EditingFeatureControllerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
	notifyCellChange: (rowId: string, colField: string, includeRenderInvalidation?: boolean, renderColId?: string) => void;
	validateCommittedCells?: (
		cells: readonly { rowId: string; colField: string }[],
		source: 'edit' | 'api' | 'fill' | 'paste' | 'undo' | 'redo'
	) => Promise<void>;
	validateWriteProposal?: (
		updates: readonly { rowId: string; colField: string; proposedValue: unknown }[],
		source: 'edit' | 'api' | 'fill' | 'paste' | 'undo' | 'redo'
	) => Promise<readonly GridIntegrityIssue[]>;
	checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;
	dispatchEvent: <K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]) => void;
}

export class EditingFeatureController<TRowData = unknown> {
	private editVersion = 0;
	private readonly ctx: GridFeatureContext<TRowData>;
	private readonly getRowModel: () => RowModel<TRowData> | null;
	private readonly data: DataModel<TRowData>;
	private readonly notifyCellChange: (rowId: string, colField: string, includeRenderInvalidation?: boolean, renderColId?: string) => void;
	private readonly validateCommittedCells?: (
		cells: readonly { rowId: string; colField: string }[],
		source: 'edit' | 'api' | 'fill' | 'paste' | 'undo' | 'redo'
	) => Promise<void>;
	private readonly validateWriteProposal?: (
		updates: readonly { rowId: string; colField: string; proposedValue: unknown }[],
		source: 'edit' | 'api' | 'fill' | 'paste' | 'undo' | 'redo'
	) => Promise<readonly GridIntegrityIssue[]>;
	private readonly checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;
	private readonly dispatchEvent: EditingFeatureControllerDeps<TRowData>['dispatchEvent'];

	constructor(deps: EditingFeatureControllerDeps<TRowData>) {
		this.ctx = deps.ctx;
		this.getRowModel = deps.getRowModel;
		this.data = deps.data;
		this.notifyCellChange = deps.notifyCellChange;
		this.validateCommittedCells = deps.validateCommittedCells;
		this.validateWriteProposal = deps.validateWriteProposal;
		this.checkCapability = deps.checkCapability;
		this.dispatchEvent = deps.dispatchEvent;
	}

	private canEditCell(rowId: string, colFieldOrInstanceId: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return canEditCell(visualRow, this.ctx.columns.getColumnByFieldOrInstanceId(colFieldOrInstanceId));
	}

	private doesEditIdentityMatch(activeEdit: ActiveEditState, rowId: string, colFieldOrInstanceId: string): boolean {
		if (activeEdit.rowId !== rowId) return false;
		return (
			activeEdit.columnInstanceId === colFieldOrInstanceId ||
			activeEdit.colId === colFieldOrInstanceId ||
			activeEdit.colField === colFieldOrInstanceId
		);
	}

	public startEdit(rowId: string, colFieldOrInstanceId: string, source: 'keyboard' | 'mouse' | 'api' = 'api'): void {
		if (!this.canEditCell(rowId, colFieldOrInstanceId)) return;
		const column = this.ctx.columns.getColumnByFieldOrInstanceId(colFieldOrInstanceId);
		if (!column) return;
		const colField = column.field;
		const originalValue = this.data.getRawCellValue(rowId, colField);
		const version = ++this.editVersion;
		if (this.checkCapability) {
			const result = this.checkCapability('edit', { rowId, colField, source });
			if (!result.allowed) return;
		}
		this.ctx.applyChange({
			reason: 'editing:start',
			state: {
				activeEdit: {
					rowId,
					colField: column.field,
					colId: column.colId ?? column.field,
					columnInstanceId: column.instanceId,
					originalValue,
					draftValue: originalValue,
					startedBy: source,
					version,
				},
			},
			invalidations: [
				{ kind: 'cell', rowId, colId: column.instanceId, reason: 'edit started' },
				{ kind: 'overlay', reason: 'edit started' },
			],
			domains: ['editing'],
			events: [{ type: GridEventName.editStarted, payload: { rowId, colField } }],
		});
		this.notifyCellChange(rowId, colField, false, column.instanceId);
	}

	public updateEditDraft(rowId: string, colFieldOrInstanceId: string, value: unknown): void {
		const activeEdit = this.ctx.getState().activeEdit;
		if (!activeEdit || !this.doesEditIdentityMatch(activeEdit, rowId, colFieldOrInstanceId)) return;
		if (Object.is(activeEdit.draftValue, value)) return;
		this.ctx.applyChange({
			reason: 'editing:update-draft',
			state: {
				activeEdit: {
					...activeEdit,
					draftValue: value,
				},
			},
			domains: ['editing'],
		});
	}

	public stopEdit(cancel = false): void {
		const activeEdit = this.ctx.getState().activeEdit;
		if (!activeEdit) return;

		const { rowId, colField } = activeEdit;
		this.ctx.applyChange({
			reason: 'editing:stop',
			state: { activeEdit: null },
			invalidations: [
				{ kind: 'cell', rowId, colId: activeEdit.columnInstanceId, reason: 'edit stopped' },
				{ kind: 'overlay', reason: 'edit stopped' },
			],
			domains: ['editing'],
			events: [{ type: GridEventName.editStopped, payload: { rowId, colField, cancel } }],
		});
		this.notifyCellChange(rowId, colField, false, activeEdit.columnInstanceId);
	}

	public async commitEdit(rowId: string, colFieldOrInstanceId: string, value: unknown): Promise<boolean> {
		const activeEdit = this.ctx.getState().activeEdit;
		const matchedActiveEdit = activeEdit && this.doesEditIdentityMatch(activeEdit, rowId, colFieldOrInstanceId) ? activeEdit : null;
		if (activeEdit && activeEdit.rowId === rowId && !matchedActiveEdit) return false;

		const resolvedColumn =
			(matchedActiveEdit
				? this.ctx.columns.getColumnByFieldOrInstanceId(matchedActiveEdit.columnInstanceId)
				: this.ctx.columns.getColumnByFieldOrInstanceId(colFieldOrInstanceId)) ?? null;
		if (!resolvedColumn) return false;
		const colField = resolvedColumn.field;
		const renderColId = matchedActiveEdit?.columnInstanceId ?? resolvedColumn.instanceId;

		if (this.checkCapability) {
			const result = this.checkCapability('edit', { rowId, colField, source: matchedActiveEdit?.startedBy ?? 'api' });
			if (!result.allowed) {
				dispatchWriteBlockedEvent(
					this.dispatchEvent,
					'edit',
					{ status: 'capabilityDenied', reason: result.reason ?? 'edit blocked by capability policy' },
					[{ rowId, colField }]
				);
				return false;
			}
		}
		const col = resolvedColumn;
		const oldValue = this.data.getRawCellValue(rowId, colField);
		const node = this.getRowModel()?.getRowNodeById(rowId);
		if (!node) return false;
		const row = node.data;

		let committedValue = value;
		let bypassValueSetter = false;

		if (col?.valueSetter) {
			let didAbort = false;
			const abort = () => {
				didAbort = true;
			};
			let success = true;
			const draftRow = { ...(row as Record<string, unknown>) } as TRowData;
			try {
				success = await col.valueSetter({ value, oldValue, row: draftRow, colField, abort });
			} catch {
				success = false;
			}
			if (!success || didAbort) {
				return false;
			}
			committedValue = getValueByPath(draftRow, colField);
			bypassValueSetter = true;
		}

		const proposalIssues = await this.validateWriteProposal?.([{ rowId, colField, proposedValue: committedValue }], 'edit');
		if ((proposalIssues?.length ?? 0) > 0) {
			dispatchWriteBlockedEvent(
				this.dispatchEvent,
				'edit',
				{ status: 'validationFailed', reason: proposalIssues![0]?.message ?? 'blocking validation failed', issues: proposalIssues! },
				[{ rowId, colField }]
			);
			return false;
		}

		const result = this.ctx.applyChange({
			reason: 'data:set-cell-value',
			state: { activeEdit: null },
			domainMutations: [
				{
					kind: 'cell-value',
					rowId,
					colField,
					value: committedValue,
					source: 'edit',
					bypassValueSetter,
				},
			],
			invalidations: [
				{ kind: 'cell', rowId, colId: renderColId, reason: 'edit stopped' },
				{ kind: 'overlay', reason: 'edit stopped' },
			],
			domains: ['editing'],
			events: [{ type: GridEventName.editStopped, payload: { rowId, colField, cancel: false } }],
		});

		if (result.status === 'rejected') {
			dispatchWriteBlockedEvent(this.dispatchEvent, 'edit', { status: 'rejected', reason: result.reason }, [{ rowId, colField }]);
			return false;
		}

		if (result.status !== 'committed' && result.status !== 'noop') {
			return false;
		}

		this.notifyCellChange(rowId, colField, false, renderColId);
		await this.validateCommittedCells?.([{ rowId, colField }], 'edit');
		return true;
	}
}
