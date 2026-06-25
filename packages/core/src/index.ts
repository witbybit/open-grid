// @open-grid/core — public API (new command-driven architecture)
export { createGrid } from './api/GridApiFacade.js';
export type { GridApi } from './api/GridApiFacade.js';
export type { GridCoreOptions } from './api/GridCore.js';
export type { RenderColumn, RenderDisplayConfig, RendererEngineView } from './domains/render/RendererEngineView.js';

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

export type { ColumnFilter, FilterModel, FilterOperator, SortKey, SortModel } from './domains/pipeline/PipelineModels.js';
export { evaluateOperator } from './domains/pipeline/PipelineModels.js';
export type { QueryNode, QueryGroup, QueryCondition } from './domains/pipeline/GridQueryModel.js';
export { queryGroup, queryCondition, filterModelToQuery, evaluateQueryNode } from './domains/pipeline/GridQueryModel.js';
export type { GroupByColumn, GroupByModel } from './domains/pipeline/GroupModel.js';
export type { TreeDataOptions } from './domains/pipeline/TreeStage.js';
export type { VisualRow } from './domains/pipeline/VisualRow.js';

export type { CellRenderPlan, RenderPlan, RowRenderPlan } from './domains/render/RenderPlan.js';
export { StableSlotAssigner } from './domains/render/StableSlotAssigner.js';
export type { RowBinding } from './domains/render/RowBinder.js';
export { RowBinder } from './domains/render/RowBinder.js';
export type { CellContentMount, CellContentUnmount, DomGridRendererCallbacks } from './domains/render/DomGridRenderer.js';
export { DomGridRenderer } from './domains/render/DomGridRenderer.js';
export type { SelectionState } from './domains/selection/SelectionState.js';

export { SidebarStore } from './sidebar/SidebarStore.js';

export { createLocalStorageAdapter } from './domains/persistence/PersistenceAdapter.js';
export type { PersistenceAdapter } from './domains/persistence/PersistenceAdapter.js';
export { PersistenceController } from './domains/persistence/PersistenceController.js';
export type { PersistenceStatus } from './domains/persistence/PersistenceController.js';
export { GridWorkspaceController, createLocalStorageWorkspaceAdapter } from './domains/persistence/GridWorkspaceController.js';
export type { GridViewDefinition, GridWorkspaceAdapter } from './domains/persistence/GridWorkspaceController.js';
export { createGridStateSnapshot, applyGridState, isValidGridState, GRID_STATE_SCHEMA_VERSION } from './domains/persistence/GridStateSchema.js';
export type { SerializedGridState, GridStateReadPort, GridStateWritePort } from './domains/persistence/GridStateSchema.js';

export { DagEngine } from './domains/dag/DagEngine.js';
export type { ComputedColumnDef, DagEnginePort } from './domains/dag/DagEngine.js';
export { SpreadsheetFillEngine } from './domains/dag/SpreadsheetFillEngine.js';
export type { FillEnginePort, FillOperation, FillPattern } from './domains/dag/SpreadsheetFillEngine.js';

export { GridCapabilityManager } from './plugins/GridCapabilityManager.js';
export type { GridCapability } from './plugins/GridCapabilityManager.js';
export { GridPluginRegistry } from './plugins/GridPluginRegistry.js';
export type { GridPlugin } from './plugins/GridPluginRegistry.js';
export { registerGridNavigation } from './plugins/registerGridNavigation.js';
export type { GridNavigationOptions } from './plugins/registerGridNavigation.js';
export { registerGridContextMenu } from './plugins/registerGridContextMenu.js';
export type { ContextMenuItem, GridContextMenuOptions } from './plugins/registerGridContextMenu.js';

export { GridExportEngine } from './domains/export/GridExportEngine.js';
export type { ExportOptions } from './domains/export/GridExportEngine.js';
export { ClipboardController } from './domains/export/ClipboardController.js';
export type { ClipboardPort, ClipboardOptions } from './domains/export/ClipboardController.js';

export { DataIntegrityManager } from './domains/integrity/DataIntegrityManager.js';
export type { ColumnValidationConfig, IntegrityDataPort } from './domains/integrity/DataIntegrityManager.js';
export { ValidationRules } from './domains/integrity/ValidationRules.js';
export type { GridIntegrityIssue, IntegritySeverity, CellValidator, RowIntegrityRule, CellValidatorContext } from './domains/integrity/ValidationRules.js';

// Themes — standalone CSS variable system, no engine dependency
export {
  BUILT_IN_THEMES,
  BUILT_IN_THEME_ORDER,
  BUILT_IN_THEME_METADATA,
  getBuiltInTheme,
  isBuiltInThemeName,
  createTheme,
  themeToCSSVariables,
  ThemeManager,
  LIGHT_THEME,
  DARK_THEME,
} from './renderer/themes.js';
export type { ThemeTokens, BuiltInThemeName } from './renderer/themes.js';
