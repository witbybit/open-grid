# Plan 022: Split row cell binding policy from RowRenderer

> **Executor instructions**: Execute this plan completely. Keep renderer
> behavior stable while narrowing architecture. Run all verification commands.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/021-row-cell-binding-lane-boundary.md`
- **Category**: architecture, rendering
- **Planned at**: commit `bb60b76`, 2026-06-12

## Why this matters

After Plan 021, the live row lane path is extracted, but the hottest per-cell
policy still conceptually belongs to `RowRenderer`. The next step is to move the
live cell-binding policy behind a dedicated binder so `RowRenderer` stops being
the implicit home for focus, portal, primitive-text, and checkbox binding rules.

## Done criteria

- [x] Live lane binding routes through the extracted row cell binder.
- [x] Renderer architecture guards cover the new binder boundary.
- [x] Focused renderer tests and full verification pass.
