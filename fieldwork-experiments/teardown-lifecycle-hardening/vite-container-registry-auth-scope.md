# Vite container registry authentication scope

Source branch: `fieldwork/teardown-lifecycle-hardening`

Upstream contact authorized: `false`

Upstream contact performed: `false`

## Finding

Cloudflare container registry credential generation uses one generated `OpenAPI` configuration singleton.

The Cloudflare Vite plugin mutates that singleton with an account-specific base URL and bearer token before asynchronous image preparation. Dev and preview operations in the same Node.js process therefore share mutable account and credential state.

## Source trace

`configureOpenAPIForContainerPull(accountId, apiToken)` writes:

- `OpenAPI.BASE = .../accounts/{accountId}/containers`;
- `OpenAPI.HEADERS.Authorization = Bearer {apiToken}`.

`ImageRegistriesService.generateImageRegistryCredentials()` passes that same `OpenAPI` object into the generated request function.

`prepareContainerImagesForDev()` processes images sequentially. For every pulled image, including external registries, `pullImage()` first calls `dockerLoginImageRegistry()`, which requests configured registry credentials from Cloudflare.

The Vite dev and preview plugins call `configureOpenAPIForContainerPull()` only when at least one configured image uses the Cloudflare-managed registry.

This creates two independent contamination paths.

## Sequential carryover

Server A configures the singleton with account A and token A.

Later server B has only external images. B does not call `configureOpenAPIForContainerPull()`, but `pullImage()` still requests external-registry credentials through `ImageRegistriesService`.

The request therefore uses account A's endpoint and token A. Without prior contamination, the generated client defaults are empty and the external credential attempt would fail and fall back to an ordinary Docker pull warning path.

## Concurrent overwrite

Server A configures account A and then enters asynchronous image preparation.

Before A reaches `dockerLoginImageRegistry()`, server B configures account B. A's later credential request reads the shared singleton and uses account B's endpoint and token B.

The inverse ordering is equally possible. A `try/finally` restore around configuration would not make concurrent operations safe because the singleton can still be observed between writes.

## Request timing

Generated service methods pass the singleton by reference to the request helper. The URL and headers are derived when the request starts. The important race is therefore between Vite configuration and the later asynchronous `dockerLoginImageRegistry()` call, not only within one fetch invocation.

## Executed model

Executed:

```sh
node /tmp/vite-container-registry-auth-scope.mjs
```

The executed content is identical to:

`fieldwork-experiments/teardown-lifecycle-hardening/vite-container-registry-auth-scope.mjs`

Output:

```text
PASS: external-only later work inherits prior account and token
PASS: concurrent configuration sends operation A through operation B identity
PASS: per-operation clients isolate account, token, and endpoint
PASS: absent per-operation credentials cannot fall back to stale global auth
```

Evidence class: `source-read` plus `model-executed`.

No real API token, account, registry credential request, Docker login, image pull, Vite package test, or network call executed.

## Repair direction

Container registry credential lookup should use an immutable per-operation client rather than generated-client global mutation.

A client factory can clone an `OpenAPIConfig` for one account/token and expose only the credential operation needed by image preparation:

```ts
interface RegistryCredentialsClient {
  generateImageRegistryCredentials(
    domain: string,
    request: ImageRegistryCredentialsConfiguration
  ): Promise<AccountRegistryToken>;
}

function createRegistryCredentialsClient(options: {
  accountId: string;
  apiToken: string;
  apiBase?: string;
  logger?: WranglerLogger;
}): RegistryCredentialsClient;
```

`prepareContainerImagesForDev()` and `pullImage()` should receive this client explicitly.

Desired behavior:

- Cloudflare-managed images require an operation client and fail clearly when account/token are absent;
- external images use the operation client only when it is explicitly available;
- external-only work without a client follows the existing warning/fallback path and never observes stale global credentials;
- concurrent operations retain distinct account endpoints, tokens, and loggers;
- failed preparation does not mutate shared credential state;
- process environment tokens are read once into the operation owner and are not stored in a package singleton.

The generated static `ImageRegistriesService` may remain for existing single-operation CLI callers during migration, but Vite must not use it through shared mutable configuration.

## Required tests

1. Two concurrent Vite servers with different mocked account/token pairs request credentials through their own clients.
2. Server A configuration followed by external-only server B does not send A's token or account endpoint.
3. A failed image preparation leaves no credential state visible to later operations.
4. External-only work without an operation client warns and falls back without a Cloudflare API request.
5. Cloudflare-managed image without account/token fails before image preparation.
6. Mixed Cloudflare-managed and external images use one operation client intentionally and in sequence.
7. Per-operation logger ownership is preserved.
8. Token values never appear in diagnostics or retained test snapshots.
9. Custom API base used in tests remains operation-scoped.
10. Dev and preview operations do not share a client merely because they run in one process.
11. Concurrent credential requests capture the correct base URL and Authorization header.
12. Existing Wrangler/container CLI callers retain behavior or migrate with explicit compatibility tests.

## Boundary

This candidate concerns account and bearer-token authority for registry credential generation. It is separate from #165 container cleanup and #179 logical Vite runtime ownership, though a Vite logical owner may hold the immutable operation client during preparation.

No upstream interaction occurred.
