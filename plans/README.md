# Plans

| #   | Plan                                                        | Status | Commit  |
| --- | ----------------------------------------------------------- | ------ | ------- |
| 001 | [Row Multi-Select](./001-row-multiselect.md)                | TODO   | 3d32692 |
| 002 | [ColumnType Registry](./002-column-type-registry.md)        | DONE   | 970c777 |
| 003 | [Row Pipeline Tests](./003-row-pipeline-tests.md)           | DONE   | 970c777 |
| 004 | [Declarative Style Rules](./004-declarative-style-rules.md) | DONE   | 970c777 |

## Execution order

1. `001-row-multiselect.md` — no dependencies
2. `003-row-pipeline-tests.md` — no dependencies (tests only, safe to run any time)
3. `002-column-type-registry.md` — no dependencies
4. `004-declarative-style-rules.md` — no dependencies; demo update requires 002 landed first if demo uses `columnTypes`

## Dependency graph

```
001  (row multi-select)
003  (pipeline tests)     — independent
002  (column type registry)
004  (style rules)        — demo update loosely depends on 002 being done first
```

## Notes

- Plans 001 is written against commit `3d32692`; plans 002–004 against `970c777` (branch `rendering-architecture-v2-wip-2`).
- After each plan: `pnpm -F @open-grid/core build && pnpm -F @open-grid/react build && pnpm -F @open-grid/core test && pnpm -F @open-grid/react test`
