# A001: Miniflare teardown lifecycle hardening

Source revision: `161443215fba3ac77407ba30f6996aa9963a0276`

Branch: `fieldwork/teardown-lifecycle-hardening`

## Package regression

`packages/miniflare/test/teardown-lifecycle.spec.ts` starts a real Miniflare runtime and observes the actual child-process kill call.

Run:

```sh
pnpm --filter miniflare test -- teardown-lifecycle.spec.ts
```

The first test injects a rejection from `ProxyClient.dispose()`, which runs before `Runtime.dispose()`. It records whether the first `Miniflare.dispose()` sends `SIGKILL` to workerd. On the pinned implementation, the injected rejection exits the sequential `finally` block before runtime disposal, so the assertion that the first disposal killed workerd is expected to fail. The test then restores the injected component and calls disposal again only to clean up the child process it deliberately exposed.

The second test injects a rejection from `DevRegistry.dispose()`, which runs after runtime disposal. It is a negative control: the first disposal should already have sent `SIGKILL` before the later rejection.

## Source result

The current sequence has two pre-runtime awaited components:

1. browser-process cleanup;
2. proxy-client cleanup, including termination of its synchronous-fetch worker thread.

A rejection from either component can skip `Runtime.dispose()`. Browser cleanup includes explicit time bounds but can still reject if process or WebSocket operations throw. Proxy worker termination has no local deadline. A promise from either component that never settles also delays runtime termination.

The Vitest pool catches the resulting `Miniflare.dispose()` rejection and writes it only through `util.debuglog`, then continues to remote-session and shared asset-watcher cleanup. A pending Miniflare disposal blocks those later pool operations as well.

## Bounded repair direction

- Make `Runtime.dispose()` a must-run phase.
- Isolate cleanup components and collect tagged failures.
- Preserve required ordering around runtime dispatchers.
- Add a bounded diagnostic for any component that does not settle, naming the last completed phase.
- Return one aggregated disposal error after all bounded cleanup has run; callers may preserve the primary test result while surfacing a secondary warning.

The package test covers rejection before and after runtime termination. A follow-up pending-operation test should use a controllable deferred promise and assert that runtime termination begins before the diagnostic deadline.

Upstream contact authorized: `false`.
