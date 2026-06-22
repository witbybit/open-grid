import { GridEventName } from '../api/GridEvents.js';
import { getValueByPath } from '../columnDef.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import type { DataModel } from '../models/DataModel.js';
import type { RowModel } from '../rowModel.js';
import { canEditCell } from '../visualRow.js';
import type { GridCapabilityAction, GridCapabilityParams, GridCapabilityResult } from '../capabilities/capabilityTypes.js';

export interface EditingFeatureControllerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	data: DataModel<TRowData>;
	notifyCellChange: (rowId: string, colField: string) => void;
	validateCellPostCommit?: (rowId: string, colField: string) => Promise<void>;
	checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;
}

export class EditingFeatureController<TRowData = unknown> {
	private readonly ctx: GridFeatureContext<TRowData>;
	private readonly getRowModel: () => RowModel<TRowData> | null;
	private readonly data: DataModel<TRowData>;
	private readonly notifyCellChange: (rowId: string, colField: string) => void;
	private readonly validateCellPostCommit?: (rowId: string, colField: string) => Promise<void>;
	private readonly checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;

	constructor(deps: EditingFeatureControllerDeps<TRowData>) {
		this.ctx = deps.ctx;
		this.getRowModel = deps.getRowModel;
		this.data = deps.data;
		this.notifyCellChange = deps.notifyCellChange;
		this.validateCellPostCommit = deps.validateCellPostCommit;
		this.checkCapability = deps.checkCapability;
	}

	private canEditCell(rowId: string, colField: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return canEditCell(visualRow, this.ctx.columns.getColumnDef(colField));
	}

	public startEdit(rowId: string, colField: string): void {
		if (!this.canEditCell(rowId, colField)) return;
		if (this.checkCapability) {
			const result = this.checkCapability('edit', { rowId, colField, source: 'api' });
			if (!result.allowed) return;
		}
		this.ctx.applyChange({
			reason: 'editing:start',
			state: { activeEdit: { rowId, colField } },
			invalidations: [
				{ kind: 'cell', rowId, colId: colField, reason: 'edit started' },
				{ kind: 'overlay', reason: 'edit started' },
			],
			domains: ['editing'],
			events: [{ type: GridEventName.editStarted, payload: { rowId, colField } }],
		});
		this.notifyCellChange(rowId, colField);
	}

	public stopEdit(cancel = false): void {
		const activeEdit = this.ctx.getState().activeEdit;
		if (!activeEdit) return;

		const { rowId, colField } = activeEdit;
		this.ctx.applyChange({
			reason: 'editing:stop',
			state: { activeEdit: null },
			invalidations: [
				{ kind: 'cell', rowId, colId: colField, reason: 'edit stopped' },
				{ kind: 'overlay', reason: 'edit stopped' },
			],
			domains: ['editing'],
			events: [{ type: GridEventName.editStopped, payload: { rowId, colField, cancel } }],
		});
		this.notifyCellChange(rowId, colField);
	}

	public async commitEdit(rowId: string, colField: string, value: unknown): Promise<boolean> {
		if (this.checkCapability) {
			const result = this.checkCapability('edit', { rowId, colField });
			if (!result.allowed) return false;
		}
		const col = this.ctx.columns.getColumnDef(colField);
		const oldValue = this.data.getRawCellValue(rowId, colField);
		const node = this.getRowModel()?.getRowNodeById(rowId);
		const row = node?.data ?? ({} as TRowData);

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
				{ kind: 'cell', rowId, colId: colField, reason: 'edit stopped' },
				{ kind: 'overlay', reason: 'edit stopped' },
			],
			domains: ['editing'],
			events: [{ type: GridEventName.editStopped, payload: { rowId, colField, cancel: false } }],
		});

		if (result.status !== 'committed' && result.status !== 'noop') {
			return false;
		}

		this.notifyCellChange(rowId, colField);
		await this.validateCellPostCommit?.(rowId, colField);
		return true;
	}
}
