/**
 * Column definition types, cell renderer interfaces, and path utilities.
 */
import type { RowNode } from './rowNode.js';
import type { CellEditorProps, CellRendererProps, HeaderMenuRendererProps, GridSelectionState } from './api/GridApi.js';
import type { GroupVisualRow, DetailVisualRow } from './visualRow.js';
import type { GridCapabilityCallback } from './capabilities/capabilityTypes.js';

// ─── Value getter / setter / validator params ─────────────────────────────────

export interface ValueGetterParams<TRowData = unknown> {
	node: RowNode<TRowData>;
	row: TRowData;
	colField: string;
}

export interface TooltipParams<TRowData = unknown> {
	row: TRowData;
	rowId: string;
	colField: string;
	value: unknown;
}

export interface ValueSetterParams<TRowData = unknown> {
	value: unknown;
	oldValue: unknown;
	row: TRowData;
	colField: string;
	/** Call to signal that the server rejected the value and the grid should roll back. */
	abort: () => void;
}

// ─── Cell renderer phase + capabilities ──────────────────────────────────────

export type CellRendererPhase = 'initial' | 'scroll' | 'scroll-idle' | 'interaction' | 'edit' | 'destroy';

export interface CellRendererCapabilities {
	/**
	 * Controls how the portal is updated while the grid is actively scrolling.
	 *
	 * - `'live'`  — Re-render with fresh data on every scroll frame (great for real-time feeds,
	 *               cheap components). The portal is kept alive and updated in-place.
	 * - `'defer'` — Keep the portal alive and frozen during scroll; refresh only when the row's
	 *               data version changes (default for most static or expensive renderers).
	 *
	 * Both modes always show the full React component — the grid never strips content during scroll.
	 */
	scrollBehavior?: 'live' | 'defer';
	/**
	 * When true, the grid calls ref.current.update() directly — bypasses React's scheduler entirely.
	 * Cell renderer must be a forwardRef component exposing ImperativeCellHandle.
	 * Ideal for real-time feeds (tick data, live prices) where even setState latency is too high.
	 */
	imperativeUpdate?: boolean;
	/**
	 * Returns a cheap plain-text representation of the cell value for use as a scroll impostor.
	 *
	 * Called during the pre-scroll prewarm pass and at scroll-frame synthesis time when the grid
	 * needs a text stand-in for a not-yet-mounted portal (scrollBehavior:'live' or imperativeUpdate
	 * columns). The string is shown in place of the full renderer while the grid is in motion;
	 * the real renderer is mounted in the post-scroll fidelity lane.
	 *
	 * Return an empty string to fall back to the generic display-value text.
	 * Leave undefined to skip the impostor contract entirely (renderer is mounted synchronously).
	 */
	scrollImpostor?: (params: { value: unknown; formattedValue: string }) => string;
	/**
	 * Controls what the scroll impostor looks like when the cell is not live during scroll.
	 *
	 * - `'html'` — After each fidelity render the grid captures the portal host's innerHTML and
	 *              stores it in the cell display snapshot. During the next scroll, that static HTML
	 *              is injected as an inert visual clone rather than plain text. The cell looks
	 *              identical to its settled state while the grid is in motion.
	 *
	 * Leave undefined (default) for the standard plain-text impostor — fastest, but shows only
	 * the raw display value string during scroll (no badge styling, colors, or icons).
	 *
	 * Only meaningful for columns that also have scrollImpostor defined (or a scrollBehavior that
	 * activates the impostor path). Cells that have never completed a fidelity render fall back
	 * to plain text until their first post-scroll upgrade.
	 */
	scrollSnapshot?: 'html';
}

// ─── Imperative handle ────────────────────────────────────────────────────────

/** Exposed via forwardRef on renderers with cellRendererCapabilities.imperativeUpdate = true */
export interface ImperativeCellHandle<TRowData = unknown> {
	update(params: CellRendererProps<TRowData>): void;
}

// ─── DOM cell renderer ────────────────────────────────────────────────────────

/** Parameters passed to DomCellRenderer.mount() and DomCellRendererHandle.update() */
export interface DomCellRendererParams<TRowData = unknown> {
	container: HTMLElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isScrolling: boolean;
	phase: CellRendererPhase;
	isFocused: boolean;
	isSelected: boolean;
}

/** Handle returned by DomCellRenderer.mount() — grid calls update() directly in the paint loop */
export interface DomCellRendererHandle {
	update(params: DomCellRendererParams<any>): void;
	destroy?(): void;
}

/**
 * Zero-React-overhead cell renderer. Grid calls mount() once and update() on every data change.
 * No virtual DOM, no scheduler, no reconciler — pure DOM manipulation.
 *
 * @example
 * const priceRenderer: DomCellRenderer<MyRow> = {
 *   mount(container, params) {
 *     const span = document.createElement('span');
 *     span.textContent = String(params.value);
 *     container.appendChild(span);
 *     return { update(p) { span.textContent = String(p.value); } };
 *   }
 * };
 */
export interface DomCellRenderer<TRowData = unknown> {
	mount(container: HTMLElement, params: DomCellRendererParams<TRowData>): DomCellRendererHandle;
	capabilities?: CellRendererCapabilities;
}

/** Type guard — returns true when renderer is a DomCellRenderer (has a mount function) */
export function isDomCellRenderer<TRowData = unknown>(renderer: unknown): renderer is DomCellRenderer<TRowData> {
	return typeof renderer === 'object' && renderer !== null && typeof (renderer as DomCellRenderer).mount === 'function';
}

// ─── Column renderer spec ─────────────────────────────────────────────────────

export type ColumnRendererSpec<TRowData = unknown> =
	| { kind: 'text' }
	| { kind: 'dom'; renderer: DomCellRenderer<TRowData>; capabilities?: CellRendererCapabilities }
	| { kind: 'react'; component: unknown; capabilities?: CellRendererCapabilities }
	| { kind: 'imperativeReact'; component: unknown; capabilities?: CellRendererCapabilities };

// ─── Column render plan (produced by ColumnModel) ─────────────────────────────

export type ColumnRenderMode =
	| 'primitive' // No renderer; raw/text value only
	| 'primitive-formatted' // No renderer; value goes through a getter or formatter
	| 'custom-live' // React portal refreshed every scroll frame (scrollBehavior:'live')
	| 'custom' // React portal frozen during scroll; refreshed only on data change
	| 'custom-dom' // DomCellRenderer — direct DOM manipulation, no React overhead
	| 'custom-imperative' // React portal with imperativeUpdate protocol
	| 'loading'; // Loading skeleton row

export interface ColumnRenderPlan<TData = unknown> {
	colId: string;
	field: string;
	mode: ColumnRenderMode;
	/** True when the column uses a custom cell renderer (mode starts with 'custom'). Pre-computed to avoid string.startsWith on the hot scroll path. */
	isCustom: boolean;
	hasValueGetter: boolean;
	hasFormatter: boolean;
	hasFormulaSupport: boolean;
	canUseCachedDisplayValue: boolean;
}

export interface CompiledGridPlan<TData = unknown> {
	version: number;
	columns: InternalColumnDef<TData>[];
	displayedColumns: InternalColumnDef<TData>[];
	columnPlans: ColumnRenderPlan<TData>[];
	colFields: string[];
	colWidths: ArrayLike<number>;
	colLefts: ArrayLike<number>;
	totalWidth: number;
	pinLeftCount: number;
	pinRightCount: number;
	pinRightStart: number;
	pinLeftWidth: number;
	pinRightWidth: number;
	pinRightBaseLeft: number;
	hasCustomRenderers: boolean;
	hasDomRenderers: boolean;
	hasFormattedValues: boolean;
	hasValueGetters: boolean;
}

// ─── Column definition ────────────────────────────────────────────────────────

export interface CellCopyParams<TRowData = unknown> {
	rowId: string;
	colField: string;
	value: unknown;
	row: TRowData;
}

export interface CellPasteParams<TRowData = unknown> {
	rowId: string;
	colField: string;
	pastedText: string;
	row: TRowData;
}

export interface ValueFormatterParams<TRowData = unknown> {
	/** The raw cell value (from field, valueGetter, or formula). */
	value: unknown;
	/** The complete row data object. */
	rowData: TRowData;
	/** The column definition. */
	colDef: ColumnDef<TRowData>;
	/** The row ID. */
	rowId: string;
}

export interface ColumnDef<TRowData = unknown> {
	field: string;
	header: string;
	width?: number;
	/** Named column type registered via `columnTypes` on the grid options. Resolved in the React layer. */
	type?: string;
	hide?: boolean;
	loading?: boolean;
	valueGetter?: (params: ValueGetterParams<TRowData>) => unknown;
	valueGetterDependencies?: string[];
	/**
	 * Converts the raw cell value (from field, valueGetter, or formula) into a display string.
	 * Used by: default text renderer, CSV export, tooltip (when no custom tooltip is set),
	 * and the `formattedValue` prop passed to custom React cell renderers.
	 *
	 * @example
	 * valueFormatter: ({ value }) => value != null ? `$${Number(value).toFixed(2)}` : ''
	 */
	valueFormatter?: (params: ValueFormatterParams<TRowData>) => string;
	/**
	 * Called during commit to apply the value to the row's data object.
	 * Sync: return false to reject. Async: return Promise<false> to reject after optimistic update.
	 * Call params.abort() to trigger an immediate rollback.
	 * Breaking change from v1: params object replaces the old (row, value) signature.
	 */
	valueSetter?: (params: ValueSetterParams<TRowData>) => boolean | Promise<boolean>;
	renderer?: ColumnRendererSpec<TRowData>;
	cellEditor?: (props: CellEditorProps<TRowData>) => unknown;
	headerMenuRenderer?: (props: HeaderMenuRendererProps<TRowData>) => void;
	headerMenuComponent?: any;
	sortable?: boolean;
	/** When false, this column cannot be added to the row grouping. Defaults to true. */
	enableRowGroup?: boolean;
	/** Set to true to hide/disable the header menu for this column. Defaults to false. */
	suppressHeaderMenu?: boolean;
	/** Minimum column width in pixels. Enforced during resize. */
	minWidth?: number;
	/** Maximum column width in pixels. Enforced during resize. */
	maxWidth?: number;
	/**
	 * Cell tooltip. Shown as a native browser tooltip on hover.
	 * Pass a string for a static tooltip, or a function for dynamic tooltips based on cell value/row data.
	 */
	tooltip?: string | ((params: TooltipParams<TRowData>) => string | null);
	/**
	 * Initial pin side for this column. Pinned-left columns should come first in the
	 * columns array; pinned-right columns should come last.
	 * Only applied at grid initialization — use api.setPinnedColumns() for runtime changes.
	 */
	pinned?: 'left' | 'right';
	/** Override the clipboard text for this cell on copy. Return the string to write. */
	onCopy?: (params: CellCopyParams<TRowData>) => string;
	/** Transform pasted text before setting the cell value. Return the value to write. */
	onPaste?: (params: CellPasteParams<TRowData>) => unknown;
	/** When true, renders a checkbox in this column for row multi-select */
	checkboxSelection?: boolean;
	/**
	 * One or more group header labels for this column.
	 * A string places the column under a single group band.
	 * An array places it under nested groups from outermost to innermost
	 * (e.g. `['Financials', 'Revenue']` → Financials > Revenue > this leaf).
	 */
	headerGroup?: string | string[];
	/**
	 * Rich filter definition for this column. Supersedes `filterType` and `filterValues`.
	 * Supports multi-select, single-select, async-*, infinite-*, and fully custom React UI.
	 * Backwards-compatible — existing filterType/filterValues still work and are normalised
	 * to filterDef internally.
	 */
	filterDef?: import('./filters/filterDef.js').ColumnFilterDef<TRowData>;
	/**
	 * Filter UI type shown for this column in the sidebar and header menu.
	 * Defaults to `'text'`. Use `'none'` to hide the filter UI for this column.
	 * @deprecated Prefer filterDef.type — this field is normalised into filterDef on mount.
	 */
	filterType?: 'text' | 'number' | 'date' | 'set' | 'none';
	/**
	 * For set filter: explicit list of selectable values.
	 * When omitted, distinct values are derived from row data via `api.getColumnDistinctValues()`.
	 * @deprecated Prefer filterDef.options — this field is normalised into filterDef on mount.
	 */
	filterValues?: (string | number | null)[];
	/**
	 * Custom floating filter renderer for this column.
	 * Receives a `FloatingFilterRendererParams` object and must populate `eCell`.
	 * When omitted, the default input (text / number / date / set badge) is used.
	 * @deprecated Prefer filterDef.renderFloatingFilter for React-based renderers.
	 */
	floatingFilterRenderer?: (params: import('./renderer/floatingFilterRenderer.js').FloatingFilterRendererParams<TRowData>) => void;
	/**
	 * Prevent cell range selection from starting when the user clicks on cells in this column.
	 * Useful for action / checkbox / drag-handle columns.
	 */
	disableCellRangeSelection?: boolean;
	/**
	 * Marks this column as required for data-quality purposes.
	 * Does not block editing — use `GridDataIntegrityManager.validation` cell rules to enforce hard constraints.
	 */
	required?: boolean;

	// ── Column-level capability callbacks ────────────────────────────────────────
	/** Return false / { allowed: false } to make this column read-only. */
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
	/**
	 * When defined, this column shows a row-drag handle. The callback is called per row to
	 * conditionally show/hide the handle (return false to hide for a specific row).
	 */
	canDrag?: GridCapabilityCallback<TRowData>;
	/** Return false / { allowed: false } to prevent header drag-reordering for this column. */
	canMoveColumn?: GridCapabilityCallback<TRowData>;
	canExport?: GridCapabilityCallback<TRowData>;
}

/**
 * @internal
 * Internal column definition — extends the public ColumnDef with normalised renderer fields
 * produced by ColumnModel.normalizeColumn(). Never expose these on the public ColumnDef.
 */
export interface InternalColumnDef<TRowData = unknown> extends ColumnDef<TRowData> {
	cellRenderer?: ((props: CellRendererProps<TRowData>) => unknown) | DomCellRenderer<TRowData>;
	cellRendererCapabilities?: CellRendererCapabilities;
}

// ─── Style slots ──────────────────────────────────────────────────────────────

export interface GridRowClassParams<TRowData = unknown> {
	row: TRowData;
	rowId: string;
	rowIndex: number;
	isFocused: boolean;
	isSelected: boolean;
	isLoading: boolean;
	selection: GridSelectionState;
}

export interface GridCellClassParams<TRowData = unknown> {
	row: TRowData;
	rowId: string;
	rowIndex: number;
	col: ColumnDef<TRowData>;
	colField: string;
	colIndex: number;
	isFocused: boolean;
	isRowFocused: boolean;
	isRowSelected: boolean;
	isSelected: boolean;
	isEditing: boolean;
	value: unknown;
	rawValue: unknown;
	isLoading: boolean;
	selection: GridSelectionState;
}

export interface RowStyleRule<TRowData = unknown> {
	kind: 'row';
	when: (row: TRowData, params: GridRowClassParams<TRowData>) => boolean;
	rowClass: string;
}

export interface GroupRowStyleRule<TRowData = unknown> {
	kind: 'groupRow';
	when?: (visualRow: GroupVisualRow<TRowData>) => boolean;
	rowClass: string;
}

export interface DetailRowStyleRule<TRowData = unknown> {
	kind: 'detailRow';
	when?: (visualRow: DetailVisualRow<TRowData>) => boolean;
	rowClass: string;
}

export interface CellStyleRule<TRowData = unknown> {
	kind: 'cell';
	field?: string;
	when: (row: TRowData, col: ColumnDef<TRowData>, params: GridCellClassParams<TRowData>) => boolean;
	cellClass: string;
}

export interface HeaderCellStyleRule<TRowData = unknown> {
	kind: 'headerCell';
	field?: string;
	when: (col: ColumnDef<TRowData>) => boolean;
	headerCellClass: string;
}

export type GridStyleRule<TRowData = unknown> =
	| RowStyleRule<TRowData>
	| GroupRowStyleRule<TRowData>
	| DetailRowStyleRule<TRowData>
	| CellStyleRule<TRowData>
	| HeaderCellStyleRule<TRowData>;

// ─── Path utilities ───────────────────────────────────────────────────────────

export function getValueByPath(obj: unknown, path: string): unknown {
	if (!obj || typeof obj !== 'object' || !path) return undefined;
	const record = obj as Record<string, unknown>;
	if (!path.includes('.')) return record[path];
	return path.split('.').reduce((acc: unknown, part) => {
		if (acc && typeof acc === 'object') {
			return (acc as Record<string, unknown>)[part];
		}
		return undefined;
	}, obj);
}

export function setValueByPath(obj: unknown, path: string, value: unknown): boolean {
	if (!obj || typeof obj !== 'object' || !path) return false;
	const record = obj as Record<string, unknown>;
	if (!path.includes('.')) {
		record[path] = value;
		return true;
	}
	const parts = path.split('.');
	let curr = record;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!curr[part] || typeof curr[part] !== 'object') {
			curr[part] = {};
		}
		curr = curr[part] as Record<string, unknown>;
	}
	curr[parts[parts.length - 1]] = value;
	return true;
}

const pathGetterCache = new Map<string, (data: unknown) => unknown>();

export function compilePathGetter(path: string): (data: unknown) => unknown {
	if (!path) return () => undefined;
	if (pathGetterCache.has(path)) return pathGetterCache.get(path)!;

	let getter: (data: unknown) => unknown;
	if (!path.includes('.')) {
		getter = (data: unknown) => (data && typeof data === 'object' ? (data as Record<string, unknown>)[path] : undefined);
	} else {
		const parts = path.split('.');
		getter = (data: unknown) => {
			let curr: unknown = data;
			for (let i = 0; i < parts.length; i++) {
				if (curr === null || curr === undefined || typeof curr !== 'object') return undefined;
				curr = (curr as Record<string, unknown>)[parts[i]];
			}
			return curr;
		};
	}
	pathGetterCache.set(path, getter);
	return getter;
}

/**
 * Validates column definitions before they are applied to the grid.
 * Throws early with a clear message rather than silently producing broken layout.
 */
export function validateColumns<TRowData>(columns: ColumnDef<TRowData>[]): void {
	const seen = new Set<string>();

	for (const column of columns) {
		const id = column.field;

		if (!id) {
			throw new Error('Open Grid: every column must have a non-empty field.');
		}

		if (seen.has(id)) {
			throw new Error(`Open Grid: duplicate column field "${id}". Each column must have a unique field.`);
		}

		seen.add(id);

		if (column.width != null && (!Number.isFinite(column.width) || column.width <= 0)) {
			throw new Error(`Open Grid: invalid width for column "${id}". Width must be a positive finite number, got ${column.width}.`);
		}
	}
}
