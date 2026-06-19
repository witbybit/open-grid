# Plan 117: Private Runtime Composition Root

## Mission

Finalize the permanent internal runtime composition object so its name, dependencies, and adapter boundary match its true responsibility.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM — internal rename/decomposition with broad touch points
- **Depends on**: Plans 113–116
- **Category**: runtime composition, dependency narrowing, adapter boundary

## Problem

The codebase now treats `GridStore` as a private runtime composition root in practice, but the name and dependency shape still carry legacy "store facade" baggage.

## Target end state

Use this target:

> `GridStore` becomes a private runtime composition root and should be renamed to `GridKernel` or `GridRuntime` if that yields a clearer boundary.

## Non-negotiable invariants

- no public export
- no reverse lookup from public API
- no raw mutation API
- no application or demo usage
- adapters receive narrow host capabilities only
- feature controllers receive only required dependencies
- the runtime root is not a general service locator

## Mandatory demolition

- concrete runtime recovery from public API
- feature/controller dependence on the full runtime root when narrow deps suffice
- stale naming or comments that imply public/store semantics where the object is private runtime composition

## Execution workstreams

### 1. Decide on naming

Pick one:

- keep `GridStore` privately if it remains the least disruptive honest name
- or rename to `GridKernel` / `GridRuntime` if that better reflects responsibility

### 2. Narrow dependency injection

Reduce full-root dependencies in:

- feature controllers
- host/adapter wiring
- plugin/runtime composition

### 3. Remove remaining reverse-lookup assumptions

Audit internal bridges, tests, and helpers for lingering assumptions that the public API can recover the full runtime root.

### 4. Make the composition role explicit

Ensure the runtime root is clearly:

- engine composition
- plugin/runtime binding
- host/runtime binding
- diagnostics/instrumentation composition

and not an accidental mutation or service-locator abstraction.

## Verification

- no production code outside composition roots depends on the concrete runtime root unnecessarily
- adapters compile and run against narrow host capabilities only
- demo/application code imports no runtime internals
- architecture guards enforce the private runtime-root boundary

## Completion gate

- the runtime composition object has an honest role and boundary
- the adapter/runtime relationship is narrow and explicit
- no public or application code depends on the concrete runtime root
