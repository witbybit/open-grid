import type { ColumnDef, RowNode } from '../store.js';

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

	/**
	 * Requests a synchronous, immediate full paint of the grid viewport.
	 */
	fullPaint(): void;

	/**
	 * Optional hook for frameworks (like React) to mount custom portaled cells.
	 */
	onMountReactPortal?: (
		cellKey: string,
		container: HTMLElement,
		value: unknown,
		node: RowNode<TRowData>,
		col: ColumnDef<TRowData>,
		isEditing: boolean,
		isLoading: boolean
	) => void;

	/**
	 * Optional hook for frameworks (like React) to unmount custom portaled cells.
	 */
	onUnmountReactPortal?: (cellKey: string, container?: HTMLElement, flushSync?: boolean) => void;
}
