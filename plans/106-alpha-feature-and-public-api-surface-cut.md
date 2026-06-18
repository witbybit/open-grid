# Plan 106: Alpha Feature and Public API Surface Cut

## Mission

Define the smallest honest alpha surface, quarantine experimental capabilities, and remove accidental compatibility obligations before the first release.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM — intentionally removes exports and unstable APIs
- **Depends on**: Plans 103–105
- **Category**: product boundary, API design, feature triage

## Problem

The package currently exposes a broad feature set and internal concepts despite being unreleased. Full internal state, visual row structures, internal package exports, charts, formula tools, sidebars, advanced filters, renderers, and experimental features can become accidental public contracts.

## Target end state

Every feature and export is classified:

- **foundation** — required and supported for alpha;
- **reference** — retained to pressure-test architecture, documented as limited;
- **incubating** — available only through explicit experimental entry points;
- **internal** — used by adapters/packages only;
- **deferred** — removed from active package surface.

## Non-negotiable invariants

- Public API exposes intent and stable snapshots, not mutable internals.
- `GridStore`, renderer runtime, raw state manager, slot pools, and internal models are not public app APIs.
- Internal adapter capabilities cannot be casually imported by consumers.
- Package version communicates pre-release status.
- Experimental exports are unmistakable and carry no stability promise.

## Mandatory demolition

- Deprecated aliases and duplicate public operations.
- Full mutable internal state exports where stable fragments suffice.
- Public exports retained solely because demos use them.
- Broad `./internal` access without a deliberate adapter-only strategy.
- Foundation package exports for deferred features.
- Version `1.0.0` before a real stable release.

## Execution workstreams

1. Build an export graph for core and React packages.
2. Classify each feature from Plan 090 against actual implementation maturity.
3. Define the alpha reference matrix.
4. Design stable state fragments and persisted-state contracts.
5. Move experimental features behind explicit entry points or separate packages.
6. Replace adapter access to internal store resolution with a private host capability/factory strategy where practical.
7. Generate API snapshots and package-consumer compile tests.
8. Update the real app to use only supported alpha APIs.

## Completion gate

- Every export has an owner and maturity classification.
- The real app imports no internal entry point.
- Public API snapshot is reviewed and intentionally small.
- Packages use a pre-release version such as `0.1.0-alpha.x`.
- Removed APIs have no compatibility shims unless required inside the monorepo.
