# Plan 107: Reproducible Workspace, Build, and Evidence Gate

## Mission

Make every review candidate and foundation milestone independently buildable, testable, benchmarkable, and auditable from a clean checkout.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none; execute in parallel after Plan 103 starts
- **Category**: tooling, CI, reproducibility, evidence

## Problem

Review archives have repeatedly omitted root manifests, workspace configuration, root TypeScript config, lockfiles, test configuration, and benchmark artifacts. That prevents independent verification of build and test claims.

## Target end state

A clean checkout supports documented commands for:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:architecture
pnpm test:adversarial
pnpm bench
pnpm pack:verify
```

A review bundle includes all source and configuration required to run them, excluding only generated dependencies and caches.

## Required contents

- root `package.json`;
- workspace file;
- lockfile;
- root and package TypeScript configs;
- test and benchmark configs;
- shared config packages;
- environment documentation;
- committed benchmark baseline format;
- package-consumer fixture;
- CI workflow or equivalent script.

## Verification program

- clean Linux checkout;
- clean Windows-compatible path handling where supported;
- Node version matrix selected for alpha;
- package build order from scratch;
- pack and consume tarballs in a fixture app;
- deterministic tests and seeded fuzzing;
- benchmark artifact generation with commit metadata.

## Completion gate

- A fresh clone can run every gate with no undocumented local files.
- The exact review archive can be built independently.
- CI and local commands use the same scripts.
- Benchmark and fuzz evidence is attached to convergence PRs.
