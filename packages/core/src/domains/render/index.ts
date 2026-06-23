// Render domain — render plans + slot virtualization (ARCHITECTURE.md §3 R12–R13).
export type { BuildRenderPlanOptions, CellRenderPlan, RenderPlan, RowRenderPlan } from './RenderPlan.js';
export { buildRenderPlan, EMPTY_RENDER_PLAN } from './RenderPlan.js';
export type { RowSlot, SlotSyncResult } from './SlotModel.js';
export { RowSlotPool } from './SlotModel.js';
export type { RendererContract } from './RendererContract.js';
