# A001: Miniflare teardown lifecycle hardening

Source revision: `161443215fba3ac77407ba30f6996aa9963a0276`

Branch: `fieldwork/teardown-lifecycle-hardening`

Upstream contact authorized: `false`

## Package regression

`packages/miniflare/test/teardown-lifecycle.spec.ts` starts a real Miniflare runtime and observes the actual child-process kill call.

Run:

```sh
pnpm --filter miniflare test -- teardown-lifecycle.spec.ts
```

The regression now covers three distinct cases:

1. `ProxyClient.dispose()` rejects before `Runtime.dispose()`. The first disposal must still send `SIGKILL`; the vulnerable implementation skips that call.
2. `ProxyClient.dispose()` remains pending. The test waits until proxy disposal has started, records whether `SIGKILL` was already requested, then releases the injected promise so the deliberately failing pre-fix case can clean up and exit.
3. `DevRegistry.dispose()` rejects after runtime disposal. This is the negative control: the kill request must already have happened.

The pending-operation case is deterministic and does not rely on a timer. It distinguishes “runtime termination was requested before another cleanup completed” from “runtime termination eventually happened after the blocking operation was released.”

## Source result

The current sequence has two pre-runtime awaited components:

1. browser-process cleanup;
2. proxy-client cleanup, including termination of its synchronous-fetch worker thread.

A rejection from either component can skip `Runtime.dispose()`. Browser cleanup now has explicit time bounds from `cloudflare/workers-sdk#14727`, but synchronous construction/kill failures can still reject. Proxy worker termination has no local deadline in this path. A promise from either component that never settles delays runtime termination.

`Runtime.dispose()` itself sends `SIGKILL` synchronously before returning the child exit promise. This permits a small, low-risk repair: invoke runtime disposal before awaiting browser or proxy cleanup, then await the saved runtime promise before closing dispatchers. `runtime-first-dispose.patch` records that candidate.

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

## Validation boundary

The package test, patch candidate, and historical trace are committed. The package test still requires execution in a complete Workers SDK checkout with dependencies. No upstream interaction occurred.
