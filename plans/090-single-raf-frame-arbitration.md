# Plan 090: Single RAF Frame Arbitration

> **Why this must land next**: `FrameCoordinator` documents scroll > paint > post-scroll priority, but currently registers independent RAF callbacks. Browser callback registration order, not the coordinator, decides execution order. The scheduler must become an actual arbiter before more render work relies on its guarantees.

## Status

- **Priority**: P0 — frame ordering correctness
- **Effort**: M
- **Risk**: MEDIUM — central render scheduling path
- **Depends on**: Plans 079–080
- **Category**: rendering, scheduling, architecture
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

The coordinator owns separate RAF handles for scroll, paint, and post-scroll. If paint is requested before scroll, paint may run first even though the documented priority says scroll wins.

Three independent browser callbacks are coalesced channels, not centralized arbitration.

## What to add

### 1. One RAF registration

```ts
private rafId: number | null = null;
private pendingScroll = false;
private pendingPaint = false;
private pendingPostScroll = false;
```

All request methods set pending bits and call one `scheduleFrame()`.

### 2. Deterministic flush order

```ts
private flushFrame(): void {
  this.rafId = null;

  if (this.pendingScroll) this.flushScroll();
  if (this.pendingPaint) this.flushPaint();
  if (this.pendingPostScroll) this.flushPostScrollIfAllowed();

  if (this.hasPendingWork()) this.scheduleFrame();
}
```

Scroll must be consumed before paint. Post-scroll runs only when the runtime phase and scroll epoch permit it.

### 3. Reentrant request semantics

Requests made while a frame callback is executing must be retained for the current frame only when safe; otherwise they schedule the next RAF. Define this explicitly and test it.

### 4. Cancellation

`destroy()` cancels the single RAF handle and clears all pending bits.

## Phases

### Phase 1 — Pending-bit coordinator

- Replace per-channel RAF handles
- Preserve current public coordinator API
- Route all frame work through one arbiter

### Phase 2 — Reentrant behavior

- Define requests from scroll callback
- Define requests from paint callback
- Prevent recursive flushes

### Phase 3 — Remove false assumptions

- Remove tests tied to independent callback registration
- Add tests for every request order permutation

## STOP conditions

- Do not add priority by relying on call-site ordering.
- Do not retain hidden direct RAF scheduling in render coordinators.
- Do not run post-scroll merely because its bit is pending; phase and epoch validation remain mandatory.
- Do not introduce another scheduler wrapper around the arbiter.

## Verification gate

Test at minimum:

```text
paint request → scroll request => scroll executes first
post-scroll → paint → scroll => scroll, paint, then eligible post-scroll
requests during callback are not lost
one browser RAF is registered per pending frame
```
