# Plan 144: Add Performance Guardrails for Hot Scroll, Slot Reuse, and High-Throughput Writes

## Mission

Establish measurable budgets that protect the grid’s hottest paths: fast scroll, slot reuse, targeted invalidation, and large batched writes.

## Why now

A grid can be architecturally correct and still feel slow. Before advanced features, the repo needs regression visibility into the paths that determine whether the product feels AG Grid-class or demo-class.

## Priority budgets

- fast vertical scroll
- horizontal scroll with pinned lanes
- large rectangular paste
- fill drag over many rows
- high-frequency batched cell updates
- grouped/aggregated viewport churn
- integrity decorations during and after scroll

## Metrics to protect

- full paints per scenario
- viewport recycles per scenario
- rows rebound per scroll frame
- cells patched per scroll frame
- portal flushes during scroll
- custom renderer warm/cold behavior
- invalidation reasons emitted by canonical writes
- geometry recomputes for non-geometry writes

## Architecture emphasis

- keep the hot scroll path allocation-light
- preserve slot reuse instead of recreating physical work
- ensure targeted invalidation remains the default
- defer expensive fidelity until scroll settles when possible

## Done criteria

- new or expanded perf-oriented tests cover the hottest scenarios
- budgets fail on obvious regressions instead of silently drifting
- the evidence makes it easy to tell whether a slowdown came from scroll, invalidation expansion, or write-path cost
