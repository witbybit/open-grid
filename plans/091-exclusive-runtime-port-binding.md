# Plan 091: Exclusive Runtime Port Binding

> **Why this is P0**: The runtime reports concurrent host binding as illegal but still replaces the active host. That leaves the previous renderer mounted with stale observers and callbacks while the core points at a new host. Host ownership must be enforced, not merely diagnosed.

## Status

- **Priority**: P0 — host lifecycle correctness
- **Effort**: S
- **Risk**: LOW — narrow binding protocol change
- **Depends on**: Plan 086
- **Category**: runtime ports, lifecycle, correctness
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

`bindRuntimePorts()` reports a runtime fault when a binding is already active, then increments the generation and installs the new ports anyway. The implementation contradicts the single-host contract.

The deprecated `setRendererPorts()` path can also bypass binding generations entirely.

## What to add

### 1. Explicit bind result

```ts
export type RuntimePortBindResult = { ok: true; binding: RuntimePortBinding } | { ok: false; reason: 'already-bound' | 'destroyed' };
```

Concurrent binding must return `{ ok: false }` and leave the current ports untouched.

### 2. Strict unbind ownership

Only the active binding token may unbind. Stale tokens report a fault and no-op.

### 3. Remove unsafe setter

Delete `setRendererPorts()` or make it private during migration. No public or internal production caller may replace ports without a binding token.

### 4. Host mount failure handling

`gridHost` must dispose newly created DOM listeners/observers when binding fails.

## Phases

### Phase 1 — Reject replacement

- Add bind result
- Keep active ports unchanged on failure
- Update host composition

### Phase 2 — Remove escape hatch

- Delete deprecated setter
- Add architecture guard preventing reintroduction

### Phase 3 — Adversarial lifecycle tests

- Two hosts attempt to bind
- Stale host attempts to unbind
- Destroyed store rejects bind
- Failed second host cleans up resources

## STOP conditions

- Do not silently replace the current host.
- Do not return a fake generation for a failed bind.
- Do not allow host cleanup to depend only on successful binding.
- Do not keep `setRendererPorts()` as an indefinite compatibility path.

## Verification gate

Add tests proving the first host remains active after a rejected second bind and that no listeners, observers, or DOM ownership leak from the rejected host.
