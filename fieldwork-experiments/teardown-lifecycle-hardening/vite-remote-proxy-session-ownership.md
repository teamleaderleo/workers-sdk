# Vite remote proxy session ownership

Source branch: `fieldwork/teardown-lifecycle-hardening`

Upstream contact authorized: `false`

Upstream contact performed: `false`

## Finding

The Cloudflare Vite plugin caches live remote-binding proxy sessions in one module-global map keyed only by Worker config path.

The cache is shared by dev and preview. Vite server close does not dispose or delete the cached sessions.

A cached session also carries connection identity that is not represented in the key or reuse comparison: Worker name, account ID, compliance region, profile directory, auth-derived credentials, logger, and the live proxy `DevEnv`.

## Source trace

`src/miniflare-options.ts` declares:

```ts
const remoteProxySessionsDataMap = new Map<
  string,
  RemoteProxySessionData | null
>();
```

Both `getDevMiniflareOptions()` and `getPreviewMiniflareOptions()`:

1. look up the existing entry by `worker.config.configPath`;
2. call `maybeStartOrUpdateRemoteProxySession()`;
3. write the returned live session back under the same config path.

No Vite dev or preview close path disposes these sessions or deletes map entries.

Wrangler's `LocalRuntimeController` provides the lifecycle precedent: it stores the remote session on the controller, disposes it during controller teardown, and clears the controller field.

The Vitest pool also explicitly disposes its cached remote session during worker stop. It does not currently delete its map entry, which is a related disposed-entry reuse risk outside this Vite candidate.

## Identity comparison gap

`maybeStartOrUpdateRemoteProxySession()` compares only:

- the explicit `auth` hook stored in `RemoteProxySessionData`;
- the selected remote bindings.

Vite passes `auth` as `undefined`. The helper constructs the actual auth hook only when starting a session, using `account_id`, `profileDir`, and the current logger.

Therefore, when config path and remote bindings remain the same, changes to these fields do not trigger a replacement:

- Worker name;
- account ID;
- compliance region;
- profile directory;
- Vite logger.

The existing live session, connection string, internal auth hook, `DevEnv`, and original logger are reused.

This is especially consequential for account or compliance changes: a later Vite server can believe it is configured for one identity while still using a proxy session established for another.

## Disposed-entry reuse

`RemoteProxySession.dispose()` tears down its `DevEnv`, but `RemoteProxySessionData` contains no disposed marker.

If a caller disposes a session without deleting its cache entry, a later call with the same bindings and `auth === undefined` performs no update and returns the disposed session. Its `ready` promise is already resolved and its old connection string remains present.

The Vitest pool currently has exactly this shape: stop disposes the session but does not delete the config-path map entry.

## Executed model

Executed:

```sh
node /tmp/vite-remote-proxy-session-ownership.mjs
```

The executed content is identical to:

`fieldwork-experiments/teardown-lifecycle-hardening/vite-remote-proxy-session-ownership.mjs`

Output:

```text
PASS: Vite final close leaves a cached remote proxy session live
PASS: same config path reuses stale account, profile, worker, and logger identity
PASS: disposing without deleting the cache returns a disposed session later
PASS: owner-scoped sessions isolate servers and dispose only on final close
PASS: connection identity changes replace and dispose the old session
```

Evidence class: `source-read` plus `model-executed`.

No live remote binding, account, network, Vite package, or Vitest pool test executed.

## Repair direction

Remote sessions need two dimensions of identity:

1. **logical lifecycle owner** — the Vite server or Vitest pool worker that is responsible for final disposal;
2. **connection identity** — fields that require a new authenticated proxy session rather than an in-place binding update.

A Vite owner record should store its remote sessions and transfer them only to a replacement generation of the same logical server during restart.

Connection identity should include at least:

- Worker name;
- account ID;
- compliance region;
- profile directory;
- explicit auth-hook identity or generation;
- logger owner or a logger-updating contract.

When connection identity changes:

- dispose the old session;
- remove the old record before exposing a replacement;
- start a new session with the new identity;
- preserve the exact startup failure;
- never silently continue the old account or compliance session.

When only remote bindings change under the same identity, `updateBindings()` may retain the session.

On true final close:

- dispose every session owned by that logical server;
- remove every corresponding record;
- aggregate or report cleanup failures without replacing the primary server-close error;
- retain a failed-disposal record only when a later bounded retry owner remains reachable.

For the Vitest pool, disposal must be paired with cache deletion or replacement so a later worker cannot reuse a disposed entry.

## Draft API sketch

```ts
type RemoteProxyConnectionIdentity = {
  workerName?: string;
  accountId?: string;
  complianceRegion?: string;
  profileDir?: string;
  authGeneration?: unknown;
};

type OwnedRemoteProxySession = {
  identity: RemoteProxyConnectionIdentity;
  session: RemoteProxySession;
  remoteBindings: Record<string, Binding>;
};

interface RemoteProxySessionOwner {
  acquire(workerKey, identity, bindings, logger): Promise<RemoteProxySession | null>;
  disposeAll(): Promise<PromiseSettledResult<void>[]>;
}
```

The exact owner implementation should integrate with candidate #179's logical-server generation handoff rather than create another process-global registry.

## Required tests

1. Vite final close disposes and removes all owner sessions.
2. Vite restart transfers sessions only to the replacement generation of the same logical owner.
3. Two concurrent servers using the same config path receive distinct sessions and loggers.
4. Same config path and bindings with changed account ID starts a new session.
5. Changed compliance region starts a new session.
6. Changed profile directory or auth generation starts a new session.
7. Changed Worker name is characterized and either replaces the session or is proven irrelevant by the remote protocol.
8. Binding-only changes under stable identity use `updateBindings()` without replacement.
9. Failed replacement startup does not silently retain the old identity as though it matched the new configuration.
10. A disposed cached entry is never returned; Vite and Vitest pool controls both cover this.
11. New session logs use the current owner logger.
12. Final-close disposal failure preserves the primary close error and leaves an explicit retry/diagnostic record.
13. Dev and preview do not accidentally share one live session merely because their config path matches.
14. Account/compliance tests use mocked auth/session factories; no real credentials or network are required.

## Boundary

This is related to candidate #179's logical owner registry but deserves a separate review surface because it controls an authenticated remote network session and account/compliance identity.

No live remote connection, account access, credential use, deployment, or upstream interaction occurred.
