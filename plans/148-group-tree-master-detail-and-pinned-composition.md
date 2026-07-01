# Plan 148: Make Grouping, Tree Data, Master/Detail, and Pinned Lanes Compose Cleanly

## Mission

Harden the structural feature stack so grouping, tree hierarchies, detail rows, expansion state, pinned lanes, selection, and viewport movement can all operate together without layout glitches, stale ranges, or identity drift.

## Why now

These are the features that make grids feel “enterprise” instead of “table with extras.” They are also where rendering, geometry, projection, and selection seams get stressed hardest. If these combinations are not solid, every future advanced feature will inherit instability.

## Focus areas

- stable row identity across expand/collapse, regroup, and detail toggles
- pinned-left/center/right correctness with grouped and tree-derived rows
- range selection, focus, copy, and row actions across structural rows
- sticky and variable-height structural rows without broken geometry
- master/detail lifecycle ownership during virtualization and fast scroll
- composition with sort/filter/integrity and targeted invalidation

## Architecture emphasis

- structural rows must still respect one projection and invalidation story
- pinned lanes should remain topology-driven rather than bespoke DOM behavior
- geometry and expansion state should stay commit-owned, not renderer-owned
- grouped/tree/detail support should add structure without fragmenting the runtime

## Related backlog

- builds on Plans 119, 140, 142, and 144
- should reconcile with existing work on row drag, sticky groups, and layout animation rather than bypassing it
- creates the stable base needed before high-profile features like pivoting

## Done criteria

- grouped, tree, detail, and pinned scenarios have dedicated composition gauntlets
- expand/collapse and structural row movement preserve selection, focus, and visual coherence
- no structural feature introduces a separate invalidation or geometry side channel
- variable-height and structural-row virtualization cases stay green under scroll and targeted writes
