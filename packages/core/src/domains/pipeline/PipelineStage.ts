import type { GridChangeSet } from '../../kernel/GridChangeSet.js';
import type { FilterModel, SortModel } from './PipelineModels.js';

/**
 * Shared context handed to every pipeline stage (ARCHITECTURE.md §3 R7).
 */
export interface PipelineContext {
	readonly sortModel: SortModel;
	readonly filterModel: FilterModel;
}

export interface PipelineUpdateResult<Out> {
	readonly output: Out;
	/** True when the stage rebuilt from scratch rather than applying an incremental update. */
	readonly rebuilt: boolean;
}

/**
 * A pipeline stage transforms one representation into the next (ARCHITECTURE.md §3 R7). `build`
 * produces output from scratch; `update` applies a change set incrementally. Stages start with an
 * honest rebuild-based `update` (no fake incrementalism); true incremental paths are added per
 * stage without changing the contract or callers.
 */
export interface PipelineStage<In, Out> {
	readonly id: string;
	build(input: In, ctx: PipelineContext): Out;
	update(previous: Out, changeSet: GridChangeSet, ctx: PipelineContext, input: In): PipelineUpdateResult<Out>;
}
