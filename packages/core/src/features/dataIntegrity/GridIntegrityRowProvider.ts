import type { RowModel } from '../../rowModel.js';
import type { InternalGridState } from '../../state/GridState.js';
import type { GridIntegrityRowRef, GridIntegrityRowProvider, GridIntegrityRowsResult, GridIntegrityScope } from './integrityTypes.js';

/**
 * Row-model-aware row access for Data Integrity modules.
 * Never falls back to visible rows as default — requires explicit scope.
 */
export class ClientGridIntegrityRowProvider<TRowData> implements GridIntegrityRowProvider<TRowData> {
	constructor(
		private readonly getRowModel: () => RowModel<TRowData> | null,
		private readonly getState: () => InternalGridState<TRowData>
	) {}

	getRowsForIntegrityScope(scope: GridIntegrityScope): GridIntegrityRowsResult<TRowData> {
		const rowModel = this.getRowModel();
		const state = this.getState();

		if (!rowModel) {
			return {
				status: 'unsupported',
				scope,
				reason: 'Row model not yet available',
			};
		}

		switch (scope) {
			case 'allRows':
			case 'loadedRows':
				return this._scanAllDataNodes(scope, rowModel, state);

			case 'filteredRows':
				return this._scanFilteredNodes(rowModel, state);

			case 'selectedRows':
				return this._scanSelectedRows(rowModel, state);

			case 'visibleRows':
				return this._scanVisibleRows(rowModel);

			case 'currentPage':
				return this._scanCurrentPageNodes(rowModel, state);

			case 'serverProvided':
				return {
					status: 'unsupported',
					scope,
					reason: 'serverProvided scope must be published via api.integrity.publishServerReport()',
				};

			default:
				return {
					status: 'unsupported',
					scope,
					reason: `Unknown scope: ${scope as string}`,
				};
		}
	}

	private _scanAllDataNodes(
		scope: GridIntegrityScope,
		rowModel: RowModel<TRowData>,
		state: InternalGridState<TRowData>
	): GridIntegrityRowsResult<TRowData> {
		// Use getAllDataNodes() when available — this is the full client dataset,
		// NOT getVisualRowCount()/getVisualRow() which is viewport/visual projection.
		const allDataCapable = _asAllDataNodeCapable(rowModel);
		if (allDataCapable) {
			const nodes = allDataCapable.getAllDataNodes();
			const refs: GridIntegrityRowRef<TRowData>[] = [];
			for (const node of nodes) {
				if (node.data == null) continue;
				refs.push({
					rowId: node.id,
					row: node.data as TRowData,
					source: 'client',
				});
			}
			return { status: 'ok', scope, rows: refs, complete: true };
		}

		return {
			status: 'unsupported',
			scope,
			reason: `Row model does not implement getAllDataNodes() — cannot scan scope '${scope}' without visual-row fallback. Implement AllDataNodesCapableRowModel to support this scope.`,
		};

		void state; // used only to avoid lint warning
	}

	private _scanSelectedRows(rowModel: RowModel<TRowData>, state: InternalGridState<TRowData>): GridIntegrityRowsResult<TRowData> {
		const selectedIds = state.selectedRowIds ?? [];
		const refs: GridIntegrityRowRef<TRowData>[] = [];
		for (const rowId of selectedIds) {
			const node = rowModel.getRowNodeById?.(rowId) ?? null;
			if (!node || node.data == null) continue;
			refs.push({ rowId, row: node.data as TRowData, source: 'selected' });
		}
		return { status: 'ok', scope: 'selectedRows', rows: refs, complete: true };
	}

	private _scanFilteredNodes(
		rowModel: RowModel<TRowData>,
		state: InternalGridState<TRowData>
	): GridIntegrityRowsResult<TRowData> {
		const filteredCapable = _asFilteredDataNodeCapable(rowModel);
		if (filteredCapable) {
			const nodes = filteredCapable.getFilteredDataNodes();
			const refs: GridIntegrityRowRef<TRowData>[] = [];
			for (const node of nodes) {
				if (node.data == null) continue;
				refs.push({ rowId: node.id, row: node.data as TRowData, source: 'client' });
			}
			return { status: 'ok', scope: 'filteredRows', rows: refs, complete: true };
		}

		// If no filter-aware API, fall back to all data nodes (conservative: better too many than too few)
		const allDataCapable = _asAllDataNodeCapable(rowModel);
		if (allDataCapable) {
			const nodes = allDataCapable.getAllDataNodes();
			const refs: GridIntegrityRowRef<TRowData>[] = [];
			for (const node of nodes) {
				if (node.data == null) continue;
				refs.push({ rowId: node.id, row: node.data as TRowData, source: 'client' });
			}
			return {
				status: 'ok',
				scope: 'filteredRows',
				rows: refs,
				complete: false,
				message: 'filteredRows fell back to allRows — row model does not implement getFilteredDataNodes()',
			};
		}

		return {
			status: 'unsupported',
			scope: 'filteredRows',
			reason: 'Row model does not implement getFilteredDataNodes() or getAllDataNodes()',
		};

		void state; // used only to avoid lint warning
	}

	private _scanCurrentPageNodes(
		rowModel: RowModel<TRowData>,
		state: InternalGridState<TRowData>
	): GridIntegrityRowsResult<TRowData> {
		const pageCapable = _asCurrentPageCapable(rowModel);
		if (pageCapable) {
			const nodes = pageCapable.getCurrentPageDataNodes();
			const refs: GridIntegrityRowRef<TRowData>[] = [];
			for (const node of nodes) {
				if (node.data == null) continue;
				refs.push({ rowId: node.id, row: node.data as TRowData, source: 'client' });
			}
			return { status: 'ok', scope: 'currentPage', rows: refs, complete: true };
		}
		return {
			status: 'unsupported',
			scope: 'currentPage',
			reason: 'Row model does not implement getCurrentPageDataNodes()',
		};

		void state; // used only to avoid lint warning
	}

	private _scanVisibleRows(rowModel: RowModel<TRowData>): GridIntegrityRowsResult<TRowData> {
		const refs: GridIntegrityRowRef<TRowData>[] = [];
		const count = rowModel.getVisualRowCount();
		for (let i = 0; i < count; i++) {
			const vr = rowModel.getVisualRow(i);
			if (!vr || vr.kind !== 'data' || vr.node.data == null) continue;
			refs.push({
				rowId: vr.node.id,
				row: vr.node.data as TRowData,
				rowIndex: i,
				source: 'visible',
			});
		}
		return { status: 'ok', scope: 'visibleRows', rows: refs, complete: false };
	}
}

export class InfiniteGridIntegrityRowProvider<TRowData> implements GridIntegrityRowProvider<TRowData> {
	constructor(
		private readonly getRowModel: () => RowModel<TRowData> | null,
		private readonly getState: () => InternalGridState<TRowData>
	) {}

	getRowsForIntegrityScope(scope: GridIntegrityScope): GridIntegrityRowsResult<TRowData> {
		const rowModel = this.getRowModel();
		const state = this.getState();

		if (!rowModel) {
			return { status: 'unsupported', scope, reason: 'Row model not yet available' };
		}

		switch (scope) {
			case 'allRows':
				return {
					status: 'unsupported',
					scope,
					reason: 'allRows is not available for infinite row model unless all blocks are loaded or a serverProvided report is supplied. Use loadedRows for loaded blocks only.',
				};

			case 'loadedRows': {
				const refs = this._scanLoadedBlocks(rowModel);
				return { status: 'ok', scope, rows: refs, complete: false };
			}

			case 'filteredRows': {
				const refs = this._scanLoadedBlocks(rowModel);
				return {
					status: 'ok',
					scope,
					rows: refs,
					complete: false,
					message: 'filteredRows returns only loaded blocks for infinite row model',
				};
			}

			case 'selectedRows':
				return this._scanSelectedRows(rowModel, state);

			case 'visibleRows': {
				const refs = this._scanVisibleRows(rowModel);
				return { status: 'ok', scope, rows: refs, complete: false };
			}

			case 'currentPage':
				return {
					status: 'unsupported',
					scope,
					reason: 'currentPage is not applicable to infinite row model; use loadedRows',
				};

			case 'serverProvided':
				return {
					status: 'unsupported',
					scope,
					reason: 'serverProvided scope must be published via api.integrity.publishServerReport()',
				};

			default:
				return { status: 'unsupported', scope, reason: `Unknown scope: ${scope as string}` };
		}
	}

	private _scanLoadedBlocks(rowModel: RowModel<TRowData>): GridIntegrityRowRef<TRowData>[] {
		const refs: GridIntegrityRowRef<TRowData>[] = [];
		const count = rowModel.getVisualRowCount();
		for (let i = 0; i < count; i++) {
			const vr = rowModel.getVisualRow(i);
			if (!vr || vr.kind !== 'data' || vr.node.data == null) continue;
			refs.push({ rowId: vr.node.id, row: vr.node.data as TRowData, rowIndex: i, source: 'infiniteLoaded' });
		}
		return refs;
	}

	private _scanVisibleRows(rowModel: RowModel<TRowData>): GridIntegrityRowRef<TRowData>[] {
		return this._scanLoadedBlocks(rowModel); // infinite: loaded ≈ visible
	}

	private _scanSelectedRows(rowModel: RowModel<TRowData>, state: InternalGridState<TRowData>): GridIntegrityRowsResult<TRowData> {
		const selectedIds = state.selectedRowIds ?? [];
		const refs: GridIntegrityRowRef<TRowData>[] = [];
		for (const rowId of selectedIds) {
			const node = rowModel.getRowNodeById?.(rowId) ?? null;
			if (!node || node.data == null) continue;
			refs.push({ rowId, row: node.data as TRowData, source: 'selected' });
		}
		return { status: 'ok', scope: 'selectedRows', rows: refs, complete: true };
	}
}

export class ServerPageGridIntegrityRowProvider<TRowData> implements GridIntegrityRowProvider<TRowData> {
	constructor(
		private readonly getRowModel: () => RowModel<TRowData> | null,
		private readonly getState: () => InternalGridState<TRowData>
	) {}

	getRowsForIntegrityScope(scope: GridIntegrityScope): GridIntegrityRowsResult<TRowData> {
		const rowModel = this.getRowModel();
		const state = this.getState();

		if (!rowModel) {
			return { status: 'unsupported', scope, reason: 'Row model not yet available' };
		}

		switch (scope) {
			case 'allRows':
				return {
					status: 'unsupported',
					scope,
					reason: 'allRows is not available for server-page row model unless a serverProvided report is supplied. Use currentPage for the current page only.',
				};

			case 'loadedRows':
			case 'currentPage': {
				const refs = this._scanCurrentPage(rowModel);
				return { status: 'ok', scope, rows: refs, complete: false };
			}

			case 'filteredRows': {
				const refs = this._scanCurrentPage(rowModel);
				return {
					status: 'ok',
					scope,
					rows: refs,
					complete: false,
					message: 'filteredRows returns only current page for server-page row model',
				};
			}

			case 'selectedRows':
				return this._scanSelectedRows(rowModel, state);

			case 'visibleRows': {
				const refs = this._scanCurrentPage(rowModel);
				return { status: 'ok', scope, rows: refs, complete: false };
			}

			case 'serverProvided':
				return {
					status: 'unsupported',
					scope,
					reason: 'serverProvided scope must be published via api.integrity.publishServerReport()',
				};

			default:
				return { status: 'unsupported', scope, reason: `Unknown scope: ${scope as string}` };
		}
	}

	private _scanCurrentPage(rowModel: RowModel<TRowData>): GridIntegrityRowRef<TRowData>[] {
		const refs: GridIntegrityRowRef<TRowData>[] = [];
		const count = rowModel.getVisualRowCount();
		for (let i = 0; i < count; i++) {
			const vr = rowModel.getVisualRow(i);
			if (!vr || vr.kind !== 'data' || vr.node.data == null) continue;
			refs.push({ rowId: vr.node.id, row: vr.node.data as TRowData, rowIndex: i, source: 'serverPage' });
		}
		return refs;
	}

	private _scanSelectedRows(rowModel: RowModel<TRowData>, state: InternalGridState<TRowData>): GridIntegrityRowsResult<TRowData> {
		const selectedIds = state.selectedRowIds ?? [];
		const refs: GridIntegrityRowRef<TRowData>[] = [];
		for (const rowId of selectedIds) {
			const node = rowModel.getRowNodeById?.(rowId) ?? null;
			if (!node || node.data == null) continue;
			refs.push({ rowId, row: node.data as TRowData, source: 'selected' });
		}
		return { status: 'ok', scope: 'selectedRows', rows: refs, complete: true };
	}
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface AllDataNodeCapable<TRowData> {
	getAllDataNodes(): Array<{ id: string; data: TRowData | null }>;
}

function _asAllDataNodeCapable<TRowData>(rowModel: RowModel<TRowData>): AllDataNodeCapable<TRowData> | null {
	const m = rowModel as unknown as Partial<AllDataNodeCapable<TRowData>>;
	return typeof m.getAllDataNodes === 'function' ? (m as AllDataNodeCapable<TRowData>) : null;
}

interface FilteredDataNodeCapable<TRowData> {
	getFilteredDataNodes(): Array<{ id: string; data: TRowData | null }>;
}

function _asFilteredDataNodeCapable<TRowData>(rowModel: RowModel<TRowData>): FilteredDataNodeCapable<TRowData> | null {
	const m = rowModel as unknown as Partial<FilteredDataNodeCapable<TRowData>>;
	return typeof m.getFilteredDataNodes === 'function' ? (m as FilteredDataNodeCapable<TRowData>) : null;
}

interface CurrentPageCapable<TRowData> {
	getCurrentPageDataNodes(): Array<{ id: string; data: TRowData | null }>;
}

function _asCurrentPageCapable<TRowData>(rowModel: RowModel<TRowData>): CurrentPageCapable<TRowData> | null {
	const m = rowModel as unknown as Partial<CurrentPageCapable<TRowData>>;
	return typeof m.getCurrentPageDataNodes === 'function' ? (m as CurrentPageCapable<TRowData>) : null;
}
