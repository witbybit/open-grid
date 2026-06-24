// `@open-grid/core/next` — the Plan 132 kernel-based core.
//
// A dedicated migration entrypoint for the new command-driven architecture while the old
// GridStore/GridEngine core still occupies the main barrel. Promoted to `index.ts` once the old
// architecture is removed. Kept separate from `experimental.ts`, whose export surface is a curated,
// guard-tested contract.

export { createGrid } from './api/GridApiFacade.js';
export type { GridApi } from './api/GridApiFacade.js';
export type { GridColumnHeader, GridCoreOptions } from './api/GridCore.js';

export { GridKernel } from './kernel/index.js';
export type { GridCommand, GridCommandResult, GridEvent, GridEventListener } from './kernel/index.js';

export { asRowId, asVisualRowId } from './domains/rows/RowId.js';
export type { RowId, VisualRowId } from './domains/rows/RowId.js';
export type { RowModelType } from './domains/rows/RowModelType.js';
export type { RowNode } from './domains/rows/RowNode.js';
export type { RowModelCapabilities } from './domains/rows/RowModelCapabilities.js';
export type { RowTransaction } from './domains/rows/RowCommand.js';

export { asColumnId } from './domains/columns/ColumnId.js';
export type { ColumnId } from './domains/columns/ColumnId.js';
export type { ColumnDef, ColumnPin } from './domains/columns/ColumnDef.js';
export type { ColumnState } from './domains/columns/ColumnState.js';

export { createCellAddress, cellId } from './domains/cells/CellAddress.js';
export type { CellAddress, CellId } from './domains/cells/CellAddress.js';

export type { ColumnFilter, FilterModel, SortKey, SortModel } from './domains/pipeline/PipelineModels.js';
export type { VisualRow } from './domains/pipeline/VisualRow.js';

export type { CellRenderPlan, RenderPlan, RowRenderPlan } from './domains/render/RenderPlan.js';
export type { SelectionState } from './domains/selection/SelectionState.js';
