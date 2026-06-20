# Plan 118: Stable CellView Ownership and Renderer Lifecycle Convergence

## Mission

Eliminate blank cells, stale React portals, and renderer glitches by replacing lane-owned cell slots with one stable `CellView` per physical row slot and rendered column.

This plan must make primitive text, DOM renderers, React renderers, editors, and loading cells follow the same ownership and lifecycle contract.

The target execution model is:

```text
RowSlot
→ stable CellView keyed by columnId
→ lane is placement only
→ row changes refresh binding
→ renderer structure changes only when topology truly enters/exits
```

This is not a full-redraw plan. Do not solve the symptoms with broader invalidation, forced synchronous portal rebuilds, or extra content clearing.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plan 112 foundation demolition
- **Blocks**: Plan 119
- **Category**: renderer ownership, virtualization, React adapter, lifecycle, performance

## Current failure mode

The current row slot owns separate lane arrays:

```ts
leftCells[]
centerCells[]
rightCells[]
```

A column moving between lanes can therefore acquire a different physical cell container while retaining a renderer key based primarily on row slot and column.

During pin/unpin or topology changes, the old lane may release ownership after the new lane has mounted the same logical renderer. React cells are particularly vulnerable because changing a portal target is a structural operation, while primitive content may be cleared before the replacement portal commit becomes visible.

This produces:

- blank React cells after pin/unpin;
- unrelated cells becoming blank;
- stale releases unmounting newly relocated portals;
- React-specific deferred repair paths during scroll;
- renderer remounts for placement-only changes;
- inconsistent behavior between primitive and custom cells.

## Target ownership model

Each `RowSlot` owns one physical cell view for each currently rendered column:

```ts
class RowSlot<TRowData> {
	readonly cellsByColumnId: Map<string, CellView<TRowData>>;

	readonly leftPlacement: CellView<TRowData>[];
	readonly centerPlacement: CellView<TRowData>[];
	readonly rightPlacement: CellView<TRowData>[];
}
```

The map owns lifecycle.

The lane arrays are derived placement/order views only.

For a given row slot:

```text
columnId → at most one CellView
```

Moving a column from center to left must move the same DOM cell and portal host. It must not create a second cell or retarget a portal to a new host.

## Core invariants

1. One rendered column has at most one `CellView` per row slot.
2. Lane changes relocate a `CellView`; they do not destroy or recreate it.
3. React component instances survive pinning, unpinning, width changes, and retained reordering.
4. Vertical row-slot reuse refreshes cell binding without structural portal churn.
5. Horizontal virtualization acquires/releases cells only when columns genuinely enter or leave the rendered topology.
6. Every deferred operation carries exact physical cell identity.
7. A stale release cannot affect a relocated or rebound cell.
8. Primitive and custom renderers use one lifecycle vocabulary.
9. Existing content remains visible until replacement content is committed.
10. Full redraw is never the correctness mechanism for ordinary pin/unpin.

## Target types

### Physical identity

```ts
interface CellInstanceIdentity {
	readonly cellInstanceId: string;
	readonly rowSlotId: string;
	readonly columnId: string;
	readonly cellGeneration: number;
	readonly rowBindingGeneration: number;
}
```

Semantics:

- `cellInstanceId` identifies the physical `CellView`.
- `cellGeneration` advances only when that physical cell is destroyed and recreated.
- `rowBindingGeneration` advances when the row slot is rebound to another logical row.
- Lane and lane index are placement properties, not ownership identity.

### Placement

```ts
type CellLane = 'left' | 'center' | 'right';

interface CellPlacement {
	readonly lane: CellLane;
	readonly laneIndex: number;
	readonly laneOffset: number;
	readonly width: number;
}
```

### Unified renderer lifecycle

```ts
interface CellRendererHandle<TRowData> {
	mount(context: CellRenderContext<TRowData>): void;

	refresh(context: CellRenderContext<TRowData>): boolean;

	relocate?(placement: CellPlacement): void;

	destroy(): void;
}
```

Implementations may include:

- `PrimitiveTextRendererHandle`
- `DomCellRendererHandle`
- `ReactCellRendererHandle`
- `EditorRendererHandle`
- `LoadingCellRendererHandle`

`refresh()` returning `true` means the current renderer instance remains valid. Returning `false` authorizes controlled recreation.

### Stable cell object

```ts
class CellView<TRowData> {
	readonly identity: CellInstanceIdentity;
	readonly element: HTMLElement;
	readonly textLayer: HTMLElement;
	readonly domLayer: HTMLElement;
	readonly portalHost: HTMLElement;

	readonly columnId: string;

	placement: CellPlacement;
	renderer: CellRendererHandle<TRowData> | null;

	bindRow(context: CellRenderContext<TRowData>): void;
	refresh(context: CellRenderContext<TRowData>): void;
	relocate(placement: CellPlacement): void;
	switchRenderer(next: CellRendererDescriptor<TRowData>): void;
	destroy(): void;
}
```

`CellView` owns:

- the physical cell element;
- primitive content layer;
- imperative DOM layer;
- React portal host;
- renderer handle;
- ownership token;
- current row binding;
- current placement.

## Workstream 1 — Add exact physical ownership

Before changing the lane model, harden every renderer operation with exact `CellView` identity.

All mount, refresh, release, async completion, imperative update, and editor operation must carry:

```ts
interface PhysicalCellToken {
	readonly cellInstanceId: string;
	readonly cellGeneration: number;
	readonly rowBindingGeneration: number;
}
```

A release or deferred update is valid only when:

- `cellInstanceId` matches;
- `cellGeneration` matches;
- row-bound work has the current `rowBindingGeneration`;
- the portal host or DOM owner matches the current `CellView`.

Remove ownership decisions based only on:

- row slot ID;
- row generation;
- column ID;
- renderer key;
- current lane index;
- container lookup.

## Workstream 2 — Introduce `CellView` behind the existing renderer

Create `CellView` while retaining the current lane containers temporarily.

Move into `CellView`:

- cell element creation;
- content layers;
- renderer mount/refresh/destroy;
- classes and attributes owned by the cell;
- physical ownership identity;
- current renderer descriptor;
- row-binding generation.

Existing lane arrays may temporarily store `CellView`, but must stop creating independent lane-specific lifecycle objects.

## Workstream 3 — Replace lane-owned lifecycle

Add:

```ts
cellsByColumnId: Map<string, CellView<TRowData>>;
```

For each row slot topology reconciliation:

1. Look up retained cells by stable `columnId`.
2. Reuse retained cells even when lane or lane index changes.
3. Create a `CellView` only for a column entering the rendered set.
4. Destroy a `CellView` only when the column exits the rendered set or its physical row slot is destroyed.
5. Rebuild lane placement arrays from the retained map.

Remove `leftCells`, `centerCells`, and `rightCells` as lifecycle owners.

## Workstream 4 — Make pinning a relocation operation

For a retained column moving lanes:

```ts
cellView.relocate(nextPlacement);
```

Relocation must:

- append the same `cellView.element` to the new lane container;
- preserve child DOM nodes;
- preserve the React portal host;
- preserve renderer instance and local component state;
- update lane-relative position, width, and classes;
- avoid renderer mount/destroy;
- avoid incrementing `cellGeneration`.

A lane move must never be represented as `exited + entered`.

## Workstream 5 — Stabilize React portal ownership

Each React-capable `CellView` owns one persistent portal host.

Use stable portal identity based on `cellInstanceId`.

Do not use a portal key that can identify two physical containers over time.

The structural portal set may change only when:

- a custom-renderer column enters the rendered topology;
- a custom-renderer column exits the rendered topology;
- renderer type changes;
- a physical row slot is created/destroyed;
- the grid is destroyed.

These must not structurally recreate portals:

- pin/unpin;
- retained column reorder;
- width changes;
- focus/selection changes;
- ordinary vertical scrolling;
- value refresh;
- decoration refresh.

During vertical row-slot reuse:

```text
same CellView
→ next row binding generation
→ renderer.refresh(nextContext)
```

The portal host remains stable.

## Workstream 6 — Make content transitions non-blanking

Use persistent layers and explicit mode:

```ts
type CellContentMode = 'text' | 'dom' | 'portal' | 'loading' | 'empty';
```

Required transition ordering:

### Text to portal

```text
mount or refresh portal renderer
→ verify current physical identity
→ switch visible mode to portal
→ clear obsolete text later if desired
```

### Portal to text

```text
write formatted text
→ switch visible mode to text
→ destroy portal renderer
```

### Renderer refresh

```text
keep current visible content
→ update renderer
→ replace only after successful recreation
```

Forbidden lifecycle sequence:

```text
clear current content
→ queue replacement for later
```

Primitive rendering may continue using:

```ts
textLayer.textContent = formattedValue;
```

Do not use `innerHTML = ''` or `textContent = ''` as preparation for an asynchronous replacement.

## Workstream 7 — Remove React-specific scroll repair paths

Audit and remove mechanisms that exist only because React cells are structurally remounted during scroll:

- scroll-time portal release queues;
- blank custom-renderer placeholders;
- text clearing while portal mounting is pending;
- post-scroll React dirty-cell repair;
- vertical-scroll portal structural reconciliation;
- lane-change portal remount logic;
- full portal release during pinning.

After migration, scroll work must be classified uniformly as:

```text
placement update
data refresh
structural acquire/release
decoration update
```

Renderer type changes implementation details, not lifecycle semantics.

## Workstream 8 — Renderer refresh classification

Define `CellRenderContext` with explicit fields and versions:

```ts
interface CellRenderContext<TRowData> {
	readonly rowId: string;
	readonly visualRowId: string;
	readonly rowNode: RowNode<TRowData>;
	readonly columnId: string;
	readonly value: unknown;
	readonly formattedValue: string;
	readonly selected: boolean;
	readonly focused: boolean;
	readonly editing: boolean;
	readonly loading: boolean;
	readonly rowBindingGeneration: number;
}
```

Classify changes into:

- content/value refresh;
- renderer recreation;
- placement only;
- decoration only;
- no operation.

Do not use broad object identity as the only refresh signal.

## Workstream 9 — Tactical safety during migration

Until the old lane ownership is deleted:

- add exact `cellInstanceId` and generation matching;
- process valid old ownership release before creating replacement ownership;
- synchronously complete pin/unpin topology reconciliation;
- retain visible content until replacement is ready;
- reject stale deferred operations.

This tactical layer must be deleted or absorbed after the stable model is complete. Two ownership systems may not remain.

## Mandatory demolition

Delete before completion:

- lane arrays as lifecycle owners;
- duplicate physical cells for one row-slot/column pair;
- portal keys that do not identify the exact physical cell instance;
- ownership checks based only on row slot and row generation;
- pin/unpin release-and-remount behavior;
- portal retargeting during lane movement;
- content clearing before replacement is committed;
- React-specific vertical-scroll structural remounts;
- post-scroll blank-cell repair paths;
- broad portal release on pin/unpin;
- full redraw fallbacks used to hide renderer ownership bugs;
- tactical dual-ownership compatibility code.

## Behavioral verification

Add tests proving:

1. Pinning a React-rendered column preserves the component instance.
2. Unpinning preserves the component instance.
3. Center → left → right → center causes no blank frame.
4. React component local state survives every lane movement.
5. Old-lane release cannot unmount a relocated renderer.
6. Pinning one column never blanks unrelated cells.
7. Primitive, DOM, portal, editor, and loading cells share correct lifecycle behavior.
8. Vertical row-slot reuse refreshes React content without structural portal churn.
9. Rapid vertical scroll shows no stale or blank custom cells.
10. Width and retained-order changes do not remount renderers.
11. Focus and selection changes do not recreate content.
12. Renderer-type changes recreate exactly once.
13. Async work cannot update a stale physical identity.
14. Every renderer is destroyed exactly once.
15. No duplicate `CellView` exists for a row slot and column.
16. Portal count remains stable during pin/unpin.
17. DOM node count remains stable for retained topology.
18. Primitive text updates remain allocation-light.
19. Content blank-transition metric remains zero.
20. Repeated pin/unpin under active scrolling does not leak renderers or portals.

Include Playwright frame-by-frame or video-backed regression coverage for pin/unpin so a transient blank frame cannot pass merely because final DOM state is correct.

## Performance gates

### Pin/unpin retained columns

Expected:

```text
React renderer mounts: 0
React renderer destroys: 0
new cell DOM nodes: 0
portal target changes: 0
```

### Vertical steady scroll

Expected:

- stable structural portal set;
- no cell DOM creation after warm-up;
- renderer refresh only for rebound cells;
- no blank intermediary state;
- p95 frame time within the established budget.

### Horizontal virtualization

Structural acquire/release is allowed only for genuinely entered/exited columns.

Do not increase overscan, force full redraw, or weaken budgets to hide lifecycle churn.

## Instrumentation

Add or consolidate metrics:

```ts
GridMetric.CELL_VIEW_CREATED;
GridMetric.CELL_VIEW_DESTROYED;
GridMetric.CELL_VIEW_RELOCATED;
GridMetric.CELL_RENDERER_MOUNTED;
GridMetric.CELL_RENDERER_REFRESHED;
GridMetric.CELL_RENDERER_RECREATED;
GridMetric.PORTAL_HOST_RELOCATED;
GridMetric.STALE_CELL_OPERATION_REJECTED;
GridMetric.CONTENT_BLANK_TRANSITION;
```

`CONTENT_BLANK_TRANSITION` must remain zero in supported scenarios.

Remove migration-only metrics after old ownership is deleted.

## Evidence required

The implementation report must include:

1. Before/after body-cell ownership diagrams.
2. Deleted lane lifecycle paths.
3. Portal mount/destroy counts for pin/unpin and scroll.
4. React local-state preservation test.
5. DOM/portal count comparison.
6. Pin/unpin visual regression output.
7. Vertical and horizontal scroll benchmark comparison.
8. Confirmation that no full redraw fallback is required.

## Stop conditions

Stop and redesign if:

- pinning still requires renderer recreation for retained columns;
- two physical cells can exist for the same row slot and column;
- a React portal must change host during relocation;
- correctness depends on clearing content and flushing later;
- the old and new ownership systems must remain permanently active;
- performance is recovered only by freezing React cells or hiding them during scroll.

## Completion gate

Plan 118 is complete only when:

> For every physical row slot and rendered column, one stable `CellView` owns the cell element, content layers, portal host, renderer instance, physical identity, row binding, and lifecycle. Pinning changes placement only; scrolling changes row binding only; data changes refresh content only; and structural mount/destroy occurs only when a cell genuinely enters or leaves the rendered topology.
