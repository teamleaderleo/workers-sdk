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

## Precedent review

`precedent-and-policy.md` compares this behavior with TypeScript, Prettier, ESLint, Vite, Biome, Cargo, and recent Workers SDK redirect work.

The main precedent is consistent across those tools:

- automatic discovery and explicit config paths are separate modes;
- the discovery anchor and boundary are part of the user contract;
- most single-config tools choose the nearest directory first, then use filename precedence only to break a same-directory tie;
- project-root tools such as Vite deliberately avoid ancestor inheritance;
- explainability tools or documented merge/precedence order are important once discovery becomes non-trivial.

Workers Utils' format-first ancestor search is the unusual part: a farther parent JSON can beat a nearer JSONC or TOML. It is existing behavior and therefore compatibility-sensitive, but it should be visible.

Merged upstream PR `cloudflare/workers-sdk#14897` also demonstrates the risk of command-specific redirect booleans: `wrangler triggers deploy` had to opt into the generated-config redirect already used by other deployment commands.

## Smallest coherent direction

Introduce a shared config-selection policy and result rather than immediately forcing identical defaults. It should report:

- invocation profile and command;
- search start and upward-search boundary;
- nearest-first, format-first, or merge behavior;
- extension precedence;
- whether deploy-config redirect discovery is enabled;
- requested path, user/source path, selected path, and deploy-config path;
- environment name passed to config normalization;
- candidates considered and stable rejection reasons;
- a stable selection reason such as `explicit`, `root-discovery`, `upward-discovery`, or `deploy-redirect`.

Wrangler and Vite may retain different named policy profiles, but package tests should make each difference explicit and tooling should be able to print the selected source/generated relationship.

Recommended migration:

1. characterize current behavior;
2. centralize mechanics without changing outcomes;
3. add a `config explain` or stable verbose trace;
4. warn only on ambiguous layouts where profiles disagree;
5. consider default alignment only through a documented major-version migration.

## Validation boundary

The retained dependency-free probes passed in the preceding branch. The new package test is committed and source-reviewed but was not executed because this environment cannot clone the repository or install the workspace. No upstream interaction occurred.