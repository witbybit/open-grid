# Plan 145: Make the React Adapter Lifecycle-Safe, Predictable, and Boring in Production

## Mission

Harden the React adapter so application teams can mount, rerender, control, and tear down grids under real app churn without leaking runtime state, regressing portal ownership, or paying avoidable render costs.

## Why now

The core runtime is much stronger than it was, but broad adoption does not happen if the framework adapter still feels fragile. Teams will judge the grid through React before they judge the engine. If React lifecycle behavior is noisy, leaky, or surprising, the quality of the core will be invisible.

## Focus areas

- mount/unmount stability across repeated cycles
- controlled vs uncontrolled prop semantics
- prop diffing that does not wake hot paths unnecessarily
- portal lifecycle cleanup and remount resistance
- subscription cleanup and memory retention under long sessions
- event callback stability without stale closures or accidental resubscription churn

## Architecture emphasis

- keep React a thin ownership shell over the core runtime
- avoid duplicating state derivation in React that already belongs to core
- treat React rerenders as cheap metadata updates, not implicit grid resets
- preserve the public adapter contract while reducing implementation surprise

## Related backlog

- builds on Plan 061 (`react-hook-surface`)
- should use Plan 121 (`react-portal-identity-completion`) as the lifecycle baseline
- should add or expand adversarial coverage next to existing React boundary and portal-store tests

## Done criteria

- repeated mount/unmount/rerender cycles do not leak portals, subscriptions, or runtime references
- React-only prop churn does not trigger unnecessary grid recreation or scroll-path work
- controlled/uncontrolled semantics are explicit and tested
- the React package has lifecycle soak tests and adversarial tests for the highest-risk ownership paths
- the adapter remains thinner after the change, not fatter
