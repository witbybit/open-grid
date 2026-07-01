# Plan 112: Alpha Foundation Cut and Codebase Demolition

> This is the moved and strengthened foundation milestone. It cannot begin as a cleanup exercise until Plans 103–111 have met their completion gates.

## Mission

Cut an internal `0.1.0-alpha` foundation where mutation, invalidation, rendering, row authority, adapter ownership, package boundaries, tests, and performance evidence all agree with the architecture target.

## Status

- **Priority**: P0 milestone after prerequisites
- **Effort**: XL
- **Risk**: HIGH — final deletion and surface freeze
- **Depends on**: Plans 089–111
- **Category**: foundation milestone, demolition, release preparation

## Foundation entry criteria

Do not start final demolition until:

- direct logical writes are reduced to the approved allowlist;
- commit failure semantics are proven;
- legacy inferred invalidation is zero in foundation flows;
- alpha API and feature classifications are approved;
- clean checkout gates are reproducible;
- adversarial suites pass;
- store compatibility hub migration is complete enough to enforce boundaries;
- pooled portal identity is mandatory;
- scheduler/instrumentation simplification is measured.

## Mandatory demolition audit

Delete:

- superseded direct mutation paths;
- legacy reaction invalidation;
- deprecated APIs and aliases;
- forwarding-only classes with no policy value;
- old renderer ownership mechanisms;
- dormant migration flags;
- dead feature code outside the alpha/reference matrix;
- duplicate tests and source-string semantic guards;
- compatibility imports and barrels with no remaining consumers;
- plan-history comments and temporary adapters.

## Foundation proof

A clean checkout must produce:

1. core and React builds;
2. unit/integration tests;
3. architecture gates;
4. seeded adversarial tests;
5. benchmark report against Plan 091 baseline;
6. package tarballs consumed by a fixture app;
7. the real application running only supported APIs;
8. memory/lifecycle report;
9. API/export snapshot;
10. before/after dependency and codebase metrics.

## Required milestone artifacts

- final architecture diagram;
- mutation and render sequence diagrams;
- alpha feature matrix;
- public API reference and package entry points;
- benchmark report;
- known limitations;
- deleted-path inventory;
- clean-checkout command transcript;
- real-app integration report;
- post-foundation product-hardening roadmap.

## Completion gate

- Architecture constitution matches runtime reality.
- Each responsibility has one authoritative owner.
- No known compatibility fallback is required for normal operation.
- The codebase is conceptually smaller than the WIP POC.
- The alpha packages are independently consumable.
- The next review is about release hardening, accessibility, browser compatibility, documentation, and product fit—not foundational ownership repair.

## STOP conditions

- Stop if any prerequisite plan is marked complete through source-string evidence alone.
- Stop if a known direct mutation or invalidation bypass remains in normal flows.
- Stop if the real app requires internal imports.
- Stop if benchmark regressions lack an explicit accepted tradeoff.
- Stop if cleanup adds compatibility wrappers instead of deleting pre-release mistakes.
