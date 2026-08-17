# Core simplicity contract

Captured against the live worktree on 2026-07-28. This is an evidence contract, not a claim that source is frozen: the transaction files are being changed in the Plan 165 worktree and line anchors below must be rechecked immediately before merge.

`public intent -> canonical commit -> authoritative mutation -> derived projection -> precise invalidation -> viewport -> renderer -> adapter/DOM`

An added abstraction is acceptable only when it has two real production implementations, is a package/framework/security/lifecycle fault boundary, isolates disabled-feature cost, or substitutes a nondeterministic dependency deterministically. “Might be useful later” and file-size relief are not reasons.

| Fact                                    | One owner, or DISPUTED                                                     | Consumers / mutation boundary                                            | Forbidden duplicate representation                      |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Raw client rows and row identity        | `RowDataStore` (`rows/RowDataStore.ts`)                                    | `ClientRowModelController`; only `ClientStructuralRowModel` writes it    | renderer row-data copy or independent transaction store |
| Client visual projection                | `ClientRowModelController` (`rowModel.ts`)                                 | viewport/renderer; `reconcileAfterDataWrite` after a committed write     | commit-kernel visual-row cache                          |
| Infinite visual projection              | `InfiniteRowModelController` (`infiniteRowModel.ts:487`)                   | viewport/renderer; block load/`ensureRange`                              | client projection masquerading as block cache           |
| Server visual projection                | `ServerSideRowModelController` (`serverSideRowModel.ts:388`)               | viewport/renderer; server block response boundary                        | client-side source-of-truth rows                        |
| Grid configuration                      | `StateManager` (`state/StateManager.ts:5`)                                 | features/model runtimes; only `GridChangeApplier` commits merged state   | feature-local durable config snapshot                   |
| Query route (sort/filter/group)         | `GridStateFeatureController` (`features/GridStateFeatureController.ts:17`) | invoked by `GridEngine`; emits typed changes into `GridChangeApplier`    | renderer query policy                                   |
| Commit order, history, events, rollback | `GridChangeApplier` + `GridDomainMutation` (**DISPUTED deliberately**)     | exactly one commit pipeline; mutation executor performs domain semantics | row-model-owned event/history lifecycle                 |
| Formula/dependent effects               | `DataMutationController` (`features/DataMutationController.ts:38`)         | `GridEngine` injects `applyStructuralWriteEffects`                       | row-model formula invalidation map                      |
| Domain versions/subscriptions           | `GridEngine` (`engine/GridEngine.ts`)                                      | store/adapters; committed domain change only                             | renderer freshness as domain version                    |
| Render invalidation                     | `InvalidationManager` (`renderer/invalidationManager.ts:233`)              | `DefaultFrameCoordinator`, renderer                                      | feature-local invalidation queue                        |
| Frame scheduling                        | `DefaultFrameCoordinator` (`renderer/frameCoordinator.ts:75`)              | render coordinators; owns RAF/idle cancellation                          | renderer-local RAF handle                               |
| Geometry                                | `GeometryController` (`renderer/geometryController.ts:3`)                  | render viewport path; layout transition boundary                         | row-model geometry cache                                |
| Viewport                                | `ViewportController` (`viewportController.ts:8`)                           | render viewport path; scroll/bounds boundary                             | renderer-owned canonical viewport state                 |
| Mounted row/cell/portal identity        | `PortalMountManager` (`renderer/portalMountManager.ts:87`)                 | row renderer/DOM/React portal adapter                                    | store portal map                                        |
| Capabilities                            | `GridCapabilityManager` (`capabilities/GridCapabilityManager.ts:51`)       | APIs and feature controllers                                             | optional row-model duck typing                          |
| Runtime faults                          | `RuntimeFaultReporter` (`diagnostics/RuntimeFaultReporter.ts:56`)          | diagnostics/DevTools                                                     | mutation executor fault list                            |
| Causal recording                        | `GridFlightRecorder` (`diagnostics/GridFlightRecorder.ts`)                 | optional DevTools observer                                               | mutation-owned trace buffer                             |
| Replay pacing/state                     | `GridTraceReplay` (`diagnostics/GridTraceReplay.ts`)                       | experimental replay controls; injected replay scheduler                  | renderer scheduler coupling                             |
| Persistence                             | `PersistenceController` (`persistence/statePersistence.ts:259`)            | host lifecycle only                                                      | renderer persistence state                              |
| Workspace                               | `GridWorkspaceController` (`workspace/GridWorkspaceController.ts:8`)       | host/workspace APIs only                                                 | persistence adapter's in-memory workspace state         |
| React lifecycle                         | `GridView` mount effect (`packages/react/src/GridView.tsx:214-227`)        | host DOM and subscriptions                                               | core mutation lifecycle                                 |

## First selected slice: remove the duplicate transaction shell

Evidence: `TransactionalRowModel` had one client implementation; the canonical structural transaction path already owns snapshot, structural write, `DataMutationController` effects, impact classification, reconciliation, history and events. The compatibility branch independently repeated those decisions. This is role 6/7, not a renderer consolidation.

Plan 165 must remain sequential and deletion-first:

1. Move the client snapshot/restore members into the already-required `ClientStructuralRowModel` capability.
2. Route every row transaction through `asClientStructuralRowModel`, rejecting non-client structural models before mutation.
3. Keep effects, impact classification, reconciliation, history/event publication in `GridDomainMutation` only.
4. Delete `TransactionalRowModel`, `asTransactionalRowModel`, `getTransactionalRowModel`, `ClientRowModelController.applyTransaction`, `collectCommittedCellChanges`, and the fallback executor branch.
5. Prove unchanged `GridApi.applyTransaction` output, rollback, formula invalidation, targeted notifications, history/events, server/infinite rejection, recorder causality, package declarations and budgets.

The rollback boundary is one commit: restoring the deleted protocol and fallback reconstitutes the old implementation without touching public API. No semantic guard was added: the rule is best protected by characterization tests plus type-level deletion; a source-text guard would be brittle.
