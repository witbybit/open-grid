// Pipeline domain — rows → visual model + the shared impact classifier (ARCHITECTURE.md §3 R6–R7).
export type { RowWriteImpact, RowWriteImpactContext } from './RowWriteImpact.js';
export { classifyChangedFields, classifyWriteImpact, impactRequiresPipelineRebuild } from './RowWriteImpact.js';

export type { VisualRow, GroupVisualRowInit } from './VisualRow.js';
export { dataVisualRow, groupVisualRow, isDataVisualRow, rowIdOfVisualRow } from './VisualRow.js';

export type { GroupByColumn, GroupByModel } from './GroupModel.js';
export { EMPTY_GROUP_BY, GroupExpansionState, groupColumnIds } from './GroupModel.js';
export { buildGroupedVisualRows } from './GroupStage.js';
export { EMPTY_VISUAL_MODEL, VisualModel } from './VisualModel.js';

export type { ColumnFilter, FilterModel, SortDirection, SortKey, SortModel } from './PipelineModels.js';
export { EMPTY_FILTER_MODEL, EMPTY_SORT_MODEL, filterColumnIds, sortColumnIds } from './PipelineModels.js';

export type { PipelineContext, PipelineStage, PipelineUpdateResult } from './PipelineStage.js';
export { FilterStage } from './FilterStage.js';
export { SortStage } from './SortStage.js';
export { FlattenStage } from './FlattenStage.js';
export { getFieldValue, defaultCompare } from './fieldValue.js';

export { RowPipeline } from './RowPipeline.js';
export type { RowSource } from './RowPipeline.js';
export { registerPipelineCommands } from './PipelineCommands.js';
