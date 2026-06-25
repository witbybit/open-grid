import type { GridCommand, GridCommandType } from '../kernel/GridCommand.js';
import type { GridCommandResult } from '../kernel/GridCommandResult.js';
import type { GridEventListener } from '../kernel/GridEvent.js';
import type { CellAddress } from '../domains/cells/CellAddress.js';
import type { ColumnId } from '../domains/columns/ColumnId.js';
import type { ColumnPin } from '../domains/columns/ColumnDef.js';
import type { ColumnState } from '../domains/columns/ColumnState.js';
import type { GroupByModel } from '../domains/pipeline/GroupModel.js';
import type { FilterModel, SortModel } from '../domains/pipeline/PipelineModels.js';
import type { TreeDataOptions } from '../domains/pipeline/TreeStage.js';
import type { RenderPlan } from '../domains/render/RenderPlan.js';
import type { RowTransaction } from '../domains/rows/RowCommand.js';
import type { RowId } from '../domains/rows/RowId.js';
import type { RowModelCapabilities } from '../domains/rows/RowModelCapabilities.js';
import type { RowModelType } from '../domains/rows/RowModelType.js';
import type { RowNode } from '../domains/rows/RowNode.js';
import type { SelectionState } from '../domains/selection/SelectionState.js';
import { GridCore } from './GridCore.js';
import type { GridCoreOptions } from './GridCore.js';
import type { RenderColumn, RendererEngineView } from '../domains/render/RendererEngineView.js';
import type { SidebarStore } from '../sidebar/SidebarStore.js';

/**
 * The public, command-backed grid API (ARCHITECTURE.md "Public API Direction"). Every mutating
 * method is a thin wrapper over `kernel.dispatch` — the facade owns no state and never touches a
 * domain model's mutators directly (R1). It exposes `GridApi`, never `GridStore`/`GridEngine`.
 */
export interface GridApi<TRow> {
	/** Escape hatch: dispatch any command directly. */
	dispatch<K extends GridCommandType>(command: GridCommand<K>): GridCommandResult;

	readonly rows: {
		getRowCount(): number;
		getRow(rowId: RowId): RowNode<TRow> | null;
		replace(rows: readonly TRow[]): GridCommandResult;
		update(updater: (rows: TRow[]) => TRow[]): GridCommandResult;
		applyTransaction(tx: RowTransaction<TRow>): GridCommandResult;
	};

	readonly cells: {
		getValue(address: CellAddress): unknown;
		setValue(address: CellAddress, value: unknown): GridCommandResult;
	};

	readonly columns: {
		getState(): ColumnState[];
		setState(state: readonly ColumnState[]): GridCommandResult;
		resize(columnId: ColumnId, width: number): GridCommandResult;
		move(columnId: ColumnId, toIndex: number): GridCommandResult;
		setVisible(columnId: ColumnId, visible: boolean): GridCommandResult;
		setPinned(columnId: ColumnId, pinned: ColumnPin): GridCommandResult;
	};

	readonly pipeline: {
		getSortModel(): SortModel;
		getFilterModel(): FilterModel;
		setSortModel(model: SortModel): GridCommandResult;
		setFilterModel(model: FilterModel): GridCommandResult;

		// Grouping
		getGroupBy(): GroupByModel;
		setGroupBy(model: GroupByModel): GridCommandResult;
		toggleGroupExpanded(groupKey: string): GridCommandResult;
		setGroupExpanded(groupKey: string, expanded: boolean): GridCommandResult;
		expandAllGroups(): GridCommandResult;
		collapseAllGroups(): GridCommandResult;

		// Tree data
		setTreeData(options: TreeDataOptions | null): GridCommandResult;
		toggleTreeNode(rowId: string): GridCommandResult;

		// Master / detail
		toggleDetail(rowId: string): GridCommandResult;
		setDetailOpen(rowId: string, open: boolean): GridCommandResult;
	};

	readonly selection: {
		getState(): SelectionState;
		selectRows(rowIds: readonly RowId[], mode?: 'replace' | 'add'): GridCommandResult;
		clear(): GridCommandResult;
	};

	readonly editing: {
		start(address: CellAddress, initialValue?: unknown): GridCommandResult;
		updateDraft(value: unknown): GridCommandResult;
		commit(): GridCommandResult;
		cancel(): GridCommandResult;
	};

	readonly rowModel: {
		getType(): RowModelType;
		getCapabilities(): RowModelCapabilities;
	};

	/** Read access for the renderer (R12). Scroll/size are runtime state, not commits. */
	readonly view: {
		getVisualRowCount(): number;
		getColumns(): RenderColumn[];
		setViewport(scrollTop: number, scrollLeft: number, width: number, height: number): void;
		getRenderPlan(): RenderPlan;
	};

	/** Sidebar UI state — not a kernel command; no undo. */
	readonly sidebar: {
		getOpenPanel(): string | null;
		openPanel(id: string): void;
		closePanel(): void;
		togglePanel(id: string): void;
		subscribe(fn: () => void): () => void;
	};

	undo(): GridCommandResult;
	redo(): GridCommandResult;
	canUndo(): boolean;
	canRedo(): boolean;

	/** The clean renderer contract — pass this to DomGridRenderer.mount(). */
	getRendererView(): RendererEngineView<TRow>;

	subscribe(listener: GridEventListener): () => void;
	destroy(): void;
}

/**
 * Build a grid and return its public API. The row model type is fixed here and never changes (R6).
 */
export function createGrid<TRow>(options: GridCoreOptions<TRow>): GridApi<TRow> {
	const core = new GridCore<TRow>(options);
	const { kernel } = core;

	return {
		dispatch: (command) => kernel.dispatch(command),

		rows: {
			getRowCount: () => core.rowModel.query.getRowCount(),
			getRow: (rowId) => core.rowModel.query.getRowById(rowId),
			replace: (rows) => kernel.dispatch({ type: 'rows.replace', payload: { rows } }),
			update: (updater) => kernel.dispatch({ type: 'rows.update', payload: { updater: updater as (rows: unknown[]) => unknown[] } }),
			applyTransaction: (tx) => kernel.dispatch({ type: 'rows.applyTransaction', payload: { transaction: tx } }),
		},

		cells: {
			getValue: (address) => core.getCellValue(address),
			setValue: (address, value) => kernel.dispatch({ type: 'cell.setValue', payload: { address, value } }),
		},

		columns: {
			getState: () => core.columnModel.getState(),
			setState: (state) => kernel.dispatch({ type: 'columns.setState', payload: { state } }),
			resize: (columnId, width) => kernel.dispatch({ type: 'columns.resize', payload: { columnId, width } }),
			move: (columnId, toIndex) => kernel.dispatch({ type: 'columns.move', payload: { columnId, toIndex } }),
			setVisible: (columnId, visible) => kernel.dispatch({ type: 'columns.setVisible', payload: { columnId, visible } }),
			setPinned: (columnId, pinned) => kernel.dispatch({ type: 'columns.setPinned', payload: { columnId, pinned } }),
		},

		pipeline: {
			getSortModel: () => core.pipeline.getSortModel(),
			getFilterModel: () => core.pipeline.getFilterModel(),
			setSortModel: (model) => kernel.dispatch({ type: 'pipeline.setSortModel', payload: { model } }),
			setFilterModel: (model) => kernel.dispatch({ type: 'pipeline.setFilterModel', payload: { model } }),

			getGroupBy: () => core.pipeline.getGroupBy(),
			setGroupBy: (model) => kernel.dispatch({ type: 'pipeline.setGroupBy', payload: { model } }),
			toggleGroupExpanded: (groupKey) => kernel.dispatch({ type: 'pipeline.toggleGroup', payload: { groupKey } }),
			setGroupExpanded: (groupKey, expanded) => kernel.dispatch({ type: 'pipeline.setGroupExpanded', payload: { groupKey, expanded } }),
			expandAllGroups: () => kernel.dispatch({ type: 'pipeline.expandAllGroups', payload: {} }),
			collapseAllGroups: () => kernel.dispatch({ type: 'pipeline.collapseAllGroups', payload: {} }),

			setTreeData: (options) => kernel.dispatch({ type: 'pipeline.setTreeData', payload: { options } }),
			toggleTreeNode: (rowId) => kernel.dispatch({ type: 'pipeline.toggleTreeNode', payload: { rowId } }),

			toggleDetail: (rowId) => kernel.dispatch({ type: 'pipeline.toggleDetail', payload: { rowId } }),
			setDetailOpen: (rowId, open) => kernel.dispatch({ type: 'pipeline.setDetailOpen', payload: { rowId, open } }),
		},

		selection: {
			getState: () => core.selectionModel.getState(),
			selectRows: (rowIds, mode) => kernel.dispatch({ type: 'selection.selectRows', payload: { rowIds, mode } }),
			clear: () => kernel.dispatch({ type: 'selection.clear', payload: {} }),
		},

		editing: {
			start: (address, initialValue) =>
				kernel.dispatch({ type: 'editing.start', payload: initialValue === undefined ? { address } : { address, initialValue } }),
			updateDraft: (value) => kernel.dispatch({ type: 'editing.updateDraft', payload: { value } }),
			commit: () => kernel.dispatch({ type: 'editing.commit', payload: {} }),
			cancel: () => kernel.dispatch({ type: 'editing.cancel', payload: {} }),
		},

		rowModel: {
			getType: () => core.rowModel.type,
			getCapabilities: () => core.rowModel.capabilities,
		},

		view: {
			getVisualRowCount: () => core.getVisualRowCount(),
			getColumns: () => core.getColumnHeaders(),
			setViewport: (scrollTop, scrollLeft, width, height) => {
				core.viewport.setScroll(scrollTop, scrollLeft);
				core.viewport.setSize(width, height);
			},
			getRenderPlan: () => core.getRenderPlan(),
		},

		sidebar: {
			getOpenPanel: () => core.sidebar.getOpenPanel(),
			openPanel: (id) => core.sidebar.openPanel(id),
			closePanel: () => core.sidebar.closePanel(),
			togglePanel: (id) => core.sidebar.togglePanel(id),
			subscribe: (fn) => core.sidebar.subscribe(fn),
		},

		undo: () => kernel.undo(),
		redo: () => kernel.redo(),
		canUndo: () => kernel.canUndo(),
		canRedo: () => kernel.canRedo(),

		getRendererView: () => core.getRendererView(),

		subscribe: (listener) => kernel.subscribe(listener),
		destroy: () => core.destroy(),
	};
}
