# Plan 112: Foundation Proof Checklist

Date: 2026-06-18

## Goal

Track the milestone proof required by Plan 112 using repository-native commands and artifacts.

## Foundation Proof

### 1. Core and React builds

- Core build: passing
    - Verified with `corepack pnpm --filter @open-grid/core build`
- React build: passing
    - Verified with `corepack pnpm --filter @open-grid/react build`
    - Fix applied: `packages/react/tsconfig.json` now resolves `@open-grid/core` through built declaration entry points in `packages/core/dist/*.d.ts` rather than unresolved dist stems or workspace source imports.

### 2. Unit/integration tests

- Core focused milestone suites: passing
- Core full package test suite: currently failing
    - Failing items observed in this turn:
        - architecture guard sees generated `.js` / `.d.ts` artifacts inside `packages/core/src`
        - exact-count render stats expectations in `renderEngine.test.ts`
- React full package test suite: passing
    - Verified with `corepack pnpm --filter @open-grid/react test`

### 3. Architecture gates

- Core architecture gates: passing
    - `corepack pnpm --filter @open-grid/core exec vitest run src/boundary.test.ts src/engine/architectureGuards.test.ts`
- Core milestone architecture+adversarial rerun: blocked by generated source artifacts contaminating architecture guards
- React boundary gate: covered by passing `@open-grid/react` package test run in this turn

### 4. Seeded adversarial tests

- Core adversarial suite: passing
    - `corepack pnpm --filter @open-grid/core exec vitest run src/rowModel.adversarial.test.ts src/lifecycle.adversarial.test.ts src/serverRowModel.adversarial.test.ts src/gridHost.adversarial.test.ts`
- React package tests: passing
    - `corepack pnpm --filter @open-grid/react test`

### 5. Benchmark report against Plan 091 baseline

- Focused benchmark/instrumented budget evidence: passing
    - `corepack pnpm --filter @open-grid/core exec vitest run src/perf/instrumentedBudgets.test.ts`
- Broader Plan 111 evidence also captured in:
    - `docs/architecture/plan-111-scheduler-simplification-report.md`
- Missing artifact:
    - milestone-level benchmark delta report against `docs/architecture/baseline.json`

### 6. Package tarballs consumed by a fixture app

- Not yet verified in this checklist turn
- Intended command path:
    - `scripts/pack-verify.mjs`

### 7. Real application running only supported APIs

- Not yet verified in this checklist turn

### 8. Memory/lifecycle report

- Not yet assembled as a milestone artifact

### 9. API/export snapshot

- Not yet assembled as a milestone artifact

### 10. Before/after dependency and codebase metrics

- Not yet assembled as a milestone artifact

## Current Blocking Items

1. Generated `.js` and `.d.ts` artifacts exist inside `packages/core/src` and are tripping architecture guards.
2. Core full package test suite still has known exact-count failures in `renderEngine.test.ts`.
3. Tarball/fixture-app verification has not been run.
4. Milestone reporting artifacts are still incomplete.
5. Destructive cleanup of generated source artifacts is currently blocked by approval-limit restrictions in this session.

## Current Assessment

Plan 112 is active, but the foundation proof is not yet complete enough to begin final demolition.
