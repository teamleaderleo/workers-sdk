# Vite build marker operation scope

Source branch: `fieldwork/teardown-lifecycle-hardening`

Upstream contact authorized: `false`

Upstream contact performed: `false`

## Finding

The Cloudflare Vite plugin sets `process.env.CLOUDFLARE_VITE_BUILD = "true"` from its top-level `config` hook whenever Vite resolves a build.

The preview config path later reads that process-wide variable. When it is truthy and `.wrangler/deploy/config.json` contains a `prerenderWorkerConfigPath`, preview selects the prerender Worker instead of the ordinary entry Worker.

No production hook restores or deletes the marker.

## Direct evidence in the package

The playground test harness uses Vite's programmatic API to call `createBuilder(...).buildApp()` and then `preview(...)` in the same process. Immediately after `buildApp()`, it manually executes:

```ts
delete process.env.CLOUDFLARE_VITE_BUILD;
```

Its comment states that the variable tells a preview server it is being run during a build and must be deleted because the test preview runs in the same process after the build completes.

This is direct acknowledgement that the marker otherwise leaks from one completed build operation into a later independent preview.

## Consequences

### Successful build followed by independent preview

A programmatic build leaves the marker set. A later independent preview in the same process can select `prerenderWorkerConfigPath` instead of `configPath`.

### Failed build

The marker is set during config resolution, before `builder.buildApp()` completes. If config resolution or the build later throws, no `finally` restores the previous value. Later preview remains contaminated.

### Concurrent programmatic operations

While one build is active, an unrelated preview in the same process observes the same process environment and can be misclassified as build-owned prerender work.

### Repeated builds and pre-existing values

The assignment overwrites any prior value and does not restore it. The variable is documented in source as an internal marker, but process-global mutation still needs operation ownership and restoration.

## Executed model

Executed:

```sh
node /tmp/vite-build-marker-scope.mjs
```

The executed content is identical to:

`fieldwork-experiments/teardown-lifecycle-hardening/vite-build-marker-scope.mjs`

Output:

```text
PASS: a successful build leaves the process-wide marker sticky
PASS: a failed build also leaves the process-wide marker sticky
PASS: a concurrent unrelated preview observes the sticky marker
PASS: scoped build preview selects prerender only inside the build
PASS: concurrent unrelated preview stays outside scoped build state
PASS: scoped build failure preserves the error and clears the scope
```

Evidence class: `source-read` plus `model-executed`.

No Vite package, playground, or programmatic build/preview test executed.

## Draft repair direction

`vite-build-marker-scope.patch` replaces the internal process marker with an `AsyncLocalStorage` build context and wraps the selected `builder.buildApp` hook.

Desired properties:

- preview or prerender work nested inside the build sees build context;
- a later independent preview does not;
- concurrent preview outside the build async chain does not;
- build failure preserves the exact error and ends the context;
- a user-supplied `builder.buildApp` receives the same scope as the default Cloudflare build hook;
- no process environment value is overwritten or left behind.

## Important design boundary

The patch scopes work nested inside `builder.buildApp()`. That covers the package's normal build orchestration and custom buildApp hooks.

A framework may create child Vite servers during config resolution. A recent upstream test already covers a React Router child dev compiler created from `configResolved()` during build. That child is not an `isPreview` server and does not consume this marker, but it proves nested server creation before `buildApp()` is a real framework pattern.

Before production use, add a control where a framework creates an `isPreview` server during `configResolved()`. If that path is supported and must select the prerender Worker, the operation scope needs to begin above `builder.buildApp()` without using a process-global flag.

## Required tests

1. Programmatic `createBuilder().buildApp()` followed by independent `preview()` selects the ordinary entry Worker without manual environment deletion.
2. Build failure followed by independent preview selects the ordinary entry Worker and preserves the original build error.
3. Preview nested inside buildApp selects the prerender Worker when configured.
4. Concurrent unrelated preview during a pending build selects the ordinary entry Worker.
5. User-supplied `builder.buildApp` receives the same scoped behavior.
6. Two concurrent builds keep their nested preview state isolated.
7. A pre-existing `CLOUDFLARE_VITE_BUILD` value is not overwritten by plugin internals.
8. A child preview created during `configResolved()` is characterized explicitly across Vite 6, 7, and 8.
9. Entry versus prerender Worker selection is asserted from the parsed `.wrangler/deploy/config.json`, not only from a boolean helper model.
10. The process environment after success and failure is byte-for-byte unchanged from before the operation.

## Boundary

This is separate from candidate #165's container cleanup ownership and candidate #179's logical runtime/tunnel ownership. It concerns operation-scoped build intent and preview config selection.

No live build, preview server, browser, deployment, or upstream interaction occurred.
