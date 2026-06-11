import type { GridEngine } from '../engine/GridEngine.js';
import type { GroupPanelRenderer } from './groupPanelRenderer.js';

export interface ColumnInteractionControllerOptions<TRowData> {
	engine: GridEngine<TRowData>;
	getOverlayLayer: () => HTMLDivElement | null;
	getScrollViewport: () => HTMLDivElement | null;
	schedulePaint: () => void;
}

export class ColumnInteractionController<TRowData = unknown> {
	private engine: GridEngine<TRowData>;
	private getOverlayLayer: () => HTMLDivElement | null;
	private getScrollViewport: () => HTMLDivElement | null;
	private schedulePaint: () => void;
	private isColumnReordering = false;
	private columnDragStartX = 0;
	private columnDragStartY = 0;
	private columnDragFromIndex = -1;
	private columnDragField: string | null = null;
	private columnDropInsertionIndex = -1;
	private columnDropIndicator: HTMLDivElement | null = null;
	private columnDragGhost: HTMLDivElement | null = null;

	// Group panel reference — set by RenderEngine when panel is mounted.
	private groupPanel: GroupPanelRenderer<TRowData> | null = null;
	// Whether the current column drag is over the group panel.
	private columnDragOverGroupPanel = false;

	constructor(options: ColumnInteractionControllerOptions<TRowData>) {
		this.engine = options.engine;
		this.getOverlayLayer = options.getOverlayLayer;
		this.getScrollViewport = options.getScrollViewport;
		this.schedulePaint = options.schedulePaint;
	}

	public onHeaderResizeMouseDown = (e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();

		const headerCell = (e.currentTarget as HTMLElement).closest('.og-header-cell') as HTMLElement | null;
		const colField = headerCell?.dataset.colField;
		const colIndex = Number(headerCell?.dataset.colIndex);
		if (!colField || !Number.isFinite(colIndex)) return;

		const startX = e.clientX;
		const startWidth = this.engine.geometry.getColWidth(colIndex, this.engine.stateManager.getState().defaultColWidth);
		let currentWidth = startWidth;

		const onMouseMove = (moveEvent: MouseEvent) => {
			const deltaX = moveEvent.clientX - startX;
			currentWidth = Math.max(30, startWidth + deltaX);
			this.engine.resizeColumn(colField, currentWidth, false);
		};

		const onMouseUp = () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			this.schedulePaint();
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	};

	public onHeaderCellMouseDown = (e: MouseEvent): void => {
		if (
			e.button !== 0 ||
			(e.target as HTMLElement).closest('.og-header-resize-handle') ||
			(e.target as HTMLElement).closest('.og-header-menu-button')
		)
			return;

		const state = this.engine.stateManager.getState();
		if (!state.enableColumnReorder) return;

		const headerCell = e.currentTarget as HTMLElement;
		const colField = headerCell.dataset.colField;
		const colIndex = Number(headerCell.dataset.colIndex);
		const column = colField ? state.columns[colIndex] : null;
		if (!colField || !Number.isFinite(colIndex) || column?.movable === false) return;

		this.columnDragStartX = e.clientX;
		this.columnDragStartY = e.clientY;
		this.columnDragFromIndex = colIndex;
		this.columnDragField = colField;
		this.columnDropInsertionIndex = colIndex;

		window.addEventListener('mousemove', this.onHeaderColumnDragMove);
		window.addEventListener('mouseup', this.onHeaderColumnDragMouseUp);
		window.addEventListener('blur', this.onHeaderColumnDragMouseUp);
	};

	/** Called by RenderEngine to wire up the group panel for drag-to-group support. */
	public setGroupPanel(panel: GroupPanelRenderer<TRowData> | null): void {
		this.groupPanel = panel;
	}

	public cleanup(): void {
		window.removeEventListener('mousemove', this.onHeaderColumnDragMove);
		window.removeEventListener('mouseup', this.onHeaderColumnDragMouseUp);
		window.removeEventListener('blur', this.onHeaderColumnDragMouseUp);

		if (this.columnDragOverGroupPanel && this.groupPanel) {
			this.groupPanel.onHeaderDragLeave();
		}
		this.columnDragOverGroupPanel = false;
		this.isColumnReordering = false;
		this.columnDragFromIndex = -1;
		this.columnDragField = null;
		this.columnDropInsertionIndex = -1;
		this.removeColumnDropIndicator();
		this.removeColumnDragGhost();
		this.getScrollViewport()?.closest('.og-grid-container')?.classList.remove('og-col-reordering');
	}

	public reattachOverlays(): void {
		const overlayLayer = this.getOverlayLayer();
		if (this.isColumnReordering && this.columnDropIndicator && overlayLayer && this.columnDropIndicator.parentNode !== overlayLayer) {
			overlayLayer.appendChild(this.columnDropIndicator);
		}
	}

	public isDraggingColumn(colField: string): boolean {
		return this.isColumnReordering && this.columnDragField === colField;
	}

	private onHeaderColumnDragMove = (e: MouseEvent): void => {
		const dragDistance = Math.max(Math.abs(e.clientX - this.columnDragStartX), Math.abs(e.clientY - this.columnDragStartY));
		if (!this.isColumnReordering) {
			if (dragDistance < 4) return;
			this.isColumnReordering = true;
			this.ensureColumnDropIndicator();
			this.ensureColumnDragGhost();
			this.getScrollViewport()?.closest('.og-grid-container')?.classList.add('og-col-reordering');
			this.schedulePaint();
		}

		e.preventDefault();
		this.updateColumnDragGhost(e);

		// Route to group panel when the dragged column supports grouping and the
		// pointer is over the panel.  Hide the column drop indicator while over it.
		const colField = this.columnDragField;
		if (colField && this.groupPanel) {
			const state = this.engine.stateManager.getState();
			const col = state.columns.find((c) => c.field === colField);
			const isGroupable = col?.enableRowGroup !== false;
			const overPanel = isGroupable && this.groupPanel.containsPoint(e.clientX, e.clientY);

			if (overPanel !== this.columnDragOverGroupPanel) {
				this.columnDragOverGroupPanel = overPanel;
				if (overPanel) {
					this.groupPanel.onHeaderDragEnter(colField);
					this.columnDropIndicator && (this.columnDropIndicator.style.display = 'none');
				} else {
					this.groupPanel.onHeaderDragLeave();
					this.columnDropIndicator && (this.columnDropIndicator.style.display = '');
				}
			}
			if (overPanel) {
				this.groupPanel.onHeaderDragMove(e);
				return;
			}
		}

		this.updateColumnDropTarget(e);
	};
	private onHeaderColumnDragMouseUp = (): void => {
		const wasReordering = this.isColumnReordering;
		const fromIndex = this.columnDragFromIndex;
		const insertionIndex = this.columnDropInsertionIndex;
		const colField = this.columnDragField;
		const wasOverGroupPanel = this.columnDragOverGroupPanel;

		// Finalise group-panel drop before cleanup() clears drag state
		if (wasOverGroupPanel && this.groupPanel) {
			this.groupPanel.onHeaderDragEnd(true);
		} else if (this.groupPanel?.isHeaderDragActive()) {
			this.groupPanel.onHeaderDragEnd(false);
		}

		this.cleanup();

		if (!wasReordering && colField) {
			// Handle column header click sorting!
			const state = this.engine.stateManager.getState();
			const column = state.columns.find((c) => c.field === colField);
			if (column && column.sortable !== false) {
				const currentSort = state.sortModel?.find((s) => s.colId === colField);
				if (!currentSort) {
					this.engine.setSortModel([{ colId: colField, sort: 'asc' }]);
				} else if (currentSort.sort === 'asc') {
					this.engine.setSortModel([{ colId: colField, sort: 'desc' }]);
				} else {
					this.engine.setSortModel(null);
				}
			}
			return;
		}

		// Group panel drop was handled above — don't also reorder columns.
		if (wasOverGroupPanel) return;

		if (!wasReordering || !colField || fromIndex < 0 || insertionIndex < 0) {
			this.schedulePaint();
			return;
		}

		const state = this.engine.stateManager.getState();
		const toIndex = Math.max(0, Math.min(state.columns.length - 1, insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex));
		if (toIndex !== fromIndex) {
			this.engine.moveColumn(colField, toIndex);
		} else {
			this.schedulePaint();
		}
	};

	private ensureColumnDropIndicator(): void {
		const overlayLayer = this.getOverlayLayer();
		if (this.columnDropIndicator || !overlayLayer) return;

		this.columnDropIndicator = document.createElement('div');
		this.columnDropIndicator.className = 'og-column-drop-indicator';
		overlayLayer.appendChild(this.columnDropIndicator);
	}

	private removeColumnDropIndicator(): void {
		this.columnDropIndicator?.remove();
		this.columnDropIndicator = null;
	}

	private ensureColumnDragGhost(): void {
		if (this.columnDragGhost) return;

		const state = this.engine.stateManager.getState();
		const draggedColumn = state.columns.find((col) => col.field === this.columnDragField);
		const label = draggedColumn?.header || draggedColumn?.field || '';

		this.columnDragGhost = document.createElement('div');
		this.columnDragGhost.className = 'og-column-drag-ghost';
		// 6-dot drag-handle SVG + column label (textContent avoids XSS)
		this.columnDragGhost.innerHTML =
			'<svg class="og-drag-ghost-icon" viewBox="0 0 10 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">' +
			'<circle cx="3" cy="3.5" r="1.3"/><circle cx="7" cy="3.5" r="1.3"/>' +
			'<circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>' +
			'<circle cx="3" cy="12.5" r="1.3"/><circle cx="7" cy="12.5" r="1.3"/>' +
			'</svg>';
		const labelSpan = document.createElement('span');
		labelSpan.textContent = label;
		this.columnDragGhost.appendChild(labelSpan);
		document.body.appendChild(this.columnDragGhost);
	}

	private updateColumnDragGhost(e: MouseEvent): void {
		if (!this.columnDragGhost) return;

		this.columnDragGhost.style.transform = `translate3d(${e.clientX + 12}px, ${e.clientY + 12}px, 0)`;
	}

	private removeColumnDragGhost(): void {
		this.columnDragGhost?.remove();
		this.columnDragGhost = null;
	}

	private updateColumnDropTarget(e: MouseEvent): void {
		const scrollViewport = this.getScrollViewport();
		if (!scrollViewport || !this.columnDropIndicator) return;

		const state = this.engine.stateManager.getState();
		if (state.columns.length === 0) return;

		const scrollRect = scrollViewport.getBoundingClientRect();
		const contentX = e.clientX - scrollRect.left + scrollViewport.scrollLeft;
		const targetCol = Math.max(0, Math.min(state.columns.length - 1, this.engine.geometry.getColIndexAtOffset(contentX)));
		const targetLeft = this.engine.geometry.colLefts[targetCol] || 0;
		const targetWidth = this.engine.geometry.colWidths[targetCol] || state.defaultColWidth;
		const insertAfterTarget = contentX > targetLeft + targetWidth / 2;
		const insertionIndex = Math.max(0, Math.min(state.columns.length, targetCol + (insertAfterTarget ? 1 : 0)));

		this.columnDropInsertionIndex = insertionIndex;

		const indicatorContentLeft =
			insertionIndex >= state.columns.length
				? this.engine.geometry.getTotalWidth(state.defaultColWidth)
				: this.engine.geometry.colLefts[insertionIndex] || 0;
		const indicatorViewportLeft = indicatorContentLeft - scrollViewport.scrollLeft;

		this.columnDropIndicator.style.display = 'block';
		this.columnDropIndicator.style.transform = `translate3d(${indicatorViewportLeft}px, 0, 0)`;
		this.columnDropIndicator.style.height = `${Math.max(0, this.engine.viewport.viewportHeight - 40)}px`;
	}
}
