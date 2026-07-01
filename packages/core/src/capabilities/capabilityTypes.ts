import type { ColumnDef } from '../columnDef.js';

// ── Actions ───────────────────────────────────────────────────────────────────

export type GridCapabilityAction =
	| 'edit'
	| 'select'
	| 'copy'
	| 'paste'
	| 'group'
	| 'fill'
	| 'sort'
	| 'filter'
	| 'pin'
	| 'resize'
	| 'delete'
	| 'expand'
	| 'drag'
	| 'moveColumn'
	| 'export';

// ── Params and result ─────────────────────────────────────────────────────────

export interface GridCapabilityParams<TRowData = unknown> {
	readonly action: GridCapabilityAction;
	readonly rowId?: string;
	readonly colField?: string;
	readonly row?: TRowData;
	readonly column?: ColumnDef<TRowData>;
	readonly value?: unknown;
	readonly source?: 'api' | 'keyboard' | 'mouse' | 'paste' | 'fill' | 'menu' | 'panel' | 'export';
}

export interface GridCapabilityResult {
	readonly allowed: boolean;
	readonly reason?: string;
	readonly mode?: 'enabled' | 'disabled' | 'hidden' | 'readonly';
}

export type GridCapabilityCallback<TRowData = unknown> = (params: GridCapabilityParams<TRowData>) => boolean | GridCapabilityResult;

// ── Grid-level capabilities config ───────────────────────────────────────────

export interface GridCapabilitiesConfig<TRowData = unknown> {
	canEdit?: GridCapabilityCallback<TRowData>;
	canSelect?: GridCapabilityCallback<TRowData>;
	canCopy?: GridCapabilityCallback<TRowData>;
	canPaste?: GridCapabilityCallback<TRowData>;
	canGroup?: GridCapabilityCallback<TRowData>;
	canFill?: GridCapabilityCallback<TRowData>;
	canSort?: GridCapabilityCallback<TRowData>;
	canFilter?: GridCapabilityCallback<TRowData>;
	canPin?: GridCapabilityCallback<TRowData>;
	canResize?: GridCapabilityCallback<TRowData>;
	canDelete?: GridCapabilityCallback<TRowData>;
	canExpand?: GridCapabilityCallback<TRowData>;
	canDrag?: GridCapabilityCallback<TRowData>;
	canMoveColumn?: GridCapabilityCallback<TRowData>;
	canExport?: GridCapabilityCallback<TRowData>;
	/** Generic fallback — checked last if no action-specific callback matched. */
	canPerformAction?: GridCapabilityCallback<TRowData>;
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

export interface CapabilityDiagnostics {
	readonly deniedActions: number;
	readonly lastDeniedAction?: {
		action: GridCapabilityAction;
		rowId?: string;
		colField?: string;
		reason?: string;
	};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeCapabilityResult(result: boolean | GridCapabilityResult): GridCapabilityResult {
	if (typeof result === 'boolean') return { allowed: result };
	return result;
}

export const CAPABILITY_ALLOWED: GridCapabilityResult = { allowed: true };
