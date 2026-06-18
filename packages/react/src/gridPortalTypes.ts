import type { ColumnDef, GridApi, RowNode, VisualRow, CellRendererPhase } from '@open-grid/core';

export interface CellPortalPhysicalIdentity {
	rowSlotId: string;
	slotGeneration: number;
}

export interface PortalCellProps<TRowData = unknown> {
	rowId: string;
	colField: string;
	value: unknown;
	col: ColumnDef<TRowData>;
	node: RowNode<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase?: CellRendererPhase;
	isScrolling?: boolean;
	isFocused?: boolean;
	isSelected?: boolean;
}

export interface PortalData<TRowData = unknown> {
	cellKey: string;
	container: HTMLElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase?: CellRendererPhase;
	isScrolling?: boolean;
	isFocused?: boolean;
	isSelected?: boolean;
	/** Physical ownership identity for pooled cell portals. */
	physicalIdentity: CellPortalPhysicalIdentity;
}

/** Snapshot used by the optimised CellPortalPool — rebuilt only on structural changes (add/remove). */
export interface CellPortalSnapshot<TRowData = unknown> {
	cellPortalList: PortalData<TRowData>[];
}

/** Snapshot used by the RowMenuPortalPool — rebuilt only on row/menu structural changes. */
export interface RowMenuPortalSnapshot<TRowData = unknown> {
	rowPortalList: RowPortalData<TRowData>[];
	menuPortalList: MenuPortalData<TRowData>[];
}

export interface RowPortalData<TRowData = unknown> {
	rowKey: string;
	container: HTMLElement;
	visualRow: VisualRow<TRowData>;
}

export interface MenuPortalData<TRowData = unknown> {
	colField: string;
	container: HTMLElement;
	column: ColumnDef<TRowData>;
	close: () => void;
}

// Imperative updater fn — registered by ImperativePortalCellWrapper, called from the grid view layer
export type ImperativeUpdaterFn<TRowData> = (
	value: unknown,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	isEditing: boolean,
	isLoading: boolean,
	phase: CellRendererPhase | undefined,
	isScrolling: boolean | undefined,
	isFocused: boolean | undefined,
	isSelected: boolean | undefined
) => boolean;

export interface PortalStore<TRowData = unknown> {
	subscribeToCell?(cellKey: string, listener: () => void): () => void;
	getCellData?(cellKey: string): PortalData<TRowData> | undefined;
	// Optimised split subscriptions — implemented by createPortalStore
	subscribeCells?(listener: () => void): () => void;
	getCellSnapshot?(): CellPortalSnapshot<TRowData>;
	subscribeRowsMenus?(listener: () => void): () => void;
	getRowMenuSnapshot?(): RowMenuPortalSnapshot<TRowData>;
	// Imperative update protocol
	registerImperativeUpdater?(cellKey: string, fn: ImperativeUpdaterFn<TRowData>): void;
	unregisterImperativeUpdater?(cellKey: string): void;
	tryImperativeUpdate?(
		cellKey: string,
		value: unknown,
		node: RowNode<TRowData>,
		col: ColumnDef<TRowData>,
		isEditing: boolean,
		isLoading: boolean,
		phase: CellRendererPhase | undefined,
		isScrolling: boolean | undefined,
		isFocused: boolean | undefined,
		isSelected: boolean | undefined,
		physicalIdentity: CellPortalPhysicalIdentity
	): boolean;
	mountCell(
		cellKey: string,
		container: HTMLElement,
		value: unknown,
		node: RowNode<TRowData>,
		col: ColumnDef<TRowData>,
		isEditing: boolean,
		isLoading: boolean,
		phase: CellRendererPhase | undefined,
		isScrolling: boolean | undefined,
		isFocused: boolean | undefined,
		isSelected: boolean | undefined,
		physicalIdentity: CellPortalPhysicalIdentity
	): void;
	unmountCell(cellKey: string, container?: HTMLElement, sync?: boolean, physicalIdentity?: CellPortalPhysicalIdentity): void;
}

export interface PortalManagerProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	groupRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	footerRowRenderer?: (props: { visualRow: VisualRow<TRowData>; api: GridApi<TRowData> }) => React.ReactNode;
	store?: PortalStore<TRowData>;
}
