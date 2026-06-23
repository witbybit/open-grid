import { handlerApplied } from '../../kernel/GridCommit.js';
import type { GridKernel } from '../../kernel/GridKernel.js';
import type { FilterModel, SortModel } from './PipelineModels.js';
import type { RowPipeline } from './RowPipeline.js';

declare module '../../kernel/GridCommand.js' {
	interface GridCommandPayloads {
		'pipeline.setSortModel': { readonly model: SortModel };
		'pipeline.setFilterModel': { readonly model: FilterModel };
	}
}

/**
 * Register the pipeline model commands on the kernel (ARCHITECTURE.md §3 R1, R6). Setting a sort or
 * filter model recomputes the visual model and marks `pipeline` dirty so the planner re-reads it;
 * the kernel publishes `pipeline.changed`.
 *
 * @returns an unregister-all function.
 */
export function registerPipelineCommands<TRow>(kernel: GridKernel, pipeline: RowPipeline<TRow>): () => void {
	const offSort = kernel.register('pipeline.setSortModel', (command) => {
		pipeline.setSortModel(command.payload.model);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'sort' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	});

	const offFilter = kernel.register('pipeline.setFilterModel', (command) => {
		pipeline.setFilterModel(command.payload.model);
		return handlerApplied({
			dirtyDomains: ['pipeline'],
			events: [{ type: 'pipeline.changed', payload: { reason: 'filter' } }],
			renderInvalidation: { scope: 'rows', domains: ['pipeline'] },
		});
	});

	return () => {
		offSort();
		offFilter();
	};
}
