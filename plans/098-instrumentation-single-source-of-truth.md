# Plan 098: Instrumentation Single Source of Truth

> **Why this remains unfinished**: `GridInstrumentation` landed, but `RenderStats` and direct mutable counters still operate in parallel. Two telemetry systems can disagree and both add hot-path work. Instrumentation must become canonical, optional, and honestly costed.

## Status

- **Priority**: P2 — observability and hot-path cleanup
- **Effort**: M
- **Risk**: LOW — diagnostic consolidation
- **Depends on**: Plan 085
- **Category**: diagnostics, performance, architecture
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

The runtime records metrics through both `GridInstrumentation` and mutable render statistics, including frame counters and per-frame arrays. This duplicates work and creates competing sources of truth.

The no-op implementation is described as zero overhead even though hot paths still perform interface method calls.

## What to add

### 1. Canonical metric ownership

All counters and samples flow through `GridInstrumentation`.

`getRenderStats()` returns a snapshot from a recording implementation rather than reading separate renderer-owned counters.

### 2. Recording modes

```ts
type InstrumentationMode = 'off' | 'counters' | 'detailed';
```

- `off`: no detailed calls in the hottest paths where practical;
- `counters`: scalar metrics only;
- `detailed`: bounded frame samples and traces.

### 3. Remove duplicate arrays and counters

Delete direct `renderStats.*++` and bounded sample arrays once equivalent instrumentation exists.

### 4. Honest performance documentation

Describe no-op cost as minimal unless call sites are statically bypassed.

## Phases

### Phase 1 — Metric inventory

Map every existing counter to one canonical metric.

### Phase 2 — Snapshot adapter

Preserve public diagnostics by deriving snapshots from instrumentation.

### Phase 3 — Remove duplicates

Delete direct counters and add an architecture guard.

## STOP conditions

- Do not silently drop existing externally documented metrics.
- Do not allocate detailed sample objects in `off` mode.
- Do not retain duplicate counters “for compatibility” indefinitely.
- Do not claim zero overhead without a statically bypassed path.

## Verification gate

Metric snapshots must match existing behavior in detailed mode, while off mode performs no sample-array growth and minimal hot-path work.
