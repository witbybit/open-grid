# Plan 096: Frame Epoch and Post-Scroll Durability

> **Why these belong together**: Same-window scroll RAFs currently bypass frame entry, while post-scroll requests can be dropped when a frame is active. Both issues break the meaning of frame epochs and deferred-work ownership. Every real frame must advance lifecycle state, and every accepted deferred request must either run or be explicitly invalidated.

## Status

- **Priority**: P1 — lifecycle consistency
- **Effort**: M
- **Risk**: MEDIUM — scroll and deferred-decoration behavior
- **Depends on**: Plans 089, 093, and 095
- **Category**: scrolling, scheduling, correctness
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

Cheap same-window scroll work increments render statistics but does not enter `scroll-frame`, so `frameEpoch`, frame-active guards, and stale-work rules disagree with actual execution.

Separately, post-scroll work requested during an active frame may be discarded with the assumption that another subsystem will request it again.

## What to add

### 1. Frame entry for every scroll RAF

Enter `scroll-frame` before deciding whether the work is a same-window bailout or full viewport recycle.

```ts
runtimeState.transitionTo('scroll-frame');
try {
  if (sameWindow) syncCheapScrollOnly();
  else recycleViewport();
} finally {
  runtimeState.transitionTo('post-scroll');
}
```

### 2. Durable post-scroll pending state

`requestPostScrollWork()` records intent even when execution is temporarily disallowed.

The request may be:

- executed when scrolling becomes idle;
- invalidated by a newer scroll epoch;
- cancelled by destruction.

It may not disappear because the current frame is active.

### 3. Explicit invalidation reason

Represent skipped work:

```ts
type DeferredWorkOutcome = 'executed' | 'superseded' | 'destroyed';
```

Tests should distinguish deferral from invalidation.

## Phases

### Phase 1 — Same-window phase integration

- Enter frame state for cheap scroll RAFs
- Advance frame epoch
- Preserve bailout performance

### Phase 2 — Durable deferred queue

- Retain pending post-scroll work
- Wake it on scroll finish
- Reject stale epoch work explicitly

### Phase 3 — Integration coverage

- Cheap scroll observes active frame
- Deferred work survives active paint
- New scroll supersedes old decoration
- Destruction cancels queued work

## STOP conditions

- Do not redefine frame epoch to exclude cheap scroll work merely to preserve current behavior.
- Do not busy-loop RAFs while scrolling remains active.
- Do not require every caller to maintain a parallel “please retry” flag.
- Do not execute decoration from a stale scroll epoch.

## Verification gate

Use a deterministic scheduler to test phase, epoch, and queue outcomes across scroll/paint/post-scroll interleavings.
