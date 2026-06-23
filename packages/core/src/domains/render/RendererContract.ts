import type { RenderInvalidation } from '../../kernel/GridEffect.js';
import type { RenderPlan } from './RenderPlan.js';

/**
 * The contract a renderer (DOM, React adapter, test double) implements (ARCHITECTURE.md §3 R12).
 * A renderer paints plans and nothing more — it never reads row models, mutates business state, or
 * recomputes what to show. `invalidate` is an optional hint about how much of the surface changed
 * so the renderer can do partial work; `applyPlan` is always sufficient on its own.
 */
export interface RendererContract {
	applyPlan(plan: RenderPlan): void;
	invalidate?(invalidation: RenderInvalidation): void;
}
