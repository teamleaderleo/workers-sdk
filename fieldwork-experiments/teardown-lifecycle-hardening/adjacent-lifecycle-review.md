# Adjacent lifecycle review

Source branch: `fieldwork/teardown-lifecycle-hardening`

This pass looks beyond the original Vitest/Miniflare child-termination mechanism. It records confirmed adjacent behaviour, rejected explanations, and sequencing constraints for follow-up fixes.

## Vite development shutdown

`packages/vite-plugin-cloudflare/src/plugins/dev.ts` patches `viteDevServer.close()` with this order:

1. await Vite's original `close()`;
2. clean containers when this is a final shutdown;
3. await `ctx.disposeMiniflare()`;
4. catch Miniflare disposal errors to the plugin debug logger.

### Rejected explanation: container cleanup can throw past Miniflare disposal

`cleanupContainers()` is synchronous, but it catches Docker command failures and returns `false`. The Vite caller ignores the return value. Docker cleanup failure therefore does **not** skip `disposeMiniflare()` through an exception.

The actual issue is visibility: final shutdown, restart cleanup, preview exit cleanup, Wrangler local-runtime cleanup, and the rebuild hotkey all ignore the boolean result. A failed container removal can leave containers behind without a diagnostic.

### Image-preparation ownership is registered late

`prepareContainerImagesForDev()` processes configured images sequentially. A later build, pull, duplicate-tag cleanup, exposed-port check, or egress-image pull can reject after earlier image work has completed.

Both Vite dev and preview currently assign their `containerImageTags` cleanup ownership only after the entire preparation call resolves. If preparation rejects, the caller has no current-session tag set installed in its close/exit cleanup callback. Source review proves the ownership-registration gap; it does not by itself prove that a container has already started on every failure path.

`container-build-cleanup.mjs` models the desired contract and executed successfully:

- register the candidate tag set before asynchronous preparation;
- invoke cleanup when preparation rejects while preserving the exact preparation error;
- clear tags only after successful cleanup, making repeat cleanup cheap;
- retain tags and warn when cleanup fails so close/exit can retry.

`container-build-cleanup.patch` records the first bounded dev/preview candidate. It remains separate from production source pending plugin tests with mocked image preparation and container cleanup.

### One module-global exit callback loses earlier server ownership

Both `dev.ts` and `preview.ts` currently store one module-global `exitCallback`. Every plugin instance replaces that slot when it finishes container preparation.

The exported `cloudflare()` function constructs a fresh `PluginContext` and plugin array on every call. The source therefore permits more than one dev plugin instance or more than one preview plugin instance in the same Node.js process. With the current single-slot exit handler, the most recently prepared same-mode server owns force-exit cleanup and any earlier live server's callback is no longer reachable from the process exit listener.

This is a source-confirmed ownership defect. Ordinary CLI use commonly has one server, so incidence is unknown. Programmatic Vite use, tests, orchestrators, and multiple server instances are the important integration surfaces.

`vite-exit-cleanup-registry.mjs` was executed and passed these controls:

- the current single-slot model cleans only the second of two registered owners;
- a per-instance callback registry cleans both owners;
- a failed close-time cleanup retains ownership for an exit retry;
- a successful close unregisters and avoids duplicate cleanup;
- preparation failure preserves its exact original error.

`vite-exit-cleanup-registry.patch` supersedes the earlier container patch for implementation review. It combines:

- per-instance force-exit callback registration;
- registration before asynchronous image preparation;
- cleanup on preparation failure while preserving the preparation error;
- cleanup on programmatic preview close;
- warnings and retained retry ownership when cleanup returns `false`;
- unregistering only after successful final cleanup.

Required plugin tests:

1. create two same-mode plugin/server instances, assign distinct tags, run the exit registry, and prove both cleanup callbacks run;
2. close one instance successfully and prove it unregisters without affecting the other;
3. make cleanup fail on close and succeed on the exit retry;
4. reject a later preparation step after earlier image work and preserve the preparation error;
5. verify dev restart cleanup keeps the live instance registered for future tags.

### Open question: Vite close before Miniflare disposal

Development shutdown waits for the Vite server to close before requesting Miniflare termination. This order deserves an integration test with active module-transport requests and Worker WebSockets. A dependency cycle would require Vite's close promise to wait for a connection that only Miniflare/workerd termination can release.

The existing Worker WebSocket upgrade handler destroys in-flight sockets when Miniflare dispatch rejects during shutdown. Existing upgraded WebSockets are coupled to the Worker-side WebSocket and should close when workerd exits. Source review alone does not prove Vite's original `close()` can never wait on another Miniflare-owned transport.

Decisive test:

- start Vite dev with a Worker that maintains an HTTP stream, a Worker WebSocket, and a module-runner request;
- call `server.close()` programmatically;
- assert the close promise reaches `ctx.disposeMiniflare()` within a deadline;
- assert workerd receives `SIGKILL` and every client socket closes.

## Vite preview shutdown

`packages/vite-plugin-cloudflare/src/plugins/preview.ts` closes Miniflare and the Vite preview server concurrently with `Promise.all()`. Its comment explicitly mentions preview-server closure during prerendering.

Container cleanup is registered only through a process `exit` callback. A programmatic preview-server close during prerendering can therefore finish while built-image containers remain until the entire process exits.

`preview-container-close.patch` records the original narrow candidate:

- retain process-exit cleanup as a force-exit fallback;
- also clean containers in the preview server's close wrapper;
- preserve Miniflare/server close errors;
- surface a warning when `cleanupContainers()` returns `false`;
- clear the tag set after successful cleanup to make repeated cleanup cheap.

`vite-exit-cleanup-registry.patch` supersedes that candidate for implementation review by also registering ownership before image preparation and preserving every same-mode plugin instance.

This needs plugin tests with mocked image preparation, mocked container cleanup, multiple plugin instances, a programmatic preview close, and a cleanup-failure retry control.

## Shared Vite Miniflare state after a rejected disposal

`PluginContext.disposeMiniflare()` clears the shared Miniflare reference only after `dispose()` resolves. The dev close wrapper catches a disposal rejection, so the shared context may retain an instance whose disposal controller has already been aborted. A later plugin use would call `setOptions()` on that disposed instance.

A direct "clear before await" edit was prototyped and then reverted during self-review. With today's vulnerable Miniflare disposal, retaining the reference also preserves the only handle for a second cleanup attempt after an early rejection skipped runtime termination. Clearing it independently could trade a poisoned cache for an unreachable live child.

Safe sequencing:

1. make Miniflare runtime termination must-run;
2. make Miniflare cleanup complete its bounded phases before rejecting;
3. then clear Vite shared state before awaiting disposal, because retry ownership is no longer needed;
4. add a regression that a rejected disposal leaves no reusable disposed instance.

## Vitest runner startup and shutdown

Vitest launches runner stop promises concurrently and stores them for final pool shutdown. One pending `CloudflarePoolWorker.stop()` can hold final close after other workers complete, matching the user-visible parallel-file pattern in `cloudflare/workers-sdk#14903`.

There is a separate startup gap:

- `PoolRunner.start()` awaits the custom worker's `start()` with no timeout around that call;
- its internal 60-second timeout applies only to the later start handshake;
- the outer Pool schedules a 90-second resolver rejection but continues awaiting `runner.start()`;
- a permanently pending `CloudflarePoolWorker.start()` can therefore hold the scheduler before the force-stop path is reached.

`CloudflarePoolWorker.start()` can wait in configuration parsing, remote-proxy setup, Miniflare startup, or runner WebSocket connection. A startup-phase diagnostic should name the last completed phase and trigger explicit cleanup after its deadline.

Decisive test:

- inject a pending promise at each startup boundary;
- advance fake timers through Vitest's start timeout;
- assert the custom worker's `stop()` is invoked and shared watcher accounting returns to zero;
- assert a started workerd child is terminated even when startup never resolves.

## Post-runtime Miniflare cleanup

### Inspector proxy

Inspector disposal closes proxy WebSockets, calls `closeAllConnections()`, and then awaits the HTTP server close callback. It runs after workerd termination, so a failure or delay here cannot prevent the workerd kill request. It can still delay overall `Miniflare.dispose()` and mask an earlier primary failure under sequential cleanup.

### Hyperdrive proxy

Hyperdrive disposal stops accepting new connections and deliberately avoids awaiting `net.Server.close()` because lingering database sockets could block indefinitely. This is an explicit bounded-shutdown choice and a useful precedent for ownership-first cleanup.

## Repair ordering

1. Land the runtime-first Miniflare child-ownership change and its rejection/pending tests.
2. Add phased cleanup and primary-error aggregation.
3. Add Miniflare component deadlines with named diagnostics.
4. Harden Vite shared state once Miniflare disposal has a complete bounded contract.
5. Add the per-instance Vite container cleanup registry, early ownership, close-time cleanup, and cleanup-failure reporting.
6. Add a Vitest startup-timeout cleanup contract.

No upstream interaction was performed.
