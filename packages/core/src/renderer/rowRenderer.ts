import { DOMPool, PooledRow } from './domPool.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { CellRenderer } from './cellRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type { ColumnDef, VisualRow, GridState, RowNode, GridCellPointer } from '../store.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import { createCellKey } from '../ids.js';
import type { GridCellContentUnmount } from './IGridRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';

export interface CellSlotState {
	rowId: string;
	visualRowId: string;
	rowIndex: number;
	colId: string;
	colIndex: number;
	transform: string;
	width: string;
	className: string;
	contentText: string;
	contentMode: 'text' | 'portal' | 'loading' | 'empty';
	rendererKind: 'primitive' | 'portal' | 'loading';
	dataVersion: number;
	styleVersion: number;
	loadingVersion: number;
	portalKey?: string;
}

export class RowRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private readonly cellRenderer: CellRenderer;
	private readonly viewportRenderer: ViewportRenderer<TRowData>;

	public rowPool!: DOMPool<HTMLDivElement>;
	public cellPool!: DOMPool<HTMLDivElement>;
	public activeRows = new Map<number, PooledRow>(); // rowIndex -> PooledRow
	public cellSlotStates = new WeakMap<HTMLDivElement, CellSlotState>();
	public dirtyCellsAfterScroll = new Set<HTMLDivElement>();
	public dirtyRowsAfterScroll = new Set<number>();
	public pendingPortalReleasesAfterScroll: GridCellContentUnmount[] = [];

	public styleVersion = 0;
	public selectionVersion = 0;
	public loadingVersion = 0;
	public hoveredRowIndex: number | null = null;
	public deferredFocusCell: HTMLDivElement | null = null;
	public programmaticScrollCell: GridCellPointer | null = null;
	public renderStats: any = null;

	public currentScrollCellsPatched = 0;
	public currentScrollRowsRecycled = 0;
	public isScrollFrameActive = false;
	public isScrolling = false;
	public dirtyCellsMarkedDuringScroll = 0;
	public postScrollDirtyCellsDecorated = 0;

	private rowPortalHosts = new WeakMap<HTMLElement, HTMLElement>();

	constructor(
		engine: GridEngine<TRowData>,
		geometryController: GeometryController<TRowData>,
		portalMountManager: PortalMountManager<TRowData>,
		cellRenderer: CellRenderer,
		viewportRenderer: ViewportRenderer<TRowData>
	) {
		this.engine = engine;
		this.geometryController = geometryController;
		this.portalMountManager = portalMountManager;
		this.cellRenderer = cellRenderer;
		this.viewportRenderer = viewportRenderer;
	}

	public mount(estRows: number): void {
		this.rowPool = new DOMPool(() => document.createElement('div'), estRows * 3);
		this.cellPool = new DOMPool(() => {
			const div = document.createElement('div');
			this.cellRenderer.initializeCell(div);
			return div;
		}, estRows * 10);
	}

	public unmount(): void {
		this.clearActiveRows();
		if (this.rowPool) this.rowPool.clear();
		if (this.cellPool) this.cellPool.clear();
		this.dirtyCellsAfterScroll.clear();
		this.dirtyRowsAfterScroll.clear();
		this.pendingPortalReleasesAfterScroll = [];
		this.deferredFocusCell = null;
		this.programmaticScrollCell = null;
	}

	public sync(frame: InvalidationFrame): void {
		// Just a hook for Orchestrator
	}

	public clearActiveRows(): void {
		for (const [rowIndex, pooledRow] of this.activeRows.entries()) {
			this.releaseRow(rowIndex, pooledRow, false);
		}
		this.activeRows.clear();
	}

	public recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>): void {
		this.isScrollFrameActive = isScrollFrameActive;
		const rowModel = this.engine.getRowModel();
		let rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const state = this.engine.stateManager.getState();
		const loading = ctx ? ctx.loadingVersion > 0 : state.loading;
		const loadingSkeletonCount = ctx ? 15 : (state.loadingSkeletonCount ?? 15);
		if (loading && rowCount === 0) {
			rowCount = loadingSkeletonCount;
		}
		const colCount = this.engine.columns.getDisplayedColumnCount();

		if (rowCount === 0 || colCount === 0) {
			this.clearActiveRows();
			return;
		}

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;
		const scrollTop = this.engine.viewport.scrollTop;
		const viewportHeight = this.engine.viewport.viewportHeight;

		// Calculate current visible row and column indexes using viewport models
		const newRowRange = this.engine.viewport.getVisibleRowRange(rowCount);
		const newColRange = this.engine.viewport.getVisibleColumnRange(colCount);

		// If server row model is registered, trigger loading visible blocks
		if (rowModel && typeof rowModel.loadVisibleBlocks === 'function') {
			rowModel.loadVisibleBlocks(newRowRange.startIdx, newRowRange.endIdx);
		}

		const startRow = newRowRange.startIdx;
		const endRow = newRowRange.endIdx;

		// Phase 1: Releasing scrolled-out rows back to the recycling pool
		for (const [rowIndex, pooledRow] of this.activeRows.entries()) {
			const isPinnedTop = rowIndex < pinTopRows && rowIndex < rowCount;
			const isPinnedBottom = rowIndex >= rowCount - pinBottomRows && rowIndex < rowCount;
			const isScrollable = rowIndex >= startRow && rowIndex <= endRow;

			if (!isPinnedTop && !isPinnedBottom && !isScrollable) {
				this.releaseRow(rowIndex, pooledRow, isScrollFrameActive);
				if (isScrollFrameActive) this.currentScrollRowsRecycled++;
			}
		}

		// Phase 2: Render/Reposition rows in current range
		const columns = this.engine.columns.getDisplayedColumns();

		const renderRow = (r: number) => {
			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow && loading) {
				visualRow = {
					kind: 'loading',
					id: `loading:${r}`,
					rowIndex: r,
				};
			}
			if (!visualRow) return;

			let pooledRow = this.activeRows.get(r);

			if (!pooledRow) {
				// Acquire unused row divs from the pool
				const rowEl = this.rowPool.acquire();
				const leftEl = this.rowPool.acquire();
				const rightEl = this.rowPool.acquire();

				pooledRow = {
					element: rowEl,
					leftElement: leftEl,
					rightElement: rightEl,
					cells: new Map(),
					boundRowId: visualRow.id,
				};
				this.activeRows.set(r, pooledRow);
				if (isScrollFrameActive) this.currentScrollRowsRecycled++;

				// Append row divs to layers
				if (this.viewportRenderer.centerLayer) this.viewportRenderer.centerLayer.appendChild(rowEl);
				if (this.viewportRenderer.leftLayer) this.viewportRenderer.leftLayer.appendChild(leftEl);
				if (this.viewportRenderer.rightLayer) this.viewportRenderer.rightLayer.appendChild(rightEl);
			} else if (pooledRow.boundRowId !== visualRow.id) {
				if (pooledRow.element.dataset.rowKey) {
					this.portalMountManager.releaseRow({ rowKey: pooledRow.element.dataset.rowKey, container: pooledRow.element });
					delete pooledRow.element.dataset.rowKey;
				}
				this.releaseAllCellsInRow(pooledRow);
				pooledRow.boundRowId = visualRow.id;
			}

			// Reposition row using transforms to avoid layout-bound top/left updates.
			let rowTop = this.engine.geometry.rowTops[r];
			const rowHeight = this.engine.geometry.rowHeights[r];

			if (r < pinTopRows) {
				rowTop = rowTop + scrollTop;
			} else if (r >= rowCount - pinBottomRows) {
				const totalHeight = this.engine.geometry.getTotalHeight(state.defaultRowHeight);
				const bottomOffset = totalHeight - this.engine.geometry.rowTops[r];
				rowTop = scrollTop + viewportHeight - bottomOffset;
			}

			pooledRow.element.style.transform = `translate3d(0, ${rowTop}px, 0)`;
			pooledRow.element.style.height = `${rowHeight}px`;
			pooledRow.element.dataset.rowIndex = String(r);
			pooledRow.element.dataset.rowId = visualRow.id;

			if (pooledRow.leftElement) {
				pooledRow.leftElement.style.transform = `translate3d(0, ${rowTop}px, 0)`;
				pooledRow.leftElement.style.height = `${rowHeight}px`;
				pooledRow.leftElement.dataset.rowIndex = String(r);
				pooledRow.leftElement.dataset.rowId = visualRow.id;
			}
			if (pooledRow.rightElement) {
				pooledRow.rightElement.style.transform = `translate3d(0, ${rowTop}px, 0)`;
				pooledRow.rightElement.style.height = `${rowHeight}px`;
				pooledRow.rightElement.dataset.rowIndex = String(r);
				pooledRow.rightElement.dataset.rowId = visualRow.id;
			}

			if (visualRow.kind === 'loading') {
				this.releaseRowPortal(pooledRow);
				this.updateVisualRowClassName(pooledRow, visualRow, r, state);
				this.recycleLoadingRowCells(
					pooledRow,
					visualRow,
					r,
					newColRange.startIdx,
					newColRange.endIdx,
					columns,
					isScrollFrameActive,
					true,
					ctx
				);
				return;
			}

			if (visualRow.kind !== 'data') {
				this.updateVisualRowClassName(pooledRow, visualRow, r, state);
				this.releaseAllCellsInRow(pooledRow);
				const rowKey = visualRow.id;
				if (pooledRow.element.dataset.rowKey !== rowKey) {
					this.releaseRowPortal(pooledRow);
					pooledRow.element.dataset.rowKey = rowKey;
				}
				const rowPortalHost = this.ensureRowPortalHost(pooledRow.element);
				rowPortalHost.hidden = false;
				this.portalMountManager.mountRow({
					rowKey,
					container: rowPortalHost,
					visualRow,
				});
				return;
			}

			const node = visualRow.node;
			this.releaseRowPortal(pooledRow);
			this.updateRowClassName(pooledRow, node, r, state);

			// Recycle individual cells inside this row
			this.recycleRowCells(pooledRow, node, r, newColRange.startIdx, newColRange.endIdx, columns, isScrollFrameActive, true, ctx);
		};

		// 1. Render pinned top rows
		for (let r = 0; r < pinTopRows; r++) {
			renderRow(r);
		}

		// 2. Render scrollable rows
		for (let r = startRow; r <= endRow; r++) {
			if (r >= pinTopRows && r < rowCount - pinBottomRows) {
				renderRow(r);
			}
		}

		// 3. Render pinned bottom rows
		for (let r = rowCount - pinBottomRows; r < rowCount; r++) {
			if (r >= 0) {
				renderRow(r);
			}
		}
	}

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return;

		const state = this.engine.stateManager.getState();
		const columns = this.engine.columns.getDisplayedColumns();

		for (const rowId of frame.rows) {
			const rowIndex = rowModel.getVisualIndexByRowId(rowId);
			const pooledRow = rowIndex >= 0 ? this.activeRows.get(rowIndex) : undefined;
			const row = rowIndex >= 0 ? rowModel.getVisualRow(rowIndex) : null;
			if (pooledRow && row?.kind === 'data') {
				this.updateRowClassName(pooledRow, row.node, rowIndex, state);
			}
		}

		for (const [rowId, colFields] of frame.cellsByRowId) {
			const rowIndex = rowModel.getVisualIndexByRowId(rowId);
			if (rowIndex < 0) continue;
			for (const colField of colFields) {
				const colIndex = this.engine.columns.getColumnIndex(colField);
				if (colIndex < 0) continue;

				const pooledRow = this.activeRows.get(rowIndex);
				const row = rowModel.getVisualRow(rowIndex);
				if (!pooledRow || row?.kind !== 'data' || !pooledRow.cells.has(colIndex)) continue;

				this.recycleRowCells(pooledRow, row.node, rowIndex, colIndex, colIndex, columns, false, false);
			}
		}

		for (const colField of frame.columns) {
			const colIndex = this.engine.columns.getColumnIndex(colField);
			if (colIndex < 0) continue;
			for (const [rowIndex, pooledRow] of this.activeRows) {
				const row = rowModel.getVisualRow(rowIndex);
				if (row?.kind === 'data' && pooledRow.cells.has(colIndex)) {
					this.recycleRowCells(pooledRow, row.node, rowIndex, colIndex, colIndex, columns, false, false);
				}
			}
		}
	}

	private updateRowClassName(pooledRow: PooledRow, node: RowNode<TRowData>, rowIndex: number, state = this.engine.stateManager.getState()): void {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		const isFocusedRow = state.selection.focus?.rowId === node.id;
		const isSelectedRow = !!state.selection.bounds && rowIndex >= state.selection.bounds.minRow && rowIndex <= state.selection.bounds.maxRow;
		const isLoadingRow = this.engine.data.isRowLoading(node.id);
		let rowClassName = 'og-row';
		if (rowIndex < pinTopRows) {
			rowClassName += ' og-row-pinned-top';
		} else if (rowIndex >= rowCount - pinBottomRows) {
			rowClassName += ' og-row-pinned-bottom';
		}
		if (this.hoveredRowIndex === rowIndex) {
			rowClassName += ' og-row-hovered';
		}
		if (isSelectedRow || isFocusedRow) {
			rowClassName += ' og-row-selected';
		}
		if (isFocusedRow) {
			rowClassName += ' og-row-focused';
		}
		if (isLoadingRow) {
			rowClassName += ' og-row-loading';
		}
		if (this.isScrollFrameActive && state.styleSlots?.rowClass && node.data) {
			this.dirtyRowsAfterScroll.add(rowIndex);
		} else if (state.styleSlots?.rowClass && node.data) {
			try {
				const customRowClass = state.styleSlots.rowClass(node.data, {
					row: node.data,
					rowId: node.id,
					rowIndex,
					isFocused: isFocusedRow,
					isSelected: isSelectedRow || isFocusedRow,
					isLoading: isLoadingRow,
					selection: state.selection,
				});
				if (customRowClass) {
					rowClassName += ' ' + customRowClass;
				}
			} catch (e) {
				console.error('RenderEngine: Error in rowClass styleSlot', e);
			}
		}
		pooledRow.element.className = rowClassName;
		if (pooledRow.leftElement) pooledRow.leftElement.className = rowClassName;
		if (pooledRow.rightElement) pooledRow.rightElement.className = rowClassName;
	}

	private updateVisualRowClassName(
		pooledRow: PooledRow,
		visualRow: Exclude<VisualRow<TRowData>, { kind: 'data' }>,
		rowIndex: number,
		state = this.engine.stateManager.getState()
	): void {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		let rowClassName = `og-row og-row-${visualRow.kind}`;
		if (rowIndex < pinTopRows) {
			rowClassName += ' og-row-pinned-top';
		} else if (rowIndex >= rowCount - pinBottomRows) {
			rowClassName += ' og-row-pinned-bottom';
		}
		if (this.hoveredRowIndex === rowIndex) {
			rowClassName += ' og-row-hovered';
		}
		if (state.selection.focus?.rowId === visualRow.id) {
			rowClassName += ' og-row-focused';
		}

		if (visualRow.kind === 'group' && state.styleSlots?.groupRowClass) {
			try {
				const customClass = state.styleSlots.groupRowClass(visualRow);
				if (customClass) {
					rowClassName += ' ' + customClass;
				}
			} catch (e) {
				console.error('RenderEngine: Error in groupRowClass styleSlot', e);
			}
		} else if (visualRow.kind === 'detail' && state.styleSlots?.detailRowClass) {
			try {
				const customClass = state.styleSlots.detailRowClass(visualRow);
				if (customClass) {
					rowClassName += ' ' + customClass;
				}
			} catch (e) {
				console.error('RenderEngine: Error in detailRowClass styleSlot', e);
			}
		}

		pooledRow.element.className = rowClassName;
		if (pooledRow.leftElement) pooledRow.leftElement.className = rowClassName;
		if (pooledRow.rightElement) pooledRow.rightElement.className = rowClassName;
	}

	public recycleRowCells(
		pooledRow: PooledRow,
		node: RowNode<TRowData>,
		rowIndex: number,
		startCol: number,
		endCol: number,
		columns: ColumnDef<TRowData>[],
		isScrollFrameActive: boolean,
		releaseOutOfRange = true,
		ctx?: ScrollRenderContext<TRowData>
	): void {
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const colCount = columns.length;

		// 1. Release cells out-of-column bounds
		if (releaseOutOfRange) {
			const colsToRelease: number[] = [];
			for (const [c, cell] of pooledRow.cells.entries()) {
				if (cell) {
					if (c >= colCount) {
						colsToRelease.push(c);
						continue;
					}

					const isPinnedLeft = c < pinLeftColumns;
					const isPinnedRight = c >= colCount - pinRightColumns;
					const isScrollable = c >= startCol && c <= endCol;

					if (!isPinnedLeft && !isPinnedRight && !isScrollable) {
						colsToRelease.push(c);
					}
				}
			}
			this.releaseCellsInColumns(pooledRow, colsToRelease);
		}

		// 2. Bind cells in visible range
		const renderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;

			let cell = pooledRow.cells.get(c);

			if (!cell) {
				cell = this.cellPool.acquire();
				pooledRow.cells.set(c, cell);
			}

			let cellLeft = this.engine.geometry.colLefts[c];
			const cellWidth = this.engine.geometry.colWidths[c];

			let targetRowEl = pooledRow.element;

			if (c < pinLeftColumns) {
				targetRowEl = pooledRow.leftElement!;
			} else if (c >= colCount - pinRightColumns) {
				const firstRightPinColLeft = this.engine.geometry.colLefts[colCount - pinRightColumns];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetRowEl = pooledRow.rightElement!;
			}

			if (cell.parentNode !== targetRowEl) {
				targetRowEl.appendChild(cell);
			}

			const nextTransform = `translate3d(${cellLeft}px, 0, 0)`;
			const nextWidth = `${cellWidth}px`;
			const rowIndexText = String(rowIndex);

			const previous = this.cellSlotStates.get(cell);

			if (!previous || previous.transform !== nextTransform) {
				cell.style.transform = nextTransform;
			}
			if (!previous || previous.width !== nextWidth) {
				cell.style.width = nextWidth;
			}
			if (!previous || cell.dataset.colField !== col.field) {
				cell.dataset.colField = col.field;
			}
			if (!previous || cell.dataset.rowIndex !== rowIndexText) {
				cell.dataset.rowIndex = rowIndexText;
			}

			if (isScrollFrameActive) {
				this.bindCellDuringScroll(cell, node, rowIndex, c, col, colCount, pinLeftColumns, pinRightColumns, ctx!);
				this.currentScrollCellsPatched++;
				return;
			}

			const access = this.engine.cellAccess.get(node.id, rowIndex, node, node.data, c, col);

			// Handle classes including pinning, focus, and loading
			let cellClassName = 'og-cell';
			if (c < pinLeftColumns) {
				cellClassName += ' og-cell-pinned-left';
			} else if (c >= colCount - pinRightColumns) {
				cellClassName += ' og-cell-pinned-right';
			}
			if (access.isFocused) {
				cellClassName += ' og-cell-focused';
				cell.tabIndex = -1;
				const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
				if (
					activeEl &&
					(activeEl === document.body ||
						(this.viewportRenderer.container &&
							this.viewportRenderer.container.contains(activeEl) &&
							activeEl !== cell &&
							!cell.contains(activeEl) &&
							!this.isEditorInteractiveElement(activeEl)))
				) {
					this.applyFocus(cell);
				}
			} else {
				if (cell.hasAttribute('tabindex')) cell.removeAttribute('tabindex');
			}
			if (access.isSelected) {
				cellClassName += ' og-cell-selected';
			}
			if (access.isLoading) {
				cellClassName += ' og-cell-loading';
			}
			const state = this.engine.stateManager.getState();
			if (state.styleSlots?.cellClass && node.data) {
				try {
					const customCellClass = state.styleSlots.cellClass(col, node.data, {
						row: node.data,
						rowId: node.id,
						rowIndex,
						col,
						colField: col.field,
						colIndex: c,
						isFocused: access.isFocused,
						isRowFocused: access.isRowFocused,
						isRowSelected: access.isRowSelected || access.isRowFocused,
						isSelected: access.isSelected,
						isEditing: access.isEditing,
						value: access.value,
						rawValue: access.rawValue,
						isLoading: access.isLoading,
						selection: state.selection,
					});
					if (customCellClass) {
						cellClassName += ' ' + customCellClass;
					}
				} catch (e) {
					console.error('RenderEngine: Error in cellClass styleSlot', e);
				}
			}
			if (!previous || previous.className !== cellClassName) {
				cell.className = cellClassName;
			}
			if (state.styleSlots?.beforeCellRender) {
				try {
					state.styleSlots.beforeCellRender(access, cell);
				} catch (e) {
					console.error('RenderEngine: Error in beforeCellRender styleSlot', e);
				}
			}

			// Bind value
			const cellValue = access.value;
			const cellKey = createCellKey(node.id, col.field);

			let nextContentText = '';
			let nextContentMode: 'text' | 'portal' | 'loading' | 'empty' = 'empty';
			let nextRendererKind: 'primitive' | 'portal' | 'loading' = 'primitive';

			if ((col.cellRenderer || access.isEditing) && !access.isLoading) {
				nextContentMode = 'portal';
				nextRendererKind = 'portal';
				if (cell.dataset.cellKey !== cellKey) {
					if (cell.dataset.cellKey) {
						this.releaseCellPortal(cell);
						this.portalMountManager.flushCellReleaseTransaction(true);
					}
					// Set content empty so custom React portal doesn't clash with stale text
					this.cellRenderer.clearPrimitiveContent(cell);
					cell.dataset.cellKey = cellKey;
				}
				const portalHost = this.ensureCellPortalHost(cell);
				this.cellRenderer.showPortalContent(cell);
				this.portalMountManager.mountCell({
					cellKey,
					container: portalHost,
					value: cellValue,
					node,
					col,
					isEditing: access.isEditing,
					isLoading: access.isLoading,
				});
			} else {
				if (cell.dataset.cellKey) {
					this.releaseCellPortal(cell);
					delete cell.dataset.cellKey;
				}
				if (access.isLoading) {
					nextContentMode = 'loading';
					nextRendererKind = 'loading';
					this.cellRenderer.ensureLoadingSkeleton(cell);
				} else {
					nextContentText = this.getCheapCellText(node, col);
					nextContentMode = nextContentText === '' ? 'empty' : 'text';
					nextRendererKind = 'primitive';
					this.cellRenderer.setPrimitiveContent(cell, nextContentText);
				}
			}

			if (state.styleSlots?.afterCellRender) {
				try {
					state.styleSlots.afterCellRender(access, cell);
				} catch (e) {
					console.error('RenderEngine: Error in afterCellRender styleSlot', e);
				}
			}

			// Clear scroll frame dirty flags if non-scroll repaint
			this.cellSlotStates.set(cell, {
				rowId: node.id,
				visualRowId: node.id,
				rowIndex,
				colId: col.field,
				colIndex: c,
				transform: nextTransform,
				width: nextWidth,
				className: cellClassName,
				contentText: nextContentText,
				contentMode: nextContentMode,
				rendererKind: nextRendererKind,
				dataVersion: state.dataVersion,
				styleVersion: this.styleVersion,
				loadingVersion: this.loadingVersion,
				portalKey: cell.dataset.cellKey,
			});
		};

		// 1. Render pinned left cells
		for (let c = 0; c < pinLeftColumns; c++) {
			renderCell(c);
		}

		// 2. Render scrollable cells
		for (let c = startCol; c <= endCol; c++) {
			if (c >= pinLeftColumns && c < colCount - pinRightColumns) {
				renderCell(c);
			}
		}

		// 3. Render pinned right cells
		for (let c = colCount - pinRightColumns; c < colCount; c++) {
			if (c >= 0) {
				renderCell(c);
			}
		}
	}

	public recycleLoadingRowCells(
		pooledRow: PooledRow,
		_visualRow: Extract<VisualRow<TRowData>, { kind: 'loading' }>,
		rowIndex: number,
		startCol: number,
		endCol: number,
		columns: ColumnDef<TRowData>[],
		isScrollFrameActive: boolean,
		releaseOutOfRange = true,
		ctx?: ScrollRenderContext<TRowData>
	): void {
		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const colCount = columns.length;

		if (releaseOutOfRange) {
			const colsToRelease: number[] = [];
			for (const [c] of pooledRow.cells.entries()) {
				if (c >= colCount) {
					colsToRelease.push(c);
					continue;
				}

				const isPinnedLeft = c < pinLeftColumns;
				const isPinnedRight = c >= colCount - pinRightColumns;
				const isScrollable = c >= startCol && c <= endCol;
				if (!isPinnedLeft && !isPinnedRight && !isScrollable) {
					colsToRelease.push(c);
				}
			}
			this.releaseCellsInColumns(pooledRow, colsToRelease);
		}

		const renderCell = (c: number) => {
			const col = columns[c];
			if (!col) return;

			let cell = pooledRow.cells.get(c);
			if (!cell) {
				cell = this.cellPool.acquire();
				pooledRow.cells.set(c, cell);
			}

			let cellLeft = this.engine.geometry.colLefts[c];
			const cellWidth = this.engine.geometry.colWidths[c];
			let targetRowEl = pooledRow.element;

			if (c < pinLeftColumns) {
				targetRowEl = pooledRow.leftElement!;
			} else if (c >= colCount - pinRightColumns) {
				const firstRightPinColLeft = this.engine.geometry.colLefts[colCount - pinRightColumns];
				cellLeft = cellLeft - firstRightPinColLeft;
				targetRowEl = pooledRow.rightElement!;
			}

			if (cell.parentNode !== targetRowEl) {
				targetRowEl.appendChild(cell);
			}

			if (!isScrollFrameActive && cell.dataset.cellKey) {
				this.releaseCellPortal(cell);
				delete cell.dataset.cellKey;
			} else if (isScrollFrameActive && cell.dataset.cellKey) {
				this.markCellDirtyAfterScroll(cell);
			}

			const nextTransform = `translate3d(${cellLeft}px, 0, 0)`;
			const nextWidth = `${cellWidth}px`;
			const rowIndexText = String(rowIndex);

			const previous = this.cellSlotStates.get(cell);

			if (!previous || previous.transform !== nextTransform) {
				cell.style.transform = nextTransform;
			}
			if (!previous || previous.width !== nextWidth) {
				cell.style.width = nextWidth;
			}
			if (!previous || cell.dataset.colField !== col.field) {
				cell.dataset.colField = col.field;
			}
			if (!previous || cell.dataset.rowIndex !== rowIndexText) {
				cell.dataset.rowIndex = rowIndexText;
			}

			let cellClassName = 'og-cell og-cell-loading';
			if (!previous || previous.className !== cellClassName) {
				cell.className = cellClassName;
			}

			if (isScrollFrameActive) {
				this.markCellDirtyAfterScroll(cell);
			} else {
				this.cellRenderer.ensureLoadingSkeleton(cell);
			}

			const dataVersion = ctx ? ctx.dataVersion : this.engine.stateManager.getState().dataVersion;

			this.cellSlotStates.set(cell, {
				rowId: `loading:${rowIndex}`,
				visualRowId: `loading:${rowIndex}`,
				rowIndex,
				colId: col.field,
				colIndex: c,
				transform: nextTransform,
				width: nextWidth,
				className: cellClassName,
				contentText: '',
				contentMode: 'loading',
				rendererKind: 'loading',
				dataVersion,
				styleVersion: this.styleVersion,
				loadingVersion: this.loadingVersion,
				portalKey: cell.dataset.cellKey,
			});
		};

		// 1. Render pinned left cells
		for (let c = 0; c < pinLeftColumns; c++) {
			renderCell(c);
		}

		// 2. Render scrollable cells
		for (let c = startCol; c <= endCol; c++) {
			if (c >= pinLeftColumns && c < colCount - pinRightColumns) {
				renderCell(c);
			}
		}

		// 3. Render pinned right cells
		for (let c = colCount - pinRightColumns; c < colCount; c++) {
			if (c >= 0) {
				renderCell(c);
			}
		}
	}

	private bindCellDuringScroll(
		cell: HTMLDivElement,
		node: RowNode<TRowData>,
		rowIndex: number,
		colIndex: number,
		col: ColumnDef<TRowData>,
		colCount: number,
		pinLeftColumns: number,
		pinRightColumns: number,
		ctx: ScrollRenderContext<TRowData>
	): void {
		const rendererKind: 'primitive' | 'portal' | 'loading' =
			ctx.loadingVersion > 0 && this.engine.data.isRowLoading(node.id)
				? 'loading'
				: col.cellRenderer || (ctx.activeEdit && ctx.activeEdit.rowId === node.id && ctx.activeEdit.colField === col.field)
					? 'portal'
					: 'primitive';

		let cellClassName = 'og-cell';
		if (colIndex < pinLeftColumns) {
			cellClassName += ' og-cell-pinned-left';
		} else if (colIndex >= colCount - pinRightColumns) {
			cellClassName += ' og-cell-pinned-right';
		}
		if (rendererKind === 'loading') {
			cellClassName += ' og-cell-loading';
		}

		if (ctx.focusedCell && ctx.focusedCell.rowId === node.id && ctx.focusedCell.colField === col.field) {
			cell.tabIndex = -1;
			const isProgrammatic =
				this.programmaticScrollCell && this.programmaticScrollCell.rowId === node.id && this.programmaticScrollCell.colField === col.field;
			if (isProgrammatic) {
				this.applyFocus(cell);
				this.programmaticScrollCell = null;
			} else {
				this.deferredFocusCell = cell;
			}
		}

		const cellKey = createCellKey(node.id, col.field);

		let contentMode: 'text' | 'portal' | 'loading' | 'empty' = 'empty';
		let contentText = '';

		if (rendererKind === 'loading') {
			contentMode = 'loading';
		} else if (rendererKind === 'portal') {
			contentMode = 'portal';
		} else {
			const cachedResult = this.engine.data.getCachedDisplayValue(node.id, col.field);
			if (cachedResult.hasCached) {
				contentText = cachedResult.value == null ? '' : String(cachedResult.value);
				contentMode = contentText === '' ? 'empty' : 'text';
			} else {
				contentText = '...';
				contentMode = 'text';
				this.markCellDirtyAfterScroll(cell);
			}
		}

		const nextSlotState: CellSlotState = {
			rowId: node.id,
			visualRowId: node.id,
			rowIndex,
			colId: col.field,
			colIndex,
			transform: cell.style.transform,
			width: cell.style.width,
			className: cellClassName,
			contentText,
			contentMode,
			rendererKind,
			dataVersion: ctx.dataVersion,
			styleVersion: ctx.styleVersion,
			loadingVersion: ctx.loadingVersion,
			portalKey: rendererKind === 'portal' ? cellKey : undefined,
		};

		const previous = this.cellSlotStates.get(cell);

		if (previous && this.canReuseCellSlot(previous, nextSlotState)) {
			return;
		}

		if (this.renderStats) {
			this.renderStats.reusableCellsSkippedDuringScroll++;
		}

		if (!previous || previous.className !== cellClassName) {
			cell.className = cellClassName;
		}

		if (ctx.hasStyleHooks) {
			this.markCellDirtyAfterScroll(cell);
			if (this.renderStats) {
				this.renderStats.styleHookCallsDuringScroll++;
			}
		}

		if (rendererKind === 'portal') {
			if (cell.dataset.cellKey !== cellKey) {
				const customCellScrollMode = ctx.customCellScrollMode;
				if (customCellScrollMode === 'preserve') {
					this.cellRenderer.showPortalContent(cell);
				} else if (customCellScrollMode === 'fallback') {
					const cachedResult = this.engine.data.getCachedDisplayValue(node.id, col.field);
					const fallbackText = cachedResult.hasCached ? (cachedResult.value == null ? '' : String(cachedResult.value)) : '...';
					this.cellRenderer.setPrimitiveContent(cell, fallbackText, 'fallback');
					if (!cachedResult.hasCached) {
						this.markCellDirtyAfterScroll(cell);
					}
				} else {
					this.cellRenderer.showPendingContent(cell);
				}
				this.markCellDirtyAfterScroll(cell);
			}
		} else {
			if (cell.dataset.cellKey) {
				this.markCellDirtyAfterScroll(cell);
			}

			if (rendererKind === 'loading') {
				this.cellRenderer.ensureLoadingSkeleton(cell);
			} else {
				this.cellRenderer.setPrimitiveContent(cell, contentText);
			}
		}

		nextSlotState.portalKey = cell.dataset.cellKey;
		this.cellSlotStates.set(cell, nextSlotState);
	}

	private canReuseCellSlot(previous: CellSlotState, next: CellSlotState): boolean {
		return (
			previous.rowId === next.rowId &&
			previous.rowIndex === next.rowIndex &&
			previous.colId === next.colId &&
			previous.colIndex === next.colIndex &&
			previous.dataVersion === next.dataVersion &&
			previous.styleVersion === next.styleVersion &&
			previous.loadingVersion === next.loadingVersion &&
			previous.rendererKind === next.rendererKind &&
			previous.portalKey === next.portalKey &&
			previous.contentMode === next.contentMode &&
			previous.contentText === next.contentText &&
			previous.className === next.className
		);
	}

	private getRendererKind(
		node: RowNode<TRowData>,
		col: ColumnDef<TRowData>,
		state = this.engine.stateManager.getState()
	): 'primitive' | 'portal' | 'loading' {
		if (this.engine.data.isRowLoading(node.id)) return 'loading';
		if (state.activeEdit?.rowId === node.id && state.activeEdit.colField === col.field) return 'portal';
		if (col.cellRenderer) return 'portal';
		return 'primitive';
	}

	private getCheapCellText(node: RowNode<TRowData>, col: ColumnDef<TRowData>, ctx?: ScrollRenderContext<TRowData>): string {
		const isScrolling = ctx ? ctx.isScrolling : this.isScrollFrameActive;
		if (isScrolling && (col.valueGetter || this.engine.hasFormula(node.id, col.field))) {
			const cachedResult = this.engine.data.getCachedDisplayValue(node.id, col.field);
			return cachedResult.hasCached ? (cachedResult.value == null ? '' : String(cachedResult.value)) : '...';
		}
		if (col.valueGetter || this.engine.hasFormula(node.id, col.field)) {
			const val = this.engine.data.getCellValue(node.id, col.field);
			return val == null ? '' : String(val);
		}
		const raw = node.data ? (node.data as Record<string, unknown>)[col.field] : undefined;
		return raw == null ? '' : String(raw);
	}

	private deferFocusForHotCellIfNeeded(
		cell: HTMLDivElement,
		node: RowNode<TRowData>,
		col: ColumnDef<TRowData>,
		state = this.engine.stateManager.getState()
	): void {
		if (state.selection.focus?.rowId !== node.id || state.selection.focus.colField !== col.field) return;
		cell.tabIndex = -1;
		const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
		if (
			activeEl &&
			(activeEl === document.body ||
				(this.viewportRenderer.container &&
					this.viewportRenderer.container.contains(activeEl) &&
					activeEl !== cell &&
					!cell.contains(activeEl) &&
					!this.isEditorInteractiveElement(activeEl)))
		) {
			this.deferredFocusCell = cell;
		}
	}

	public markCellDirtyAfterScroll(cell: HTMLDivElement): void {
		if (!this.dirtyCellsAfterScroll.has(cell)) {
			this.dirtyCellsAfterScroll.add(cell);
			this.dirtyCellsMarkedDuringScroll++;
		}
	}

	public releaseRow(rowIndex: number, pooledRow: PooledRow, isScrollFrameActive: boolean): void {
		this.isScrollFrameActive = isScrollFrameActive;
		const hadRowPortal = this.releaseRowPortal(pooledRow);

		// Release all cell DOMs inside row
		this.releaseAllCellsInRow(pooledRow);
		this.activeRows.delete(rowIndex);
		if (pooledRow.element.parentNode) pooledRow.element.remove();
		if (pooledRow.leftElement && pooledRow.leftElement.parentNode) pooledRow.leftElement.remove();
		if (pooledRow.rightElement && pooledRow.rightElement.parentNode) pooledRow.rightElement.remove();

		if (isScrollFrameActive || hadRowPortal) {
			this.rowPool.releaseHot(pooledRow.element);
			if (pooledRow.leftElement) this.rowPool.releaseHot(pooledRow.leftElement);
			if (pooledRow.rightElement) this.rowPool.releaseHot(pooledRow.rightElement);
		} else {
			this.rowPool.releaseCold(pooledRow.element);
			if (pooledRow.leftElement) this.rowPool.releaseCold(pooledRow.leftElement);
			if (pooledRow.rightElement) this.rowPool.releaseCold(pooledRow.rightElement);
		}
	}

	private releaseAllCellsInRow(pooledRow: PooledRow): void {
		const cellsToRelease = Array.from(pooledRow.cells.keys());
		this.releaseCellsInColumns(pooledRow, cellsToRelease);
	}

	private releaseCellsInColumns(pooledRow: PooledRow, colIndices: number[]): void {
		if (colIndices.length === 0) return;
		const unmounts: GridCellContentUnmount[] = [];
		const isDeferred = this.isScrollFrameActive || this.isScrolling;

		for (const c of colIndices) {
			const cell = pooledRow.cells.get(c);
			if (cell) {
				if (cell.dataset.cellKey) {
					const cellKey = cell.dataset.cellKey;
					const container = this.getCellPortalHost(cell) ?? cell;
					if (isDeferred) {
						this.pendingPortalReleasesAfterScroll.push({
							cellKey,
							container,
							flushSync: false,
						});
					} else {
						unmounts.push({
							cellKey,
							container,
						});
					}
					delete cell.dataset.cellKey;
				}
				cell.remove();
				pooledRow.cells.delete(c);
				if (this.isScrollFrameActive) {
					this.cellPool.releaseHot(cell);
				} else {
					this.cellPool.releaseCold(cell);
				}
				this.cellSlotStates.delete(cell);
				this.dirtyCellsAfterScroll.delete(cell);
			}
		}
		if (unmounts.length > 0) {
			this.portalMountManager.releaseCells(unmounts);
		}
	}

	public releaseCellPortal(cell: HTMLDivElement): void {
		const cellKey = cell.dataset.cellKey;
		if (!cellKey) return;
		this.portalMountManager.releaseCell({
			cellKey,
			container: this.getCellPortalHost(cell) ?? cell,
			flushSync: false,
		});
	}

	private releaseRowPortal(pooledRow: PooledRow): boolean {
		const rowKey = pooledRow.element.dataset.rowKey;
		if (!rowKey) return false;
		const host = this.ensureRowPortalHost(pooledRow.element);
		this.portalMountManager.releaseRow({ rowKey, container: host });
		host.hidden = true;
		host.remove();
		delete pooledRow.element.dataset.rowKey;
		return true;
	}

	private ensureRowPortalHost(row: HTMLElement): HTMLElement {
		let host = this.rowPortalHosts.get(row);
		if (!host) {
			host = document.createElement('div');
			host.className = 'og-row-portal-host';
			host.hidden = true;
			row.appendChild(host);
			this.rowPortalHosts.set(row, host);
		} else if (host.parentElement !== row) {
			row.appendChild(host);
		}
		return host;
	}

	private ensureCellPortalHost(cell: HTMLDivElement): HTMLDivElement {
		this.cellRenderer.getOrCreateCellContentLayer(cell);
		return this.cellRenderer.getOrCreatePortalHost(cell) as HTMLDivElement;
	}

	private getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null {
		return this.cellRenderer.getPortalHost(cell) as HTMLDivElement | null;
	}

	public decorateDirtyCellsAfterScroll(options?: { maxCells?: number }): { remaining: number; processed: number } {
		const maxCells = options?.maxCells ?? Infinity;
		if (this.dirtyCellsAfterScroll.size === 0 && this.dirtyRowsAfterScroll.size === 0) {
			return { remaining: 0, processed: 0 };
		}
		const rowModel = this.engine.getRowModel();
		if (!rowModel) {
			this.dirtyCellsAfterScroll.clear();
			this.dirtyRowsAfterScroll.clear();
			return { remaining: 0, processed: 0 };
		}
		const state = this.engine.stateManager.getState();
		const columns = this.engine.columns.getDisplayedColumns();

		let processed = 0;
		const iterator = this.dirtyCellsAfterScroll.values();
		const toProcess: HTMLDivElement[] = [];
		for (let i = 0; i < maxCells; i++) {
			const nextVal = iterator.next();
			if (nextVal.done) break;
			toProcess.push(nextVal.value);
		}

		// Decorate individual scrolling-dirty cell slots
		for (const cell of toProcess) {
			this.dirtyCellsAfterScroll.delete(cell);
			const rowIndexStr = cell.dataset.rowIndex;
			const colField = cell.dataset.colField;
			if (!rowIndexStr || !colField) continue;

			const rowIndex = Number(rowIndexStr);
			const visualRow = rowModel.getVisualRow(rowIndex);
			const colIndex = this.engine.columns.getColumnIndex(colField);

			if (visualRow?.kind === 'data' && colIndex >= 0) {
				const pooledRow = this.activeRows.get(rowIndex);
				if (pooledRow && pooledRow.cells.get(colIndex) === cell) {
					this.recycleRowCells(pooledRow, visualRow.node, rowIndex, colIndex, colIndex, columns, false, false);
					this.postScrollDirtyCellsDecorated++;
					processed++;
				}
			} else if (visualRow?.kind === 'loading' && colIndex >= 0) {
				const pooledRow = this.activeRows.get(rowIndex);
				if (pooledRow && pooledRow.cells.get(colIndex) === cell) {
					this.recycleLoadingRowCells(pooledRow, visualRow, rowIndex, colIndex, colIndex, columns, false, false);
					this.postScrollDirtyCellsDecorated++;
					processed++;
				}
			}
		}

		const remaining = this.dirtyCellsAfterScroll.size;
		if (remaining === 0) {
			// Decorate custom row CSS classes
			for (const r of this.dirtyRowsAfterScroll) {
				const pooledRow = this.activeRows.get(r);
				const visualRow = rowModel.getVisualRow(r);
				if (pooledRow && visualRow?.kind === 'data') {
					this.updateRowClassName(pooledRow, visualRow.node, r, state);
				}
			}
			this.dirtyRowsAfterScroll.clear();
		}

		return { remaining, processed };
	}

	public applyFocus(cell: HTMLDivElement): void {
		cell.focus({ preventScroll: true });
	}

	private isEditorInteractiveElement(el: Element | null): boolean {
		if (!el) return false;
		return el.closest('.og-cell-editor') !== null || el.closest('.og-context-menu') !== null;
	}
}
