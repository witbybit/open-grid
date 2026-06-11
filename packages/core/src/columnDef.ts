/**
 * Column definition types, cell renderer interfaces, and path utilities.
 *
 * Circular type-only imports from store.ts are intentional and safe — they are
 * erased at build time and TypeScript resolves them lazily.
 */
import type { RowNode } from './rowNode.js';
import type { CellEditorProps, CellRendererProps, HeaderMenuRendererProps, GridSelectionState, GridCellAccess } from './store.js';
import type { GroupVisualRow, DetailVisualRow } from './visualRow.js';

// ─── Value getter params ──────────────────────────────────────────────────────

export interface ValueGetterParams<TRowData = unknown> {
	node: RowNode<TRowData>;
	row: TRowData;
	colField: string;
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

export interface ColumnDef<TRowData = unknown> {
	field: string;
	header: string;
	width?: number;
	/** Named column type registered via `columnTypes` on the grid options. Resolved in the React layer. */
	type?: string;
	hide?: boolean;
	movable?: boolean;
	loading?: boolean;
	valueGetter?: (params: ValueGetterParams<TRowData>) => unknown;
	valueGetterDependencies?: string[];
	valueSetter?: (row: TRowData, value: unknown) => boolean;
	renderer?: ColumnRendererSpec<TRowData>;
	cellEditor?: (props: CellEditorProps<TRowData>) => unknown;
	headerMenuRenderer?: (props: HeaderMenuRendererProps<TRowData>) => void;
	headerMenuComponent?: any;
	sortable?: boolean;
	/** When false, this column cannot be added to the row grouping. Defaults to true. */
	enableRowGroup?: boolean;
	/** Override the clipboard text for this cell on copy. Return the string to write. */
	onCopy?: (params: CellCopyParams<TRowData>) => string;
	/** Transform pasted text before setting the cell value. Return the value to write. */
	onPaste?: (params: CellPasteParams<TRowData>) => unknown;
	/** When true, renders a checkbox in this column for row multi-select */
	checkboxSelection?: boolean;
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

export interface GridStyleSlots<TRowData = unknown> {
	rowClass?: (row: TRowData, params: GridRowClassParams<TRowData>) => string;
	cellClass?: (col: ColumnDef<TRowData>, row: TRowData, params: GridCellClassParams<TRowData>) => string;
	headerCellClass?: (col: ColumnDef<TRowData>) => string;
	beforeCellRender?: (cell: GridCellAccess<TRowData>, element: HTMLElement) => void;
	afterCellRender?: (cell: GridCellAccess<TRowData>, element: HTMLElement) => void;
	groupRowClass?: (visualRow: GroupVisualRow<TRowData>) => string;
	detailRowClass?: (visualRow: DetailVisualRow<TRowData>) => string;
}

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
