# Plan 119: Unified Column Topology and Pinned-Lane Rendering

## Mission

Eliminate pinned header and floating-filter glitches by replacing independently calculated left, center, and right lane behavior with one compiled column topology consumed by every column-oriented renderer.

The target is:

```text
ColumnModel + geometry
→ one CompiledColumnTopology
→ headers, body CellViews, floating filters, overlays
```

Pinned lanes must be fixed viewport-coordinate surfaces. Only center content may translate with horizontal scroll.

This plan must make it impossible for center headers or filters to paint inside pinned lanes, even during rapid horizontal scrolling, pinning, unpinning, reordering, resizing, or grouped-header changes.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plan 118
- **Category**: column topology, headers, floating filters, pinned lanes, geometry, scrolling

## Current failure mode

The current header and floating-filter renderers independently infer lane membership and positioning from column indexes, pin counts, visible ranges, and scroll transforms.

Observed risks include:

- header identity keyed by current index rather than stable column/group identity;
- topology caches that do not include all column-order and pinning changes;
- pinned layers counter-transformed inside scrolling content coordinates;
- unclipped lane layers allowing stale transforms to paint outside their lane;
- always-on header transform transitions exposing stale positions;
- body, header, and floating-filter renderers calculating related geometry separately;
- fast horizontal scroll revealing one-frame topology drift.

A center header can therefore be reused, transformed, or parented incorrectly and become visible over a pinned lane.

## Target architecture

Create one authoritative topology:

```ts
interface CompiledColumnTopology {
	readonly version: number;
	readonly geometryVersion: number;

	readonly left: readonly ColumnPlacement[];
	readonly center: readonly ColumnPlacement[];
	readonly right: readonly ColumnPlacement[];

	readonly byColumnId: ReadonlyMap<string, ColumnPlacement>;

	readonly pinLeftWidth: number;
	readonly pinRightWidth: number;
	readonly centerViewportLeft: number;
	readonly centerViewportWidth: number;
	readonly totalContentWidth: number;
}
```

```ts
interface ColumnPlacement {
	readonly columnId: string;
	readonly column: ColumnDef;
	readonly lane: 'left' | 'center' | 'right';
	readonly laneIndex: number;
	readonly absoluteIndex: number;
	readonly absoluteLeft: number;
	readonly laneOffset: number;
	readonly width: number;
}
```

Every column-oriented subsystem consumes this topology:

- body `CellView` placement;
- leaf headers;
- grouped headers;
- floating filters;
- resize handles;
- drag indicators;
- column overlays;
- viewport center-range calculation.

No renderer independently derives lane membership from pin counts or absolute indexes.

## Core invariants

1. One topology version describes lane membership, order, offsets, and widths for all renderers.
2. Left and right lanes never translate with horizontal scroll.
3. Only center content translates by `-scrollLeft`.
4. Every lane is clipped to its viewport bounds.
5. A retained column keeps stable header, cell, and floating-filter view identity when changing lanes.
6. Header identity is based on stable logical identity, not current displayed index.
7. A topology change invalidates all topology consumers through one version.
8. Horizontal scroll does not reconcile pinned topology.
9. Center headers cannot paint outside the center clip.
10. Header animations run only for explicit drag/reorder preview, never ordinary scroll or topology sync.

## Workstream 1 — Build the topology compiler

Create a pure compiler:

```ts
compileColumnTopology(input: ColumnTopologyInput): CompiledColumnTopology
```

Inputs include:

- displayed column order;
- stable column IDs;
- pin state by identity;
- visibility;
- widths;
- viewport width;
- scrollbar/overlay constraints;
- grouping/header metadata where required.

The compiler must:

- validate duplicate IDs and illegal pin states;
- calculate lane membership;
- calculate lane-local offsets;
- calculate absolute offsets;
- calculate pinned widths and center viewport width;
- produce deterministic output;
- increment topology version only when topology-relevant data changes.

Do not embed DOM operations in the compiler.

## Workstream 2 — Make topology version authoritative

Add a topology stamp consumed by renderers:

```ts
interface ColumnTopologyStamp {
	readonly topologyVersion: number;
	readonly geometryVersion: number;
	readonly centerVisibleStart: number;
	readonly centerVisibleEnd: number;
}
```

Header, body, and floating-filter bailout logic must include the topology version.

Pinning, unpinning, order, visibility, width, grouped-header segmentation, and viewport-size changes must invalidate the relevant stamp.

Remove cache checks based only on:

- pin counts;
- total column count;
- visible range;
- current index.

## Workstream 3 — Replace header index identity

Create stable header identities.

### Leaf header

```ts
interface LeafHeaderIdentity {
	readonly kind: 'leaf';
	readonly columnId: string;
}
```

### Group segment header

A group split across lanes or visible segments requires segment identity:

```ts
interface GroupHeaderIdentity {
	readonly kind: 'group-segment';
	readonly groupId: string;
	readonly depth: number;
	readonly lane: CellLane;
	readonly firstColumnId: string;
	readonly lastColumnId: string;
}
```

Do not key headers by:

```text
depth + colStart
```

Create a stable `HeaderView`:

```ts
class HeaderView {
	readonly identity: HeaderViewIdentity;
	readonly element: HTMLElement;

	refresh(context: HeaderRenderContext): void;
	relocate(placement: HeaderPlacement): void;
	destroy(): void;
}
```

A retained leaf column changing lane relocates the same `HeaderView`.

## Workstream 4 — Rebuild the header DOM coordinate system

Use a viewport-width root:

```html
<div class="og-header-viewport">
	<div class="og-header-lane-left"></div>
	<div class="og-header-center-clip">
		<div class="og-header-center-content"></div>
	</div>
	<div class="og-header-lane-right"></div>
</div>
```

Required behavior:

- left lane anchored at viewport `left: 0`;
- right lane anchored at viewport `right: 0`;
- center clip occupies the space between pinned widths;
- center content alone translates by `-scrollLeft`;
- pinned layers never counter-transform scroll;
- all three lane surfaces use viewport coordinates.

Required CSS properties:

```css
.og-header-viewport,
.og-header-lane-left,
.og-header-center-clip,
.og-header-lane-right {
	overflow: hidden;
}

.og-header-lane-left,
.og-header-lane-right,
.og-header-center-clip {
	contain: layout paint;
}
```

Use isolation/stacking contexts where required so center content cannot paint above pinned lanes.

## Workstream 5 — Make horizontal scroll center-only

The horizontal scroll hot path must do only:

```text
update center content transform
→ reconcile center entered/exited range when necessary
```

It must not:

- reposition pinned headers;
- rebuild left/right lane arrays;
- reparent pinned header elements;
- recalculate lane membership;
- trigger pinned floating-filter work;
- animate retained header transforms.

Pinned content remains stationary unless topology or geometry changes.

## Workstream 6 — Share topology with body cells

Plan 118 `CellView` placement must consume `CompiledColumnTopology`.

Remove independent body calculations such as:

```text
index < pinLeftCount
index >= colCount - pinRightCount
```

For every rendered column, the body receives the exact same:

- lane;
- lane index;
- width;
- lane offset;
- topology version.

Body and header lane membership must be impossible to disagree on.

## Workstream 7 — Rebuild floating-filter lanes on the same model

Floating filters must use the same topology and the same viewport-coordinate lane structure as headers.

Create stable `FloatingFilterView` identity by `columnId`.

Pin/unpin relocates the same view.

Horizontal scroll translates only center floating-filter content.

Remove copied lane arithmetic and counter-transform logic from the floating-filter renderer.

Prefer a shared primitive:

```ts
class ColumnLaneSurface<TView> {
	reconcile(topology, visibleCenterRange): void;
	syncCenterScroll(scrollLeft): void;
	destroy(): void;
}
```

Do not force headers and floating filters into one class if their lifecycle differs, but share topology, clipping, coordinate rules, and reconciliation contracts.

## Workstream 8 — Atomic topology reconciliation

For pin/unpin, visibility, and reorder:

1. Compile the complete next topology.
2. Diff by stable column identity.
3. Identify retained, entered, exited, and relocated views.
4. Relocate retained body/header/filter views.
5. Create entered views.
6. Destroy exited views.
7. Rebuild grouped-header segments.
8. Publish one topology version.
9. Request one geometry/header/viewport frame.

Define:

```ts
interface ColumnTopologyDiff {
	readonly retained: readonly ColumnTopologyMove[];
	readonly entered: readonly ColumnPlacement[];
	readonly exited: readonly ColumnPlacement[];
}
```

A lane change is retained/relocated, never exited/entered.

## Workstream 9 — Restrict header animation

Remove global steady-state transform transitions.

Default:

```css
.og-header-cell-movable {
	transition: none;
}
```

Enable animation only while explicit column-drag/reorder preview is active:

```css
.og-column-reorder-active .og-header-cell-movable {
	transition: transform 180ms cubic-bezier(...);
}
```

Disable transitions during:

- horizontal scrolling;
- pin/unpin;
- width changes;
- topology reconciliation;
- initial layout;
- restore.

## Workstream 10 — Unify grouped-header segmentation

Group headers crossing lane boundaries must be split into explicit lane segments.

The topology/group compiler must define each segment before DOM reconciliation.

A group segment may never visually cross a lane clip.

Required outputs include:

- stable group identity;
- lane;
- segment first/last column IDs;
- width;
- lane offset;
- depth.

Do not derive group segments from stale rendered leaf indexes.

## Workstream 11 — Tactical fixes during migration

Before full topology migration, immediately:

- add `overflow: hidden` and paint containment to pinned header/filter layers;
- disable steady-state header transform transitions;
- key leaf headers by `columnId`;
- include topology/column version in header bailout;
- force complete header/filter topology reconciliation on pin/unpin;
- ensure pinned offsets are lane-relative.

These tactical fixes must be removed or absorbed into the final architecture. Do not retain duplicate topology systems.

## Mandatory demolition

Delete before completion:

- header keys based on `depth:colStart` for leaf identity;
- lane inference duplicated across header/body/filter renderers;
- pinned counter-transforms tied to scroll position;
- content-width parent coordinate tricks for pinned lanes;
- unclipped pinned/header/filter surfaces;
- always-on header transform transitions;
- pin-count-only render bailouts;
- topology changes represented as full destroy/recreate for retained columns;
- floating-filter copied lane arithmetic;
- direct body/header lane calculations outside the topology compiler;
- tactical dual-topology compatibility code;
- full repaint fallbacks used to mask lane drift.

## Behavioral verification

Add tests proving:

1. Fast horizontal scroll never shows center headers in left/right pinned lanes.
2. Fast horizontal scroll never shows center floating filters in pinned lanes.
3. Pinned headers remain stationary across scroll frames.
4. Only center content transform changes during steady horizontal scroll.
5. Pin/unpin relocates retained leaf header instances.
6. Pin/unpin relocates retained floating-filter instances.
7. Header and body always agree on each column lane.
8. Group headers split correctly at lane boundaries.
9. Reorder and visibility changes cannot reuse a header for another logical column.
10. Width changes preserve header identity and correct clipping.
11. Topology bailout never misses equal-count identity changes.
12. Rapid pin/unpin while scrolling produces no overlap or blank lane.
13. Right-pinned geometry remains correct across viewport resize.
14. RTL mode uses the same topology invariants with mirrored coordinates.
15. Browser zoom/fractional widths do not create lane gaps or overlap.
16. Header transitions run only during explicit reorder preview.
17. Stale topology work is rejected by version.
18. Floating filters and headers use the same topology version.
19. Center content cannot paint outside its clip under any transform.
20. Repeated topology changes leak no header/filter views.

Use Playwright screenshots/video or frame capture during high-speed horizontal scroll, not only final-state assertions.

## Performance gates

### Steady horizontal scroll

Expected:

```text
pinned header layout writes per frame: 0
pinned floating-filter layout writes per frame: 0
retained header mounts/destroys: 0
retained CellView mounts/destroys: 0
```

Only center transform and entered/exited center range reconciliation are allowed.

### Pin/unpin

Expected:

- one topology compilation;
- one topology reconciliation;
- retained view relocation rather than recreation;
- one final render frame;
- stable React component and header instance counts.

### Wide-column virtualization

Benchmark 100–200 columns with pinned left/right lanes and rapid direction changes.

No regression may be hidden by increased overscan or disabling virtualization.

## Instrumentation

Add or consolidate:

```ts
GridMetric.COLUMN_TOPOLOGY_COMPILED;
GridMetric.COLUMN_TOPOLOGY_RECONCILED;
GridMetric.HEADER_VIEW_CREATED;
GridMetric.HEADER_VIEW_DESTROYED;
GridMetric.HEADER_VIEW_RELOCATED;
GridMetric.FLOATING_FILTER_VIEW_CREATED;
GridMetric.FLOATING_FILTER_VIEW_DESTROYED;
GridMetric.FLOATING_FILTER_VIEW_RELOCATED;
GridMetric.PINNED_LANE_WRITE_DURING_SCROLL;
GridMetric.STALE_TOPOLOGY_OPERATION_REJECTED;
GridMetric.LANE_CLIP_VIOLATION;
```

Normal scenarios must keep:

```text
PINNED_LANE_WRITE_DURING_SCROLL = 0
LANE_CLIP_VIOLATION = 0
```

## Evidence required

The implementation report must include:

1. Before/after lane DOM diagrams.
2. The topology compiler contract and sample output.
3. Deleted independent lane calculations.
4. Header and floating-filter identity strategy.
5. Fast horizontal-scroll visual regression evidence.
6. Pinned-lane write metrics.
7. Header/filter mount and relocation counts.
8. Wide-grid performance comparison.
9. Confirmation that header, body, and filters consume one topology version.
10. RTL and resize results.

## Stop conditions

Stop and redesign if:

- pinned lanes still require scroll counter-transforms;
- headers, cells, and filters cannot share one topology placement;
- identity remains index-based;
- retained views must be recreated on pin/unpin;
- correctness requires full header rebuild on every horizontal frame;
- clipping alone hides stale ownership rather than topology correctness;
- performance is recovered only by increasing overscan or suppressing updates.

## Completion gate

Plan 119 is complete only when:

> One compiled column topology is the sole authority for lane membership, order, width, and offsets across headers, body `CellView`s, floating filters, and column overlays. Pinned lanes remain fixed and clipped in viewport coordinates; only center content scrolls; retained views relocate rather than recreate; and no center content can appear in pinned lanes under fast scrolling or topology changes.
