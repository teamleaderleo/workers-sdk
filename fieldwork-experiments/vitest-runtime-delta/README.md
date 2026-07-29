# Vitest runtime capability delta experiment

Source revision: `e09da32b58bc3f6808bce9696e80af0d5f8652b8`

Run:

```sh
node fieldwork-experiments/vitest-runtime-delta/vitest-runtime-delta.mjs
```

## Source trace

`packages/vitest-pool-workers/src/pool/index.ts` intentionally modifies the runner Worker so Vitest can execute inside workerd. It adds or forces:

- `no_handle_cross_request_promise_resolution`;
- `nodejs_compat_v2`;
- `unsafe_module`;
- six `enable_nodejs_*` feature flags;
- an unsafe-eval binding and module fallback service;
- injected `node:console` and `node:vm` modules;
- an ephemeral singleton Durable Object for the runner.

When no compatibility date is supplied, the test runner uses the current date at test time.

## Result

The model passes and shows a deployed config containing only `nodejs_compat` becoming a test runtime with nine additional compatibility flags plus helper capabilities and injected modules.

This delta is intentional runner machinery. Strict test/deployment parity would prevent Vitest from working, so the useful campaign is disclosure and deployability checking rather than removing the additions.

## Campaign implication

Reframe this candidate around an inspectable runtime manifest:

- expose the effective compatibility date and flags used by the test runner;
- identify flags and modules added solely for the runner;
- optionally warn when application code imports a capability supplied only by the runner layer;
- add a helper that compares the user Worker's declared deployment config with the effective test runtime;
- keep runner internals clearly separated from application capability claims.

Validation here is a source-backed capability model. It does not prove that a particular application relies on a test-only capability; that requires an application fixture and package-level tests.
