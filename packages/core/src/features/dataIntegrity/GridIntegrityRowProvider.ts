import { asServerSideControllableRowModel, type RowModel } from '../../rowModel.js';
import type { InternalGridState } from '../../state/GridState.js';
import { readInteractionState } from '../../interaction/interactionState.js';
import type {
	GridIntegrityCapabilityMatrix,
	GridIntegrityRowRef,
	GridIntegrityRowProvider,
	GridIntegrityRowsResult,
	GridIntegrityScope,
	GridIntegrityScopeCapability,
} from './integrityTypes.js';

export type GridIntegrityRowModelKind = 'client' | 'infinite' | 'server';

export interface GridIntegrityRowProviderOptions<TRowData> {
	getRowModel: () => RowModel<TRowData> | null;
	getState: () => InternalGridState<TRowData>;
	rowModelKind: GridIntegrityRowModelKind;
}

export function createGridIntegrityRowProvider<TRowData>(options: GridIntegrityRowProviderOptions<TRowData>): GridIntegrityRowProvider<TRowData> {
	return new CapabilityDrivenGridIntegrityRowProvider(options);
}

export class CapabilityDrivenGridIntegrityRowProvider<TRowData> implements GridIntegrityRowProvider<TRowData> {
	constructor(private readonly options: GridIntegrityRowProviderOptions<TRowData>) {}

	public getCapabilities(): GridIntegrityCapabilityMatrix {
		return createCapabilityMatrix(this.getEffectiveKind(this.options.getRowModel()));
	}

	public getScopeCapability(scope: GridIntegrityScope): GridIntegrityScopeCapability {
		return this.getCapabilities()[scope];
	}

	public getRowsForIntegrityScope(scope: GridIntegrityScope): GridIntegrityRowsResult<TRowData> {
		const capability = this.getScopeCapability(scope);
		const rowModel = this.options.getRowModel();
		const state = this.options.getState();
		const effectiveKind = this.getEffectiveKind(rowModel);

		if (!rowModel) {
			return {
				status: 'unsupported',
				scope,
				capability: {
					...capability,
					reason: 'Row model not yet available',
				},
				reason: 'Row model not yet available',
			};
		}

		if (capability.level === 'unsupported') {
			return {
				status: 'unsupported',
				scope,
				capability,
				reason: capability.reason ?? `Integrity scope '${scope}' is unsupported for this row model.`,
			};
		}

		switch (scope) {
			case 'allRows':
				return this.scanAllRows(rowModel, capability);
			case 'loadedRows':
				return effectiveKind === 'client'
					? this.scanAllRows(rowModel, capability)
					: this.scanVisualRows(rowModel, scope, capability, sourceForLoaded(effectiveKind));
			case 'filteredRows':
				return this.scanFilteredRows(rowModel, capability);
			case 'selectedRows':
				return this.scanSelectedRows(rowModel, state, capability);
			case 'visibleRows':
				return this.scanVisualRows(rowModel, scope, capability, 'visible');
			case 'currentPage':
				return this.scanCurrentPageRows(rowModel, capability);
			case 'serverProvided':
				return {
					status: 'unsupported',
					scope,
					capability,
					reason: capability.reason ?? 'serverProvided scope must be supplied through publishServerReport().',
				};
		}
	}

	private scanAllRows(rowModel: RowModel<TRowData>, capability: GridIntegrityScopeCapability): GridIntegrityRowsResult<TRowData> {
		const allDataCapable = asAllDataNodeCapable(rowModel);
		if (!allDataCapable) {
			return unsupportedFromMissingCapability('allRows', capability, 'Row model does not implement getAllDataNodes().');
		}
		return okResult('allRows', capability, toRowRefs(allDataCapable.getAllDataNodes(), 'client'));
	}

	private scanFilteredRows(rowModel: RowModel<TRowData>, capability: GridIntegrityScopeCapability): GridIntegrityRowsResult<TRowData> {
		const filteredCapable = asFilteredDataNodeCapable(rowModel);
		if (!filteredCapable) {
			return unsupportedFromMissingCapability('filteredRows', capability, 'Row model does not implement getFilteredDataNodes().');
		}
		return okResult('filteredRows', capability, toRowRefs(filteredCapable.getFilteredDataNodes(), 'client'));
	}

	private scanCurrentPageRows(rowModel: RowModel<TRowData>, capability: GridIntegrityScopeCapability): GridIntegrityRowsResult<TRowData> {
		const currentPageCapable = asCurrentPageCapable(rowModel);
		if (currentPageCapable) {
			return okResult(
				'currentPage',
				capability,
				toRowRefs(currentPageCapable.getCurrentPageDataNodes(), sourceForCurrentPage(this.getEffectiveKind(rowModel)))
			);
		}
		if (this.getEffectiveKind(rowModel) === 'server') {
			const refs: GridIntegrityRowRef<TRowData>[] = [];
			const count = rowModel.getVisualRowCount();
			for (let i = 0; i < count; i++) {
				const vr = rowModel.getVisualRow(i);
				if (!vr || vr.kind !== 'data' || vr.node.data == null) continue;
				refs.push({
					rowId: vr.node.id,
					row: vr.node.data as TRowData,
					rowIndex: i,
					source: sourceForCurrentPage('server'),
				});
			}
			return okResult('currentPage', capability, refs);
		}
		return unsupportedFromMissingCapability('currentPage', capability, 'Row model does not implement getCurrentPageDataNodes().');
	}

	private scanSelectedRows(
		rowModel: RowModel<TRowData>,
		state: InternalGridState<TRowData>,
		capability: GridIntegrityScopeCapability
	): GridIntegrityRowsResult<TRowData> {
		const refs: GridIntegrityRowRef<TRowData>[] = [];
		for (const rowId of readInteractionState(state).rowSelection.selectedRowIds) {
			const node = rowModel.getRowNodeById?.(rowId) ?? null;
			if (!node || node.data == null) continue;
			refs.push({ rowId, row: node.data as TRowData, source: 'selected' });
		}
		return okResult('selectedRows', capability, refs);
	}

	private scanVisualRows(
		rowModel: RowModel<TRowData>,
		scope: 'loadedRows' | 'visibleRows',
		capability: GridIntegrityScopeCapability,
		source: GridIntegrityRowRef<TRowData>['source']
	): GridIntegrityRowsResult<TRowData> {
		const refs: GridIntegrityRowRef<TRowData>[] = [];
		const count = rowModel.getVisualRowCount();
		for (let i = 0; i < count; i++) {
			const vr = rowModel.getVisualRow(i);
			if (!vr || vr.kind !== 'data' || vr.node.data == null) continue;
			refs.push({
				rowId: vr.node.id,
				row: vr.node.data as TRowData,
				rowIndex: i,
				source,
			});
		}
		return okResult(scope, capability, refs);
	}

	private getEffectiveKind(rowModel: RowModel<TRowData> | null): GridIntegrityRowModelKind {
		if (rowModel) {
			if (asServerSideControllableRowModel(rowModel)) return 'server';
			const capable = asCapabilityReadableRowModel(rowModel);
			if (capable) {
				const capabilities = capable.getCapabilities();
				if (capabilities.serverPagination) return 'server';
				if (capabilities.blockLoading) return this.options.rowModelKind === 'server' ? 'server' : 'infinite';
				if (capabilities.fullDataset) return 'client';
			}
			if (asAllDataNodeCapable(rowModel) && asFilteredDataNodeCapable(rowModel)) return 'client';
			if (asCurrentPageCapable(rowModel)) return 'server';
			if (this.options.rowModelKind !== 'client') return this.options.rowModelKind;
			return 'infinite';
		}
		return this.options.rowModelKind;
	}
}

function createCapabilityMatrix(kind: GridIntegrityRowModelKind): GridIntegrityCapabilityMatrix {
	if (kind === 'client') {
		return {
			allRows: { scope: 'allRows', level: 'authoritative', complete: true, source: 'allDataNodes' },
			loadedRows: { scope: 'loadedRows', level: 'authoritative', complete: true, source: 'allDataNodes' },
			filteredRows: { scope: 'filteredRows', level: 'authoritative', complete: true, source: 'filteredDataNodes' },
			selectedRows: { scope: 'selectedRows', level: 'authoritative', complete: true, source: 'selectedRows' },
			visibleRows: {
				scope: 'visibleRows',
				level: 'partial',
				complete: false,
				source: 'visualRows',
				message: 'visibleRows scans only the currently rendered visual rows.',
			},
			currentPage: { scope: 'currentPage', level: 'authoritative', complete: true, source: 'currentPageDataNodes' },
			serverProvided: {
				scope: 'serverProvided',
				level: 'unsupported',
				complete: false,
				source: 'serverProvided',
				reason: 'serverProvided integrity must be published through publishServerReport().',
			},
		};
	}

	if (kind === 'infinite') {
		return {
			allRows: {
				scope: 'allRows',
				level: 'unsupported',
				complete: false,
				source: 'none',
				reason: 'Infinite row model cannot authoritatively scan allRows without a serverProvided report.',
			},
			loadedRows: {
				scope: 'loadedRows',
				level: 'partial',
				complete: false,
				source: 'loadedRows',
				message: 'loadedRows scans only the currently loaded blocks.',
			},
			filteredRows: {
				scope: 'filteredRows',
				level: 'unsupported',
				complete: false,
				source: 'none',
				reason: 'Infinite row model cannot authoritatively expose filteredRows beyond currently loaded blocks.',
			},
			selectedRows: { scope: 'selectedRows', level: 'authoritative', complete: true, source: 'selectedRows' },
			visibleRows: {
				scope: 'visibleRows',
				level: 'partial',
				complete: false,
				source: 'visualRows',
				message: 'visibleRows scans only the currently rendered rows.',
			},
			currentPage: {
				scope: 'currentPage',
				level: 'unsupported',
				complete: false,
				source: 'none',
				reason: 'currentPage is not defined for the infinite row model.',
			},
			serverProvided: {
				scope: 'serverProvided',
				level: 'unsupported',
				complete: false,
				source: 'serverProvided',
				reason: 'serverProvided integrity must be published through publishServerReport().',
			},
		};
	}

	return {
		allRows: {
			scope: 'allRows',
			level: 'unsupported',
			complete: false,
			source: 'none',
			reason: 'server-side row model cannot authoritatively scan allRows without a serverProvided report.',
		},
		loadedRows: {
			scope: 'loadedRows',
			level: 'partial',
			complete: false,
			source: 'loadedRows',
			message: 'loadedRows scans only the currently loaded server-side stores.',
		},
		filteredRows: {
			scope: 'filteredRows',
			level: 'unsupported',
			complete: false,
			source: 'none',
			reason: 'server-side row model cannot authoritatively expose filteredRows outside the loaded server-side stores.',
		},
		selectedRows: { scope: 'selectedRows', level: 'authoritative', complete: true, source: 'selectedRows' },
		visibleRows: {
			scope: 'visibleRows',
			level: 'partial',
			complete: false,
			source: 'visualRows',
			message: 'visibleRows scans only the currently rendered rows.',
		},
		currentPage: {
			scope: 'currentPage',
			level: 'unsupported',
			complete: false,
			source: 'none',
			reason: 'currentPage is not defined for the server-side row model.',
		},
		serverProvided: {
			scope: 'serverProvided',
			level: 'unsupported',
			complete: false,
			source: 'serverProvided',
			reason: 'serverProvided integrity must be published through publishServerReport().',
		},
	};
}

function sourceForLoaded(kind: GridIntegrityRowModelKind): GridIntegrityRowRef<unknown>['source'] {
	return kind === 'server' ? 'serverLoaded' : 'infiniteLoaded';
}

function sourceForCurrentPage(kind: GridIntegrityRowModelKind): GridIntegrityRowRef<unknown>['source'] {
	return kind === 'server' ? 'serverLoaded' : 'client';
}

function okResult<TRowData>(
	scope: GridIntegrityScope,
	capability: GridIntegrityScopeCapability,
	rows: readonly GridIntegrityRowRef<TRowData>[]
): GridIntegrityRowsResult<TRowData> {
	return {
		status: 'ok',
		scope,
		capability,
		rows,
		complete: capability.complete,
		message: capability.message,
	};
}

function unsupportedFromMissingCapability<TRowData>(
	scope: GridIntegrityScope,
	capability: GridIntegrityScopeCapability,
	reason: string
): GridIntegrityRowsResult<TRowData> {
	return {
		status: 'unsupported',
		scope,
		capability: { ...capability, reason },
		reason,
	};
}

function toRowRefs<TRowData>(
	nodes: Array<{ id: string; data: TRowData | null }>,
	source: GridIntegrityRowRef<TRowData>['source']
): GridIntegrityRowRef<TRowData>[] {
	const refs: GridIntegrityRowRef<TRowData>[] = [];
	for (const node of nodes) {
		if (node.data == null) continue;
		refs.push({ rowId: node.id, row: node.data as TRowData, source });
	}
	return refs;
}

interface AllDataNodeCapable<TRowData> {
	getAllDataNodes(): Array<{ id: string; data: TRowData | null }>;
}

function asAllDataNodeCapable<TRowData>(rowModel: RowModel<TRowData>): AllDataNodeCapable<TRowData> | null {
	const model = rowModel as Partial<AllDataNodeCapable<TRowData>>;
	return typeof model.getAllDataNodes === 'function' ? (model as AllDataNodeCapable<TRowData>) : null;
}

interface FilteredDataNodeCapable<TRowData> {
	getFilteredDataNodes(): Array<{ id: string; data: TRowData | null }>;
}

function asFilteredDataNodeCapable<TRowData>(rowModel: RowModel<TRowData>): FilteredDataNodeCapable<TRowData> | null {
	const model = rowModel as Partial<FilteredDataNodeCapable<TRowData>>;
	return typeof model.getFilteredDataNodes === 'function' ? (model as FilteredDataNodeCapable<TRowData>) : null;
}

interface CurrentPageCapable<TRowData> {
	getCurrentPageDataNodes(): Array<{ id: string; data: TRowData | null }>;
}

function asCurrentPageCapable<TRowData>(rowModel: RowModel<TRowData>): CurrentPageCapable<TRowData> | null {
	const model = rowModel as Partial<CurrentPageCapable<TRowData>>;
	return typeof model.getCurrentPageDataNodes === 'function' ? (model as CurrentPageCapable<TRowData>) : null;
}

interface CapabilityReadableRowModel {
	getCapabilities(): {
		fullDataset?: boolean;
		blockLoading?: boolean;
		serverPagination?: boolean;
	};
}

function asCapabilityReadableRowModel(rowModel: RowModel<unknown>): CapabilityReadableRowModel | null {
	const model = rowModel as Partial<CapabilityReadableRowModel>;
	return typeof model.getCapabilities === 'function' ? (model as CapabilityReadableRowModel) : null;
}
