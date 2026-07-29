# Teardown error visibility and ownership experiment

Source revision: `e09da32b58bc3f6808bce9696e80af0d5f8652b8`

Run:

```sh
node fieldwork-experiments/teardown-error-visibility/teardown-error-visibility.mjs
node fieldwork-experiments/teardown-error-visibility/teardown-ownership.mjs
```

## Source trace

`packages/vitest-pool-workers/src/pool/cloudflare-pool-worker.ts` closes the socket, catches Miniflare disposal rejection, writes it through `util.debuglog`, and continues. Remote proxy session disposal is handled the same way.

`packages/vite-plugin-cloudflare/src/plugins/dev.ts` patches `server.close()`, catches Miniflare disposal rejection, and sends it only to the plugin debug logger. Container cleanup is synchronous and called from several shutdown paths.

`packages/miniflare/src/index.ts` performs teardown through a sequence of awaited operations. Several early operations, including browser cleanup, proxy-client disposal, runtime disposal, loopback shutdown, inspector disposal, registry disposal, and Hyperdrive disposal, are not individually isolated. A rejection before `Runtime.dispose()` prevents the later runtime-kill step from running.

`packages/miniflare/src/runtime/index.ts` shows why that skipped step is consequential: `Runtime.dispose()` destroys the child-process streams, sends `SIGKILL` to `workerd`, and waits for its exit.

## Results

The visibility model passes:

- two Vitest teardown failures produce zero ordinary user-visible errors and two debug-only records;
- a Vite Miniflare teardown failure produces zero ordinary user-visible errors and one debug-only record;
- both caller-facing stop/close operations finish as successful.

The ownership model passes:

- an early proxy-client rejection stops sequential cleanup before the modeled `workerd` termination step;
- the outer Vitest-style catch hides the rejection while the modeled runtime remains alive;
- failure-isolated cleanup reaches runtime termination and later cleanup while collecting the failed component for one secondary diagnostic.

This connects directly to reports where tests pass but Vitest never exits with a live `workerd` child. A pending disposal promise is another possible path and requires package-level reproduction, but rejection alone is already sufficient to demonstrate unsafe cleanup ordering.

## Campaign implication

The campaign should cover ownership before presentation:

1. Make runtime termination a must-run cleanup step even when earlier cleanup rejects.
2. Isolate independent cleanup components so one rejection does not skip the remainder.
3. Aggregate component failures for one visible secondary warning while preserving the primary test result.
4. Add a bounded teardown diagnostic for disposal that never settles, naming the step where progress stopped.
5. Add tests that inject failures before and after runtime termination and assert that the child-process kill path still runs.

Validation here is a source-backed behaviour model. The package test suite was not run in the Fieldwork runtime because cloning and dependency installation were unavailable.
