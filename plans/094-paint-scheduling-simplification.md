# Plan 094: Paint Scheduling Simplification

> **Why this is separate from frame arbitration**: Plan 090 establishes one authoritative RAF. This plan removes the remaining microtask-before-RAF state unless measurement proves it is necessary. Scheduling complexity must earn its place with data.

## Status

- **Priority**: P1 — complexity and latency reduction
- **Effort**: S
- **Risk**: LOW — scheduler simplification after arbitration
- **Depends on**: Plan 090
- **Category**: rendering, scheduling, performance
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

Paint requests currently pass through a microtask before registering RAF. The pending bit already coalesces synchronous requests, so the microtask creates an extra uncancellable state without a demonstrated benefit.

## What to add

### 1. Direct RAF baseline

After Plan 090, all request types set pending bits and register the single RAF immediately.

### 2. Benchmark harness

Compare direct RAF and microtask→RAF for:

- 1, 10, and 100 synchronous invalidations;
- invalidations triggered during event handlers;
- invalidations triggered during promise continuations;
- input-to-paint latency;
- number of browser callbacks;
- dropped or duplicate frames.

### 3. Evidence-based decision

Keep the microtask only if it produces a repeatable material benefit and document the measured scenario in code.

## Phases

### Phase 1 — Remove microtask

- Register the arbiter RAF directly
- Preserve coalescing tests
- Preserve destroy cancellation

### Phase 2 — Benchmark

- Add deterministic functional tests
- Add optional browser benchmark fixture

### Phase 3 — Document final contract

- Explain why direct RAF is sufficient, or record benchmark evidence for reintroducing a microtask

## STOP conditions

- Do not retain the microtask because existing tests happen to encode it.
- Do not use `queueMicrotask` as a substitute for transaction batching.
- Do not add a second coalescing queue.
- Do not claim lower latency without browser measurements.

## Verification gate

Build/tests pass with direct RAF and request coalescing remains one callback per browser frame.
