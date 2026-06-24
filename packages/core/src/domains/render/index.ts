// Render domain — layout brain + slot virtualization (ARCHITECTURE.md §3 R12–R13).
export type { BuildRenderPlanOptions, CellRenderPlan, RenderPlan, RowRenderPlan } from './RenderPlan.js';
export { buildRenderPlan, EMPTY_RENDER_PLAN } from './RenderPlan.js';
export type { RendererContract } from './RendererContract.js';
export type { RenderColumn, RenderDisplayConfig, RendererEngineView } from './RendererEngineView.js';
export type { RenderLayout } from './RenderLayout.js';
export {
	computeRenderLayout,
	FILTER_CHIP_BAR_HEIGHT,
	FLOATING_FILTER_HEIGHT,
	GROUP_PANEL_HEIGHT,
	LEAF_HEADER_HEIGHT,
	STATUS_BAR_HEIGHT,
} from './RenderLayout.js';
export { StableSlotAssigner } from './StableSlotAssigner.js';
export type { RowBinding } from './RowBinder.js';
export { RowBinder } from './RowBinder.js';
export type { CellContentMount, CellContentUnmount, DomGridRendererCallbacks } from './DomGridRenderer.js';
export { DomGridRenderer } from './DomGridRenderer.js';
