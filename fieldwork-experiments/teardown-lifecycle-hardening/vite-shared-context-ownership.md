# Vite shared-context ownership

Source branch: `fieldwork/teardown-lifecycle-hardening`

Upstream contact authorized: `false`

Upstream contact performed: `false`

## Finding

The Cloudflare Vite plugin needs state that survives one logical dev server's restart. The current implementation stores that state in one module-global `SharedContext` and passes it to every `PluginContext` created by every call to `cloudflare()`.

That design preserves sequential restart continuity, but it also conflates every concurrent plugin/server instance in the Node.js process.

## Source trace

`src/index.ts` creates one module-global `sharedContext`. Every `cloudflare()` call creates a fresh `PluginContext(sharedContext)`.

The shared object contains:

- the active Miniflare instance;
- the current Worker export-type map;
- the worker-config warning latch;
- the in-flight restart counter;
- tunnel hostnames.

`PluginContext.startOrUpdateMiniflare()` creates the shared Miniflare once and later callers invoke `setOptions()` on that same object. A second plugin instance can therefore replace the runtime options observed by the first instance.

`PluginContext.isRestartingDevServer` reads one shared restart counter. Each Vite server's patched `restart()` increments that counter, while each dev and tunnel close wrapper skips final cleanup whenever the counter is non-zero. If server A is restarting while unrelated server B closes, B can misclassify its final close as part of A's restart and skip container, tunnel, and Miniflare cleanup.

The tunnel layer has the same process-wide ownership shape:

- one module-global `TunnelManager` is initialized by the first server;
- starting another tunnel disposes the previous manager-owned tunnel;
- closing any server can dispose that shared tunnel;
- dev tunnel hostnames are written into the shared context and later folded into Vite `allowedHosts` during config.

The source proves process-wide ownership conflation. It does not establish how frequently users run multiple Cloudflare Vite servers in one process. Programmatic Vite APIs, tests, orchestrators, monorepo tooling, and embedded dev environments are the relevant surfaces.

## Executed model

Executed:

```sh
node /tmp/vite-shared-context-ownership.mjs
```

The executed content is identical to:

`fieldwork-experiments/teardown-lifecycle-hardening/vite-shared-context-ownership.mjs`

Output:

```text
PASS: a global runtime lets one plugin overwrite another plugin runtime
PASS: a global restart counter can suppress an unrelated final close
PASS: owner-scoped runtimes isolate concurrent servers
PASS: owner-scoped restart state does not suppress another owner cleanup
PASS: sequential generations of one logical server retain restart continuity
```

Evidence class: `source-read` plus `model-executed`.

No Vite package or integration test executed.

## Repair slices

### Slice 1: instance-local restart state

`vite-instance-restart-scope.patch` moves `restartingDevServerCount` from `SharedContext` into `PluginContext`.

This is the smallest source-directed correction. The `restart()` wrapper and the `close()` wrappers for one Vite server capture the same `PluginContext`, so their restart classification does not need to be process-global.

Required tests:

1. server A begins a restart;
2. unrelated server B closes while A's restart is pending;
3. B performs final container, tunnel, and Miniflare cleanup;
4. A's own restart close still skips final teardown;
5. nested restart accounting cannot underflow.

The patch remains unapplied pending package tests.

### Slice 2: logical runtime-owner registry

Moving only the restart counter does not solve the shared Miniflare, tunnel manager, export map, warning latch, or tunnel-hostname ownership.

A complete design needs one state record per logical server owner and an explicit handoff between sequential restart generations. Concurrent owners must receive separate runtime and tunnel records, while a replacement generation of the same owner must be able to reuse or deliberately replace its prior state.

Do not key this only by project root. Two concurrent servers can intentionally use the same root with different modes, inline configuration, ports, or test isolation.

Promising design constraints:

- create an opaque logical-owner token when a server is first configured;
- scope Miniflare, tunnel manager, export types, warning state, and tunnel hostnames to that token;
- let the patched `restart()` expose a bounded handoff token only to the replacement generation created during that restart;
- keep old-generation close from disposing state after the replacement has claimed it;
- dispose and remove an owner record after a true final close;
- preserve the original startup/restart error if handoff cleanup or disposal also fails.

The exact Vite restart construction order needs package instrumentation before selecting the handoff mechanism. A module-global queue without an owner token would recreate the same cross-server bug.

## Required integration matrix

1. Two concurrent dev servers with different Worker configurations retain distinct Miniflare options and request routing.
2. Updating server B does not change server A's runtime.
3. Restarting server A does not suppress server B's final close.
4. Closing server B does not dispose server A's runtime or tunnel.
5. Two tunnels retain distinct origins, public URLs, loggers, and allowed-host state.
6. A sequential restart of server A reuses or deliberately replaces only A's runtime state.
7. A failed restart leaves exactly one reachable cleanup owner and no stale generation capable of disposing the replacement.
8. Export-type and warning state from one server cannot suppress or alter another server's validation.
9. Final close removes the logical owner record; repeated close remains safe.

## Boundary

This is separate from candidate #165's container callback registry. The restart-counter patch may land independently after package tests. The logical runtime-owner registry requires a dedicated design and integration test slice.

No live tunnel, Docker/container, or multi-server reproduction was performed. No upstream interaction occurred.
