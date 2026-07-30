# Wrangler import-time proxy dispatcher ownership

Source branch: `fieldwork/teardown-lifecycle-hardening`

Upstream contact authorized: `false`

Upstream contact performed: `false`

## Finding

The Cloudflare Vite plugin imports the public `wrangler` package as a library. The public package resolves to `wrangler-dist/cli.js`, built from `src/index.ts`.

At module evaluation, Wrangler reads proxy environment variables and, when one is present, calls Undici's `setGlobalDispatcher(new EnvHttpProxyAgent(...))`.

Importing the Vite plugin can therefore replace the host Node.js process's global fetch dispatcher before any Vite server or Cloudflare operation begins.

## Source trace

Wrangler package exports:

```json
{
  ".": {
    "default": "./wrangler-dist/cli.js"
  }
}
```

The Vite plugin imports `* as wrangler from "wrangler"` in modules such as `plugin-config.ts` and `dev-vars.ts`.

Wrangler's CLI entrypoint performs this work at top level:

```ts
if (proxy) {
  setGlobalDispatcher(
    new EnvHttpProxyAgent({ noProxy: noProxy || "localhost,127.0.0.1,::1" })
  );
  logger.warn("Proxy environment variables detected...");
}
```

`proxy` and `noProxy` are captured from process environment during module evaluation.

The existing Wrangler proxy-output test confirms that dynamically importing `../index` with `HTTPS_PROXY` set produces the proxy startup warning before `main()` is invoked.

## Consequences for Vite embedding

- a host process with a custom Undici dispatcher loses it when the plugin import evaluates Wrangler;
- unrelated host `fetch()` calls begin using Wrangler's proxy agent;
- the mutation is process-global and has no restoration owner;
- two embedded operations cannot choose distinct proxy routes;
- changing proxy environment after first import does not reconfigure the cached module;
- importing the plugin can emit a Wrangler warning even before a Vite command is configured;
- an application that expected direct routing or custom TLS/dispatcher behavior can be silently rerouted.

Using a `try/finally` restore around one Vite server would not make concurrent host operations safe because the global dispatcher is observed process-wide while installed.

## Executed model

Executed:

```sh
node /tmp/vite-wrangler-import-proxy-dispatcher.mjs
```

The executed content is identical to:

`fieldwork-experiments/teardown-lifecycle-hardening/vite-wrangler-import-proxy-dispatcher.mjs`

Output:

```text
PASS: importing Wrangler can replace the host global dispatcher
PASS: a side-effect-free library import preserves host routing
PASS: CLI-owned dispatcher setup can restore the prior host dispatcher
PASS: operation dispatchers isolate concurrent host and Vite routes
```

Evidence class: `source-read` plus `model-executed`.

No real proxy, HTTP request, Vite package test, TLS configuration, or network call executed.

## Repair slices

### Slice 1: no import-time dispatcher mutation

Move proxy-dispatcher installation out of module evaluation and into the actual Wrangler CLI execution boundary.

The CLI can install the proxy dispatcher before parsing/executing a command and restore the previous dispatcher after the command settles. Long-running commands retain the proxy for their lifetime.

Library import must not mutate the host dispatcher or emit CLI startup warnings.

### Slice 2: explicit embedded proxy routing

Removing the top-level mutation can change proxy behavior for public Wrangler APIs used as libraries. Embedded API operations that need proxy-environment support should receive an explicit dispatcher or fetch implementation.

Preferred direction:

- construct one immutable `EnvHttpProxyAgent` per CLI or embedded operation;
- pass it through Cloudflare API/request contexts;
- use Undici's per-request `dispatcher` option where possible;
- close the operation-owned dispatcher after the operation;
- never replace a host application's global dispatcher merely because a library was imported.

An AsyncLocalStorage wrapper around `fetch` would be weaker than explicit request context and would not cover third-party clients that read Undici's global dispatcher directly.

## Required tests

1. Importing `wrangler` with `HTTPS_PROXY` set leaves a preinstalled host dispatcher unchanged.
2. Importing the Cloudflare Vite plugin leaves the host dispatcher unchanged.
3. Import alone emits no Wrangler proxy startup warning.
4. Running Wrangler CLI with proxy env uses an EnvHttpProxyAgent for the command lifetime.
5. CLI completion restores the exact previous dispatcher and closes the CLI-owned agent.
6. Failed CLI command also restores the prior dispatcher and preserves the original error.
7. Long-running `wrangler dev` retains proxy routing until final close.
8. Two concurrent embedded API operations can use different explicit proxy dispatchers without affecting host fetch.
9. Vite remote binding, config/API, tunnel, and container credential paths retain intended proxy support through explicit operation context.
10. No-proxy defaults remain compatible for CLI use.
11. Module caching and proxy-env changes are characterized explicitly.
12. Existing proxy-output JSON behavior remains parseable.

## Boundary

This candidate concerns host-process network routing caused by importing Wrangler as a library. It is separate from #187's account/token authority and #186's remote session identity, although their request paths may eventually consume an explicit operation dispatcher.

No upstream interaction occurred.
