import type { GridLayoutPlan } from './layoutPlan.js';

/**
 * Declarative DOM-layer registry (Plan 039 Phase 1).
 *
 * Every structural layer the grid mounts is described here once: its class, its
 * parent, its sibling order, and a pure `apply(el, plan)` that positions/sizes it
 * from the layout plan — never from magic pixel constants. `ViewportRenderer` builds
 * the DOM by iterating this table and re-positions every layer by looping it again on
 * each `syncLayoutPlan`. New layers (status bar, pagination, find-bar, side panels)
 * slot in by adding a descriptor here plus a renderer — with no edits to the mount or
 * sync bodies.
 *
 * Invariants enforced by guard tests:
 *  - Every `.og-layer-*` element in the DOM corresponds to a registry entry.
 *  - No renderer sets a layer's structural top/height/width outside its `apply`.
 */

/** A parent is one of the two DOM roots, or another layer's `id`. */
export type LayerParentRef = 'scroll-viewport' | 'container' | string;

export interface LayerDescriptor {
	/** Stable id used for parent references and named lookup. */
	id: string;
	className: string;
	parent: LayerParentRef;
	/** Sibling order within the parent (ascending). */
	order: number;
	/** One-time inline setup at mount that does not depend on the plan. */
	init?(el: HTMLDivElement): void;
	/** Position/size purely from the layout plan. Runs on every syncLayoutPlan. */
	apply?(el: HTMLDivElement, plan: GridLayoutPlan): void;
}

export const LAYER_REGISTRY: LayerDescriptor[] = [
	{
		id: 'group-panel',
		className: 'og-group-panel',
		parent: 'scroll-viewport',
		order: 0,
		init(el) {
			el.style.display = 'none';
		},
		apply(el, plan) {
			const visible = plan.chrome.groupPanelHeight > 0;
			el.style.display = visible ? 'flex' : 'none';
			el.style.height = visible ? `${plan.chrome.groupPanelHeight}px` : '0';
		},
	},
	{
		id: 'header-wrapper',
		className: 'og-layer-header-wrapper',
		parent: 'scroll-viewport',
		order: 1,
		apply(el, plan) {
			el.style.top = `${plan.origins.headerTop}px`;
			el.style.height = `${plan.chrome.totalHeaderHeight}px`;
			el.style.width = `${plan.dimensions.contentWidth}px`;
		},
	},
	{
		id: 'header',
		className: 'og-layer-header',
		parent: 'header-wrapper',
		order: 0,
		apply(el, plan) {
			el.style.width = `${plan.dimensions.contentWidth}px`;
		},
	},
	{
		id: 'header-left',
		className: 'og-layer-header-left',
		parent: 'header-wrapper',
		order: 1,
		apply(el, plan) {
			el.style.width = `${plan.columns.pinLeftWidth}px`;
		},
	},
	{
		id: 'header-right',
		className: 'og-layer-header-right',
		parent: 'header-wrapper',
		order: 2,
		apply(el, plan) {
			el.style.width = `${plan.columns.pinRightWidth}px`;
		},
	},
	{
		id: 'sticky-groups',
		className: 'og-layer-sticky-groups',
		parent: 'scroll-viewport',
		order: 2,
		apply(el, plan) {
			el.style.width = `${plan.dimensions.contentWidth}px`;
			el.style.transform = `translate3d(0, ${plan.origins.stickyGroupLayerTop}px, 0)`;
		},
	},
	{
		id: 'rows',
		className: 'og-rows-container',
		parent: 'scroll-viewport',
		order: 3,
		apply(el, plan) {
			el.style.height = `${plan.dimensions.contentHeight}px`;
			el.style.width = `${plan.dimensions.contentWidth}px`;
		},
	},
	{
		id: 'overlay',
		className: 'og-layer-overlay',
		parent: 'container',
		order: 1,
		apply(el, plan) {
			el.style.top = `${plan.origins.overlayTop}px`;
		},
	},
];
