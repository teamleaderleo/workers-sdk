# Config discovery parity experiment

Source revision: `e09da32b58bc3f6808bce9696e80af0d5f8652b8`

Run:

```sh
node fieldwork-experiments/config-discovery-parity/config-discovery-parity.mjs
```

## Source trace

Wrangler's shared resolver searches upward for `wrangler.json`, then repeats the upward search for `wrangler.jsonc`, then for `wrangler.toml` (`packages/workers-utils/src/config/config-helpers.ts`).

The Vite plugin checks only the Vite root and uses the order `jsonc`, `json`, `toml` (`packages/vite-plugin-cloudflare/src/workers-configs.ts`).

## Result

The probe passes and demonstrates three divergent layouts:

1. When `wrangler.json` and `wrangler.jsonc` share a directory, Wrangler selects JSON and Vite selects JSONC.
2. When a parent contains `wrangler.json` and a child Vite root contains `wrangler.jsonc`, Wrangler selects the parent JSON while Vite selects the child JSONC. Format priority in Wrangler beats file proximity.
3. When only a parent config exists, Wrangler finds it while Vite finds no config.

A TOML-only config in the Vite root is the control case; both select the same file.

## Campaign implication

This is ready for an upstream-style regression test and design decision. The smallest coherent repair is to expose one shared discovery helper with an explicit root/search policy, then make both Wrangler and the Vite plugin call it. A warning-only repair would still leave commands reading different files.

Validation in this branch is dependency-free and executable with Node. The full Workers SDK package suite was not run in the Fieldwork runtime because direct repository cloning and package installation were unavailable.
