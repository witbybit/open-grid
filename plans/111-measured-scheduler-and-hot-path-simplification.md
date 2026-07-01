# Plan 111: Measured Scheduler and Hot-Path Simplification

## Mission

Remove scheduling and instrumentation complexity that does not produce measured value, while preserving the single-frame authority established by Plans 093 and 098.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM — changes timing behavior
- **Depends on**: Plans 091, 093, 098, and 107
- **Category**: performance, scheduling, instrumentation cleanup

## Scope

- paint microtask before RAF;
- direct RAF uses outside `FrameCoordinator`;
- debounce/focus timers that are incorrectly acting as render schedulers;
- duplicate `RenderStats` and `GridInstrumentation` metrics;
- per-frame arrays and always-on hot-path calls;
- unnecessary scheduler wrappers and forwarding coordinators.

## Rules

- Do not remove or retain a mechanism based on aesthetics.
- Capture baseline traces first.
- Every retained exception has a documented timing reason and test.
- Render-related RAF belongs to one authority.
- Interaction debounce and async transport timers are classified separately.

## Verification

Compare before/after for:

- input-to-paint latency;
- frame CPU and long tasks;
- scroll smoothness;
- render-request coalescing;
- allocations;
- state reads and instrumentation overhead;
- hidden-tab and throttled-frame behavior;
- test determinism.

## Completion gate

- Paint microtask is removed unless evidence proves it beneficial.
- Direct render RAF exceptions are zero or explicitly allowlisted.
- Instrumentation has one source of truth.
- Production no-op instrumentation is described honestly as minimal or measured overhead.
- Code and timing state count decrease without benchmark regression.
