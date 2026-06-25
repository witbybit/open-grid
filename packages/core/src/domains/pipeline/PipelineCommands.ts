import { handlerApplied } from '../../kernel/GridCommit.js';
import type { GridKernel } from '../../kernel/GridKernel.js';
import type { GroupByModel } from './GroupModel.js';
import type { FilterModel, SortModel } from './PipelineModels.js';
import type { QueryNode } from './GridQueryModel.js';
import type { RowPipeline } from './RowPipeline.js';
import type { TreeDataOptions } from './TreeStage.js';

declare module '../../kernel/GridCommand.js' {
	interface GridCommandPayloads {
		'pipeline.setSortModel': { readonly model: SortModel };
		'pipeline.setFilterModel': { readonly model: FilterModel };
		'pipeline.setQuery': { readonly node: QueryNode | null };
		'pipeline.setGroupBy': { readonly model: GroupByModel };
		'pipeline.toggleGroup': { readonly groupKey: string };
		'pipeline.setGroupExpanded': { readonly groupKey: string; readonly expanded: boolean };
		'pipeline.expandAllGroups': Record<string, never>;
		'pipeline.collapseAllGroups': Record<string, never>;
		'pipeline.setTreeData': { readonly options: TreeDataOptions | null };
		'pipeline.toggleTreeNode': { readonly rowId: string };
		'pipeline.toggleDetail': { readonly rowId: string };
		'pipeline.setDetailOpen': { readonly rowId: string; readonly open: boolean };
	}
}

/**
 * Register all pipeline commands on the kernel (ARCHITECTURE.md §3 R1, R6).
 * @returns an unregister-all function.
 */
export function registerPipelineCommands<TRow>(kernel: GridKernel, pipeline: RowPipeline<TRow>): () => void {
	const offs: Array<() => void> = [];

	offs.push(kernel.register('pipeline.setSortModel', (command) => {
		pipeline.setSortModel(command.payload.model);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'sort' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.setFilterModel', (command) => {
		pipeline.setFilterModel(command.payload.model);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'filter' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.setQuery', (command) => {
		pipeline.setQueryNode(command.payload.node);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'query' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.setGroupBy', (command) => {
		pipeline.setGroupBy(command.payload.model);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'group' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.toggleGroup', (command) => {
		pipeline.toggleGroup(command.payload.groupKey);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'groupExpansion' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.setGroupExpanded', (command) => {
		pipeline.setGroupExpanded(command.payload.groupKey, command.payload.expanded);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'groupExpansion' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.expandAllGroups', () => {
		pipeline.expandAllGroups();
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'groupExpansion' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.collapseAllGroups', () => {
		pipeline.collapseAllGroups();
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'groupExpansion' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.setTreeData', (command) => {
		pipeline.setTreeData(command.payload.options as TreeDataOptions<TRow> | null);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'treeData' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.toggleTreeNode', (command) => {
		pipeline.toggleTreeNode(command.payload.rowId);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'treeExpansion' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.toggleDetail', (command) => {
		pipeline.toggleDetail(command.payload.rowId);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'detailExpansion' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	offs.push(kernel.register('pipeline.setDetailOpen', (command) => {
		pipeline.setDetailOpen(command.payload.rowId, command.payload.open);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'detailExpansion' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	}));

	return () => { offs.forEach((off) => off()); };
}
