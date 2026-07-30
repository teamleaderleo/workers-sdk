# A001: Miniflare teardown lifecycle hardening

Source revision: `161443215fba3ac77407ba30f6996aa9963a0276`

Branch: `fieldwork/teardown-lifecycle-hardening`

Upstream contact authorized: `false`

## Package regression

`packages/miniflare/test/teardown-lifecycle.spec.ts` starts a real Miniflare runtime and inspects the child-process kill spy's `this` context, so assertions only count `SIGKILL` calls made on the child whose executable basename starts with `workerd`.

Run:

```sh
pnpm --filter miniflare test -- teardown-lifecycle.spec.ts
```

The regression covers four distinct cases:

1. `ProxyClient.dispose()` rejects before `Runtime.dispose()`. The first disposal must still send `SIGKILL` to the `workerd` child; the vulnerable implementation skips that call.
2. `ProxyClient.dispose()` remains pending. The test waits until proxy disposal has started, records whether the `workerd` kill was already requested, then releases the injected promise so the deliberately failing pre-fix case can clean up and exit.
3. `DevRegistry.dispose()` rejects after runtime disposal. This is the negative control: the `workerd` kill request must already have happened.
4. initialization fails on a missing script and a later cleanup also rejects. The final error tree must retain both the primary initialization failure and the secondary cleanup failure.

The pending-operation case is deterministic and does not rely on a timer. It distinguishes “runtime termination was requested before another cleanup completed” from “runtime termination eventually happened after the blocking operation was released.”

The initialization-plus-cleanup case proves that child ownership and error preservation are separate requirements. A runtime-first patch can fix the first while phased aggregation is still needed for the second.

## Source result

The current sequence has two pre-runtime awaited components:

1. browser-process cleanup;
2. proxy-client cleanup, including termination of its synchronous-fetch worker thread.

A rejection from either component can skip `Runtime.dispose()`. Browser cleanup now has explicit time bounds from `cloudflare/workers-sdk#14727`, but synchronous construction/kill failures can still reject. Proxy worker termination has no local deadline in this path. A promise from either component that never settles delays runtime termination.

`Runtime.dispose()` itself sends `SIGKILL` synchronously before returning the child exit promise. This permits a small repair: invoke runtime disposal before awaiting browser or proxy cleanup, then await the saved runtime promise before closing dispatchers. `runtime-first-dispose.patch` records that candidate.

The Vitest pool catches a rejected `Miniflare.dispose()` and writes it only through `util.debuglog`, then continues to remote-session and shared asset-watcher cleanup. A pending Miniflare disposal blocks those later pool operations.

Vitest starts runner termination promises concurrently and waits for the collected promises during final pool shutdown. This explains how one pending pool worker can hold the final close while other workers have completed. It does not establish why parallelism triggers the underlying pending operation in `cloudflare/workers-sdk#14903`.

## Repair candidates

### Minimal runtime-first patch

`runtime-first-dispose.patch` requests runtime termination before other awaited cleanup. It preserves the existing dispatcher ordering and mostly preserves first-error behaviour. It directly fixes the skipped-workerd-kill invariant covered by the package tests.

This candidate deliberately leaves broader cleanup aggregation and deadlines for a second change. That keeps the first implementation reviewable and limits compatibility risk.

### Phased bounded cleanup

`bounded-cleanup.mjs` models the broader design:

- start must-run runtime termination;
- run independent cleanup components through named settling wrappers;
- convert unresolved operations into named deadline results;
- preserve ordering between runtime exit and dispatcher shutdown;
- aggregate secondary cleanup failures after cleanup phases finish.

A single `Promise.allSettled()` over the whole method is too coarse because runtime dispatchers explicitly depend on runtime disposal and instance-registry deletion belongs last.

### Adjacent Vite container cleanup candidate

`adjacent-lifecycle-review.md` records follow-up findings across the Vite plugin, Vitest startup/stop, inspector cleanup, Hyperdrive cleanup, and container shutdown.

The current Vite dev and preview container ownership has three related gaps:

- current-session tags are registered only after all asynchronous image preparation succeeds;
- preview programmatic close does not clean containers;
- each mode has one module-global force-exit callback, so the most recent same-mode plugin instance replaces earlier cleanup ownership.

Artifacts:

- `container-build-cleanup.mjs` — executed early-registration and retry-ownership model;
- `container-build-cleanup.patch` — first bounded dev/preview candidate;
- `preview-container-close.patch` — original narrow preview-close candidate;
- `vite-exit-cleanup-registry.mjs` — executed single-slot negative control and per-instance registry model;
- `vite-exit-cleanup-registry.patch` — current candidate, superseding the earlier patches for implementation review.

The current candidate registers each plugin instance before preparation, preserves the original preparation or close error, warns and retains ownership when cleanup fails, cleans preview containers on programmatic close, and unregisters only after successful final cleanup.

These are adjacent artifacts, not production source changes. They require mocked plugin tests before promotion.

### Adjacent Vite shared-context ownership candidate

`vite-shared-context-ownership.md` records a broader process-wide ownership problem:

- every `cloudflare()` call receives a fresh `PluginContext` backed by the same module-global `SharedContext`;
- a second plugin instance can update the Miniflare runtime observed by the first instance;
- one server's restart counter can make another server misclassify final close as restart cleanup;
- the tunnel manager, tunnel hostnames, export-type map, and warning latch have the same global ownership boundary.

Artifacts:

- `vite-shared-context-ownership.mjs` — executed global-versus-owner-scoped model;
- `vite-instance-restart-scope.patch` — narrow candidate moving restart accounting into one `PluginContext`;
- `vite-shared-context-ownership.md` — source trace, design boundary, and integration matrix.

The restart-counter patch can be reviewed separately. Miniflare and tunnel ownership require a logical-server registry with an explicit handoff between sequential restart generations; simply creating one shared object per factory call would break restart continuity and can leak the old generation.

A Vite shared-state change that cleared the Miniflare reference before awaiting disposal was prototyped and reverted. With the current vulnerable disposal contract, clearing the reference can remove the only handle available for a second cleanup attempt after an early rejection. That change becomes safe after Miniflare cleanup is must-run and bounded.

## Historical research

- `cloudflare/workers-sdk#392` moved cleanup into a `finally` so initialization failure would still reach runtime and loopback cleanup. The current gap is finer-grained: one awaited statement inside that `finally` can still skip later statements.
- `cloudflare/workers-sdk#12025` made `Runtime.dispose()` destroy all child stdio streams before `SIGKILL`, addressing restart-time file descriptor reuse. Its PR explicitly described the original fix as speculative because the exact failure was difficult to reproduce. The A001 injection test directly observes the lifecycle invariant.
- `cloudflare/workers-sdk#13078`, fixing issue `#10511`, made temporary-directory deletion best-effort after a real Windows cleanup error propagated into Vitest output. This is precedent for classifying cleanup components by ownership criticality instead of letting every cleanup error abort disposal.
- `cloudflare/workers-sdk#14727` bounded Browser Rendering shutdown after Chrome could hold Miniflare disposal indefinitely. This removes one common indefinite browser wait while leaving runtime termination ordered after browser cleanup.
- `cloudflare/workers-sdk#11122` confirmed that direct Durable Object proxy calls can block tests and defeat ordinary Promise/timeouts. That report concerns synchronous proxy execution before teardown, so it is an adjacent cause of hangs rather than proof of skipped runtime disposal.
- `cloudflare/workers-sdk#14903` remains the strongest user-visible match: passing parallel files, a live workerd child, and final process hang. Its absence of a debug disposal rejection makes a pending operation at least as plausible as a rejection.

## Adjacent lifecycle seams

- `CloudflarePoolWorker.start()` increments the shared assets-watcher worker count before awaited startup. Vitest does call `stop()` after an ordinary rejected start, which balances the count. A startup promise that never settles remains different: Vitest's startup timeout rejects its task resolver while the scheduler still awaits `runner.start()`, delaying the later stop path.
- Multiple pool workers using the same Wrangler config may resolve the same remote proxy session and call its disposal independently. This can affect pool shutdown, but it occurs after Miniflare disposal and cannot explain a workerd child that missed `Runtime.dispose()`.
- A rejected Miniflare disposal still reaches `poolWorkerStopped()`. A pending Miniflare disposal does not, so shared assets watchers can remain registered alongside the live runtime.
- Vite and Wrangler callers ignore the boolean result from `cleanupContainers()`. Docker cleanup errors are contained, so they cannot skip Miniflare disposal, but failed container removal is silent.
- Vite preview closes Miniflare and its server concurrently, while container cleanup currently waits for process exit. Programmatic close during prerendering can leave containers until the host process exits.
- Multiple same-mode Vite plugin instances share one force-exit callback slot. The most recent registration replaces earlier server ownership.
- Multiple `cloudflare()` instances also share Miniflare, restart accounting, tunnel ownership, export types, warnings, and tunnel-hostname state process-wide.

## Validation boundary

The package tests, patch candidates, self-review notes, historical trace, and dependency-free Vite ownership models are committed. The package and plugin tests still require execution in a complete Workers SDK checkout with dependencies. No live multi-server, tunnel, or Docker reproduction ran. No upstream interaction occurred.
