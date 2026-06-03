import type { ColumnDef, RowNode, VisualRow } from '../store.js';

export interface GridCellContentMount<TRowData = unknown> {
	cellKey: string;
	container: HTMLElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
}

export interface GridCellContentUnmount {
	cellKey: string;
	container?: HTMLElement;
	flushSync?: boolean;
}

export interface GridCellContentFlush {
	flushSync?: boolean;
}

export interface GridRowContentMount<TRowData = unknown> {
	rowKey: string;
	container: HTMLElement;
	visualRow: VisualRow<TRowData>;
}

export interface GridRowContentUnmount {
	rowKey: string;
	container?: HTMLElement;
}

/**
 * Contract for the component that owns physical grid rendering.
 */
export interface IGridRenderer<TRowData = unknown> {
	/**
	 * Mounts the physical representation of the grid into a host container.
	 */
	mount(container: HTMLElement): void;

	/**
	 * Unmounts the grid and cleans up all rendering resources.
	 */
	unmount(): void;

	/**
	 * Requests an asynchronous paint during the next animation frame.
	 */
	schedulePaint(): void;

	scheduleFullPaint(reason?: string): void;
	scheduleViewportPaint(reason?: string): void;
	scheduleHeaderPaint(reason?: string): void;
	scheduleOverlayPaint(reason?: string): void;
	scheduleCellPaint(rowId: string, colId: string, reason?: string): void;
	scheduleRowPaint(rowId: string, reason?: string): void;
	scheduleColumnPaint(colId: string, reason?: string): void;
	scheduleGeometryPaint(reason?: string): void;

	/**
	 * Requests a synchronous, immediate full paint of the grid viewport.
	 */
	fullPaint(): void;

	/**
	 * Optional hook for framework adapters to mount custom cell content.
	 */
	onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;

	/**
	 * Optional hook for framework adapters to unmount custom cell content.
	 */
	onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;

	/**
	 * Optional hook for framework adapters to mount custom row content.
	 */
	onMountRowContent?: (mount: GridRowContentMount<TRowData>) => void;

	/**
	 * Optional hook for framework adapters to unmount custom row content.
	 */
	onUnmountRowContent?: (unmount: GridRowContentUnmount) => void;

	/**
	 * Optional hook for framework adapters to mount custom header menu popovers.
	 */
	onMountHeaderMenu?: (mount: GridHeaderMenuMount<TRowData>) => void;

	/**
	 * Optional hook for framework adapters to unmount custom header menu popovers.
	 */
	onUnmountHeaderMenu?: (unmount: GridHeaderMenuUnmount) => void;
}

export interface GridHeaderMenuMount<TRowData = unknown> {
	colField: string;
	container: HTMLElement;
	column: ColumnDef<TRowData>;
	close: () => void;
}

export interface GridHeaderMenuUnmount {
	colField: string;
	container?: HTMLElement;
}
