# Plan 021: Split row cell lane orchestration from RowRenderer

> **Executor instructions**: Execute this plan completely. Keep renderer
> behavior stable while narrowing architecture. Run all verification commands.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/020-row-renderer-maintenance-boundary.md`
- **Category**: architecture, rendering
- **Planned at**: commit `bb60b76`, 2026-06-12

## Why this matters

After Plan 020, `RowRenderer` still mixes viewport slot ownership with
left/center/right lane orchestration. Before extracting the hotter per-cell bind
logic, the lane-level loops should live behind their own boundary.

## Scope

**In scope**:

- `packages/core/src/renderer/rowRenderer.ts`
- new row cell lane orchestration helper(s)
- renderer architecture guards

**Out of scope**:

- full per-cell binder extraction
- portal lifecycle redesign
- slot pool redesign

## Done criteria

- [x] Live row/data and loading lane binding routes through the extracted helper.
- [x] Renderer architecture guards cover the new lane-binding boundary.
- [x] Focused renderer tests and full verification pass.
