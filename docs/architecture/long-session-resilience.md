# Long-session resilience contract

Plan 160 makes long uptime a deterministic ownership contract rather than a
wall-clock or heap-size benchmark. The focused suite uses only fixed queue
drains and integer gauges.

## Scenarios

| Scenario                  |                                       Seed / operations | Warm-up and cap                                                                                        | Evidence                                   |
| ------------------------- | ------------------------------------------------------: | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Instrumentation history   |                                          100,000 frames | retain 8; `droppedFrames = operations - capacity`                                                      | `RecordingGridInstrumentation` ring buffer |
| Scheduler arbitration     |          10,000 mixed scroll/paint/post-scroll requests | 2,500-operation epochs; coordinator RAF depth `<= 1`                                                   | `longSessionResilience.test.ts`            |
| Mounted client renderer   | 100,000 rows, 12 columns, 10,000 mixed scroll positions | 2,500-operation epochs; cell slots `<= maxRenderedCells (288)`                                         | mounted `RenderEngine` scenario            |
| Infinite + SSRM traversal |                2,000 non-adjacent ranges for each model | block size `1`, cache `3`, concurrency `1`; retained blocks `<= 4` (one protected/in-flight allowance) | controller ownership snapshots             |
| React portal ownership    |                500 recycled mount/update/unmount cycles | 12 physical containers; active portal and listener-key counts return to zero                           | `gridPortalStore.adversarial.test.ts`      |

The rendering working-set cap is derived from the rendered viewport plus its
configured retention allowance. Custom renderer warm state is bounded by
`runtimeLimits.maxWarmCustomRenderers`; pending warm moves, portal deferred
queues, scheduler ownership, row-model cache/request ownership, and React
listener ownership are exposed as live gauges. Counters such as mounts and
flushes remain cumulative and must never be used as leak signals.

The suite is run through `corepack pnpm run bench:long-session`. It is expected
to produce identical count maxima on repeated runs because it does not use
real timers, network I/O, random environment seeds, or heap APIs.
