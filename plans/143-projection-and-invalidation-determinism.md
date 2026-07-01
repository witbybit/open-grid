# Plan 143: Lock Projection and Invalidation to One Deterministic Commit-Owned Pipeline

## Mission

Make derived-state recomputation and invalidation planning fully commit-owned, with no hidden renderer-side or feature-local reinterpretation of business changes.

## Why now

The grid already moved toward commit-owned projection, but advanced features like pivoting will add more derived structures:

- synthetic columns
- aggregate cells
- pivot row groups
- expanded/collapsed windows
- sticky and paged subsets

If projection ownership or invalidation planning is still fuzzy, those features will multiply cost and drift.

## Core rules

- mutation enters one commit kernel
- projection runs once per committed logical change
- invalidation plan is declared once by commit/projection ownership
- renderer consumes the declared plan; it does not infer higher-level meaning

## Focus areas

- eliminate any remaining duplicated post-commit recompute logic
- make projection outputs explicit where later stages depend on them
- make invalidation planning explainable from commit artifacts alone
- add guardrails against feature-local repaint escalation

## Done criteria

- derived-state ownership is explicit for all high-risk row/data flows
- invalidation planning is traceable to commit/projection outputs
- architecture guards prevent reintroduction of listener-driven mutation or renderer-side semantic inference
