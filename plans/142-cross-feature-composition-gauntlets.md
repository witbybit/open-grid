# Plan 142: Add Cross-Feature Composition Gauntlets Before Advanced Grid Features

## Mission

Build adversarial regression suites that exercise multiple grid systems at the same time, so advanced features land on a composition-tested core rather than a collection of individually-correct subsystems.

## Why now

Pivoting, richer grouping, advanced menus, and higher-throughput data flows fail at the seams:

- sort + filter + selection
- pagination + editing + validation + clipboard
- live data + integrity + row models
- virtualization + custom renderers + fast scroll

Single-feature tests are necessary, but they are not enough for AG Grid-class complexity.

## Primary scenarios

- sort + filter + grouping + selection
- fill/paste + formulas + validation + undo/redo
- infinite/server models + selection + integrity + live updates
- sticky groups + range selection + copy
- fast scroll + targeted invalidation + custom renderer hydration
- row drag + pinned lanes + selection + viewport churn

## Required assertions

- stable row identity
- stable selection/focus
- deterministic event ordering
- no silent full repaint regressions
- no stale integrity/validation decorations
- no broken undo boundaries
- no renderer/adapter lifecycle leaks

## Done criteria

- a named gauntlet suite exists for at least the highest-risk feature stacks
- each gauntlet asserts both user-visible state and lifecycle evidence
- failures clearly identify which feature composition broke
