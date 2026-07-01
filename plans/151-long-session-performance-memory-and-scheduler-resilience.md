# Plan 151: Keep the Grid Fast After Millions of Interactions, Not Just the First Minute

## Mission

Add long-session performance, memory, and scheduler resilience guardrails so the grid stays snappy after sustained scrolling, editing, selection churn, async updates, and renderer hydration over time.

## Why now

Short benchmark wins are not enough. Mature grids are judged by how they feel after prolonged use inside large applications. If memory grows, hot paths widen, or scheduled work accumulates, even a well-architected grid will feel shaky in production.

## Focus areas

- long-run slot reuse and DOM/portal stability
- memory retention under repeated mount/unmount, viewport churn, and subscription churn
- scheduler fairness and bounded backlog under mixed scroll, paint, and post-scroll work
- visible-only vs offscreen work discipline during heavy update streams
- regression evidence that complements the point-in-time budgets from Plan 144

## Architecture emphasis

- optimize for steady-state runtime behavior, not only cold-path cleanliness
- preserve targeted invalidation and lane separation as feature count increases
- treat retained references and background queues as first-class performance bugs
- keep measurement deterministic and CI-friendly whenever possible

## Related backlog

- extends Plan 144 rather than replacing it
- should pair naturally with Plan 122 (`grid-devtools-runtime-inspector`)
- should include both core and React adapter evidence where ownership boundaries meet

## Done criteria

- long-session stress suites exist for scroll, edit, async update, and remount scenarios
- memory and lifecycle leaks become observable through regression tests or explicit diagnostics
- scheduler backlog growth and offscreen work drift are measurable and bounded
- the repo can detect “felt slowdown over time” regressions before users do
