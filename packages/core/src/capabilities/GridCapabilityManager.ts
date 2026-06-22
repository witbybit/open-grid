import type { ColumnDef } from '../columnDef.js';
import {
	type GridCapabilityAction,
	type GridCapabilityCallback,
	type GridCapabilityParams,
	type GridCapabilityResult,
	type GridCapabilitiesConfig,
	type CapabilityDiagnostics,
	normalizeCapabilityResult,
	CAPABILITY_ALLOWED,
} from './capabilityTypes.js';

// Maps each action to the column canX prop key
const ACTION_TO_COL_PROP: Partial<Record<GridCapabilityAction, string>> = {
	edit: 'canEdit',
	select: 'canSelect',
	copy: 'canCopy',
	paste: 'canPaste',
	group: 'canGroup',
	fill: 'canFill',
	sort: 'canSort',
	filter: 'canFilter',
	pin: 'canPin',
	resize: 'canResize',
	delete: 'canDelete',
	expand: 'canExpand',
	drag: 'canDrag',
	moveColumn: 'canMoveColumn',
	export: 'canExport',
};

// Maps each action to the grid-level capabilities key
const ACTION_TO_CFG_KEY: Partial<Record<GridCapabilityAction, keyof GridCapabilitiesConfig>> = {
	edit: 'canEdit',
	select: 'canSelect',
	copy: 'canCopy',
	paste: 'canPaste',
	group: 'canGroup',
	fill: 'canFill',
	sort: 'canSort',
	filter: 'canFilter',
	pin: 'canPin',
	resize: 'canResize',
	delete: 'canDelete',
	expand: 'canExpand',
	drag: 'canDrag',
	moveColumn: 'canMoveColumn',
	export: 'canExport',
};

export class GridCapabilityManager<TRowData = unknown> {
	private deniedCount = 0;
	private lastDenied: CapabilityDiagnostics['lastDeniedAction'] | undefined;

	constructor(
		private readonly config: GridCapabilitiesConfig<TRowData>,
		private readonly getColumns: () => readonly ColumnDef<TRowData>[],
		private readonly getRow: (rowId: string) => TRowData | null
	) {}

	public can(action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>): GridCapabilityResult {
		const col = params.colField ? (this.getColumns().find((c) => c.field === params.colField) ?? params.column) : params.column;
		const row = params.rowId != null ? (params.row ?? (this.getRow(params.rowId) as TRowData | null) ?? undefined) : params.row;
		const fullParams: GridCapabilityParams<TRowData> = {
			action,
			rowId: params.rowId,
			colField: params.colField,
			value: params.value,
			source: params.source,
			column: col as ColumnDef<TRowData> | undefined,
			row: row as TRowData | undefined,
		};

		// Layer 2: column canX callback (sort/group also check boolean column props below)
		const colCbProp = ACTION_TO_COL_PROP[action];
		if (colCbProp && col) {
			const cb = (col as unknown as Record<string, unknown>)[colCbProp] as GridCapabilityCallback<TRowData> | undefined;
			if (cb) {
				const result = normalizeCapabilityResult(cb(fullParams));
				if (!result.allowed) return this._deny(result, fullParams);
			}
		}

		// Layer 2b: remaining boolean column props (sortable, enableRowGroup) that have no canX counterpart
		const boolResult = this._checkBoolColumnProp(action, col as ColumnDef<TRowData> | undefined);
		if (boolResult && !boolResult.allowed) return this._deny(boolResult, fullParams);

		// Layer 3: grid-level canX callback
		const cfgKey = ACTION_TO_CFG_KEY[action];
		if (cfgKey) {
			const cb = this.config[cfgKey] as GridCapabilityCallback<TRowData> | undefined;
			if (cb) {
				const result = normalizeCapabilityResult(cb(fullParams));
				if (!result.allowed) return this._deny(result, fullParams);
			}
		}

		// Layer 4: generic canPerformAction fallback
		if (this.config.canPerformAction) {
			const result = normalizeCapabilityResult(this.config.canPerformAction(fullParams));
			if (!result.allowed) return this._deny(result, fullParams);
		}

		return CAPABILITY_ALLOWED;
	}

	public getDiagnostics(): CapabilityDiagnostics {
		return { deniedActions: this.deniedCount, lastDeniedAction: this.lastDenied };
	}

	public resetDiagnostics(): void {
		this.deniedCount = 0;
		this.lastDenied = undefined;
	}

	private _deny(result: GridCapabilityResult, params: GridCapabilityParams<TRowData>): GridCapabilityResult {
		this.deniedCount++;
		this.lastDenied = { action: params.action, rowId: params.rowId, colField: params.colField, reason: result.reason };
		return result;
	}

	private _checkBoolColumnProp(action: GridCapabilityAction, col: ColumnDef<TRowData> | undefined): GridCapabilityResult | null {
		if (!col) return null;
		switch (action) {
			case 'sort':
				return col.sortable === false ? { allowed: false, reason: 'Column sorting is disabled', mode: 'disabled' } : null;
			case 'group':
				return col.enableRowGroup === false ? { allowed: false, reason: 'Column grouping is disabled', mode: 'disabled' } : null;
			default:
				return null;
		}
	}
}
