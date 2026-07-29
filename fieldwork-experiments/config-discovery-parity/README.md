# Config discovery and redirection parity experiment

Source revision: `e09da32b58bc3f6808bce9696e80af0d5f8652b8`

Run:

```sh
node fieldwork-experiments/config-discovery-parity/config-discovery-parity.mjs
node fieldwork-experiments/config-discovery-parity/config-redirect-parity.mjs
```

## Source trace

Wrangler's shared resolver searches upward for `wrangler.json`, then repeats the upward search for `wrangler.jsonc`, then for `wrangler.toml` (`packages/workers-utils/src/config/config-helpers.ts`).

The Vite plugin checks only the Vite root and uses the order `jsonc`, `json`, `toml` (`packages/vite-plugin-cloudflare/src/workers-configs.ts`).

Wrangler's `ConfigController` reads development config with `useRedirectIfAvailable: true`, so a `.wrangler/deploy/config.json` file can redirect `wrangler dev` to a generated configuration.

The Vite plugin first resolves a concrete source config path and then passes that path explicitly to `wrangler.unstable_readConfig()`. An explicit config path bypasses Wrangler's redirect lookup, so Vite development keeps the source configuration.

## Results

The discovery probe passes and demonstrates three divergent layouts:

1. When `wrangler.json` and `wrangler.jsonc` share a directory, Wrangler selects JSON and Vite selects JSONC.
2. When a parent contains `wrangler.json` and a child Vite root contains `wrangler.jsonc`, Wrangler selects the parent JSON while Vite selects the child JSONC. Format priority in Wrangler beats file proximity.
3. When only a parent config exists, Wrangler finds it while Vite finds no config.

A TOML-only config in the Vite root is the control case; both select the same file.

The redirection probe passes and demonstrates a fourth divergence:

4. With `/app/wrangler.jsonc` plus `/app/.wrangler/deploy/config.json` pointing at `/app/dist/server/wrangler.json`, `wrangler dev` selects the generated config while Vite development keeps `/app/wrangler.jsonc`.

The redirect difference can be intentional for framework-generated output, but it needs an explicit product contract because environment sections, bindings, compatibility flags, and entry points may differ between the source and generated files.

## Campaign implication

This is ready for upstream-style regression tests and a design decision. The coherent repair is a shared policy API rather than silently sharing one hard-coded behaviour:

- expose explicit search boundary, format precedence, and redirect policy options;
- make Wrangler and Vite choose those options deliberately;
- print the selected config and redirect relationship consistently when adapters differ by design;
- add tests for multiple formats, nested roots, parent-only configs, and deploy redirects.

Validation in this branch is dependency-free and executable with Node. The full Workers SDK package suite was not run in the Fieldwork runtime because direct repository cloning and package installation were unavailable.
