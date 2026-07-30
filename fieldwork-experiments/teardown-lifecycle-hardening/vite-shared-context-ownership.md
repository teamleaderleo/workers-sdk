# Vite shared-context ownership

Source branch: `fieldwork/teardown-lifecycle-hardening`

Upstream contact authorized: `false`

Upstream contact performed: `false`

## Finding

The Cloudflare Vite plugin needs state that survives one logical dev server's restart. The current implementation stores that state in process-global objects shared by every `cloudflare()` plugin instance.

That preserves sequential restart continuity, but conflates concurrent and later independent server owners.

## Source trace

`src/index.ts` creates one module-global `SharedContext`. Every `cloudflare()` call creates a fresh `PluginContext` backed by it.

The shared record contains:

- the active Miniflare instance;
- Worker export-type state;
- the worker-config warning latch;
- restart accounting;
- tunnel hostnames.

`PluginContext.startOrUpdateMiniflare()` creates the shared Miniflare once and later plugin instances invoke `setOptions()` on that same object. A second server can therefore replace the runtime options observed by the first.

The restart counter is also shared. Each server's patched `restart()` increments it, while dev and tunnel close wrappers skip final cleanup whenever it is nonzero. Server A restarting while unrelated server B closes can cause B to skip container, tunnel, and Miniflare teardown.

## Tunnel singleton ownership

The tunnel layer keeps one module-global `TunnelManager`.

Consequences:

- starting another tunnel disposes or replaces the previous manager-owned tunnel;
- closing any server can dispose the shared tunnel;
- helper functions such as toggle, expiry extension, SSE warning, and open-state inspection target the global manager rather than one server owner;
- tunnel hostnames live in the shared context and are folded into Vite allowed-host configuration.

`TunnelManager.dispose()` clears tunnel state but does not replace the module-global manager or its constructor-captured logger. Later `configureServer()` and `configurePreviewServer()` use `tunnelManager ??= new TunnelManager(logger)`, so a server created after final close reuses the disposed manager and continues logging through the previous server's logger.

The dev allowed-host path itself is a negative result: after tunnel startup discovers public hostnames, it records them and restarts the dev server when the resolved allowed-host list is missing them.

## Supported Vite restart ordering

The package supports Vite 6, 7, and 8. Source review of Vite 6.1.0, 7.1.12, and 8.1.5 found the same relevant sequence:

1. create replacement server plugins and middleware;
2. close the old generation;
3. graft replacement state onto the existing user-facing server object;
4. rebind the replacement's internal server reference;
5. listen again.

Replacement plugin construction therefore occurs inside the old server's `restart()` call before old-generation close. This supports an async-scoped logical-owner handoff across all supported majors.

## Executed models

Executed:

```sh
node /tmp/vite-shared-context-ownership.mjs
node /tmp/vite-restart-owner-handoff.mjs
node /tmp/vite-tunnel-manager-reuse.mjs
```

The executed content is identical to the committed artifacts.

### Shared context

```text
PASS: a global runtime lets one plugin overwrite another plugin runtime
PASS: a global restart counter can suppress an unrelated final close
PASS: owner-scoped runtimes isolate concurrent servers
PASS: owner-scoped restart state does not suppress another owner cleanup
PASS: sequential generations of one logical server retain restart continuity
```

### Restart owner handoff

```text
PASS: independent first-generation servers receive distinct owners
PASS: replacement plugins inherit only the restarting server owner
PASS: unrelated final close proceeds during another server restart
PASS: concurrent restarts keep owner handoffs isolated
PASS: failed replacement construction preserves the original server owner and error
```

### Tunnel manager lifetime

```text
PASS: a disposed global tunnel manager is reused with the old logger
PASS: owner-scoped tunnel managers keep concurrent loggers isolated
PASS: final close removes only the intended tunnel owner
```

Evidence class: `source-read` plus `model-executed`.

No Vite package, live tunnel, browser, or multi-server integration test executed.

## Repair slices

### Slice 1: instance-local restart state

`vite-instance-restart-scope.patch` moves restart accounting from `SharedContext` into one `PluginContext`.

The restart wrapper and close wrappers for one server capture that same context, so unrelated servers do not need process-global restart classification.

Required tests:

1. server A begins a restart;
2. unrelated server B closes while A's restart is pending;
3. B performs final container, tunnel, and Miniflare cleanup;
4. A's own restart close still skips final teardown;
5. nested restart accounting cannot underflow.

The patch remains unapplied.

### Slice 2: logical owner and generation handoff

Moving only the restart counter does not solve shared Miniflare, tunnel, export map, warning, or hostname ownership.

A promising foundation is an async-scoped owner handoff:

- initial plugin factories outside restart create separate owners;
- the patched restart runs Vite's original restart inside that owner's async context;
- replacement factories claim only the restarting owner;
- concurrent restarts retain separate async contexts;
- failed replacement construction leaves the old generation, owner, and exact error intact.

The complete owner record should include Miniflare, one TunnelManager with the current owner's logger, export types, warning state, and tunnel hostnames.

A generation protocol must prevent stale old-generation close from disposing a replacement that already claimed the owner. True final close must dispose and delete only that owner's record so a later independent server constructs a manager with its own logger.

Do not key ownership only by project root and do not use a process-global handoff queue. Concurrent servers can share a root and concurrent restarts can interleave.

## Required integration matrix

1. Two concurrent dev servers retain distinct Miniflare options and request routing.
2. Updating server B does not change server A's runtime.
3. Restarting server A does not suppress server B's final close.
4. Closing server B does not dispose server A's runtime or tunnel.
5. Two tunnels retain distinct origins, public URLs, loggers, allowed-host state, toggle behavior, and expiry state.
6. Final close of server A removes A's manager; later server C logs through C's logger rather than A's.
7. Sequential restart generations of server A inherit only A's owner.
8. Concurrent restarts of A and B do not cross-claim owners.
9. Failed replacement construction preserves the old owner and exact failure.
10. A stale old generation cannot dispose the replacement.
11. Export-type and warning state from one server cannot alter another server's validation.
12. Final close removes the logical owner record; repeated close remains safe.

The restart and owner-handoff matrix should run on Vite 6, 7, and 8.

## Boundary

This is separate from candidate #165's container callback registry and candidate #183's build-operation marker. The restart-counter patch may land independently; the logical owner record requires dedicated integration evidence.

No live tunnel, Docker/container, browser, deployment, or upstream interaction occurred.
