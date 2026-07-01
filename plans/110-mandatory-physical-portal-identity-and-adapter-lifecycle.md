# Plan 110: Mandatory Physical Portal Identity and Adapter Lifecycle

## Mission

Make stale portal ownership structurally impossible for pooled cells and prove adapter cleanup across rebinding, errors, and remounts.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MEDIUM
- **Depends on**: Plans 100, 103–105
- **Category**: renderer adapters, React, identity, lifecycle

## Problem

Slot generations exist, but identity remains optional or represented through several parallel keys. Different layers can compare generation differently, and generation without physical slot identity is not globally meaningful.

## Target types

```ts
type PortalMountIdentity =
	| {
			kind: 'pooled-cell';
			slotId: number;
			generation: number;
			lane: 'left' | 'center' | 'right';
			laneIndex: number;
	  }
	| {
			kind: 'standalone';
			key: string;
	  };
```

Logical identity (`rowId`, `columnId`, visual row ID) remains payload identity and is never substituted for physical ownership identity.

## Non-negotiable invariants

- Pooled portal mounts cannot be created without complete physical identity.
- Deferred/async updates require exact current identity match.
- Core and React adapter use the same stale-ownership rule.
- Slot-pool recreation cannot accidentally reuse a valid old identity.
- Mount failure, renderer error, host unmount, and strict remount release all subscriptions and containers.

## Mandatory demolition

- Optional generation fields on pooled mounts.
- Generation-only checks without slot identity.
- Layer-specific stale comparison semantics.
- Container maps serving as the sole ownership proof.
- Fallback edit commit protocols in the adapter.

## Completion gate

- Type system rejects incomplete pooled identity.
- Stale update tests cover lower, higher, reused, missing, and mismatched identities.
- Portal/resource accounting returns to zero after adversarial lifecycle tests.
- Adapter remains a renderer bridge, not a second row/state engine.
