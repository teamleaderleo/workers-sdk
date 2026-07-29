# A002: Wrangler and Vite configuration selection contract

Base revision: `0497e9e30e191f2b7e337b01e32855c4cb6cf5fe`

Branch: `fieldwork/config-selection-contract`

Upstream contact authorized: `false`

## Package characterization

`packages/vite-plugin-cloudflare/src/__tests__/config-selection-contract.spec.ts` compares the Vite selector directly with the shared Workers Utils selector used by Wrangler.

Intended command:

```sh
pnpm --filter @cloudflare/vite-plugin test:ci -- config-selection-contract.spec.ts
```

The matrix covers five cases:

| Case | Wrangler / Workers Utils | Vite plugin | Classification |
| --- | --- | --- | --- |
| `wrangler.json` and `wrangler.jsonc` in one directory | `wrangler.json` | `wrangler.jsonc` | compatibility-sensitive divergence |
| parent `wrangler.json`, root `wrangler.jsonc` | parent JSON | root JSONC | compatibility-sensitive divergence |
| only a parent config exists | parent config | zero-config / undefined | deliberate root boundary, insufficiently disclosed |
| source config plus `.wrangler/deploy/config.json` redirect | generated config | source config | consequential divergence |
| explicit generated `configPath` | generated config | generated config | supported convergence / escape hatch |

## Source conclusion

The difference is not one accidental conditional. The selectors currently encode different policies:

- Workers Utils searches upward once per format, with format order `json`, `jsonc`, `toml`.
- Vite checks only the configured Vite root, with format order `jsonc`, `json`, `toml`.
- Wrangler callers may opt into `.wrangler/deploy/config.json` redirection.
- Vite resolves a concrete source path and passes it explicitly to Wrangler's reader, bypassing redirect discovery.

The Vite root boundary is defensible because Vite owns an explicit project root. The extension precedence and redirect behavior are compatibility-sensitive and should not be changed silently. The current API does not expose one inspectable policy record explaining which dimensions differ.

## Smallest coherent direction

Introduce a shared config-selection policy result rather than immediately forcing identical defaults. It should report:

- search start and upward-search boundary;
- extension precedence;
- whether deploy-config redirect discovery is enabled;
- requested path, user/source path, selected path, and deploy-config path;
- environment name passed to config normalization;
- a stable selection reason such as `explicit`, `root-discovery`, `upward-discovery`, or `deploy-redirect`.

Wrangler and Vite may retain different policies, but package tests should make each difference explicit and tooling should be able to print the selected source/generated relationship.

## Validation boundary

The retained dependency-free probes passed in the preceding branch. The new package test is committed and source-reviewed but was not executed because this environment cannot clone the repository or install the workspace. No upstream interaction occurred.
