# Plan 133 — Pillar 3: Legacy DataQuality Removal

> **Status**: Pending
> **Depends on**: Plan 131 (validation decoration moved to insight layer)

## Problem

`packages/core/src/features/dataQuality/` is a dead parallel quality system:
- `DataQualityManager.ts` — reads `state.validationErrors` and applies its own quality rules
- `builtInRules.ts` — duplicate built-in rules that now live in `QualityIntegrityModule`
- `DataQualityManager.test.ts` — tests for dead code

This folder is **not wired into the engine** — confirmed: no reference in `engine/GridEngine.ts`. It was superseded by `GridDataIntegrityManager` + `QualityIntegrityModule`. It is dead code.

Similarly `insights/dataQuality.ts` is a re-export shim pointing to this dead folder.

## Tasks

| Task | File | Notes |
|------|------|-------|
| Delete `features/dataQuality/DataQualityManager.ts` | Dead code | Not wired to engine |
| Delete `features/dataQuality/DataQualityManager.test.ts` | Dead test | |
| Delete `features/dataQuality/builtInRules.ts` | Superseded | Rules now in QualityIntegrityModule |
| Delete `insights/dataQuality.ts` | Re-export shim | No longer needed |
| Remove `GridDataQualityManager` export from `core/index.ts` | `src/index.ts` | |
| Keep `GridDataQualityRule` type in `core/index.ts` | `src/index.ts` | It's a public type used by quality rules |

## Verification

After deletion, run:
```
npx tsc --noEmit   # must pass
npx vitest run     # must pass
grep -r DataQualityManager packages/core/src  # must return 0 matches outside test fixtures
```

## Note on `state.validationErrors`

After Plan 131, `state.validationErrors` is still written by `ValidationManager.ts` (the old `api.validateCell()` path) but read by nothing for rendering. The full removal of `ValidationManager.ts` and `state.validationErrors` is gated on removing `api.validateCell/validateGrid/clearValidationErrors` from the public `GridApi` (Plan 137).
