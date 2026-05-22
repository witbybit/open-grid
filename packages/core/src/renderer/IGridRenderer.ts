import type { ColumnDef, RowNode } from '../store.js';

/**
 * Protocol that any physical grid renderer must implement.
 * This abstracts DOM operations out of the core engine,
 * enabling Canvas/WebGL renderer swap-outs in the future.
 */
export interface IGridRenderer {
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
	onMountReactPortal?: (cellKey: string, container: HTMLElement, value: unknown, node: RowNode, col: ColumnDef, isEditing: boolean, isLoading: boolean) => void;

	/**
	 * Optional hook for frameworks (like React) to unmount custom portaled cells.
	 */
	onUnmountReactPortal?: (cellKey: string) => void;
}
