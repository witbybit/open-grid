import type { GridDomainId } from './GridDomain.js';
import type { GridEvent } from './GridEvent.js';

/**
 * How much of the rendered surface a commit invalidates. The render planner consumes this;
 * the renderer never recomputes business state to decide what to repaint (ARCHITECTURE.md §3 R12).
 */
export interface RenderInvalidation {
	/**
	 * - `none`    nothing visual changed
	 * - `cells`   specific cells changed value/appearance, layout unchanged
	 * - `rows`    row membership/order changed, geometry may shift
	 * - `viewport`scroll/visible-window changed only
	 * - `full`    rebuild the render plan from scratch
	 */
	readonly scope: 'none' | 'cells' | 'rows' | 'viewport' | 'full';
	/** Domains whose snapshots the planner must re-read. */
	readonly domains?: readonly GridDomainId[];
}

/**
 * A typed consequence of a commit. Domains *describe* effects in their command-handler draft;
 * the kernel is the only thing that *applies* them (ARCHITECTURE.md §3 R2).
 */
export type GridEffect =
	| { readonly kind: 'version-bump'; readonly domain: GridDomainId; readonly version: number }
	| { readonly kind: 'event'; readonly event: GridEvent }
	| { readonly kind: 'render-invalidation'; readonly invalidation: RenderInvalidation };

export const RENDER_INVALIDATION_NONE: RenderInvalidation = { scope: 'none' };
