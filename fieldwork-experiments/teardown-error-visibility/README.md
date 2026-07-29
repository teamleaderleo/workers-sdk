# Teardown error visibility experiment

Source revision: `e09da32b58bc3f6808bce9696e80af0d5f8652b8`

Run:

```sh
node fieldwork-experiments/teardown-error-visibility/teardown-error-visibility.mjs
```

## Source trace

`packages/vitest-pool-workers/src/pool/cloudflare-pool-worker.ts` closes the socket, catches Miniflare disposal rejection, writes it through `util.debuglog`, and continues. Remote proxy session disposal is handled the same way.

`packages/vite-plugin-cloudflare/src/plugins/dev.ts` patches `server.close()`, catches Miniflare disposal rejection, and sends it only to the plugin debug logger. Container cleanup is synchronous and called from several shutdown paths.

## Result

The source-behaviour model passes:

- two Vitest teardown failures produce zero ordinary user-visible errors and two debug-only records;
- a Vite Miniflare teardown failure produces zero ordinary user-visible errors and one debug-only record;
- both caller-facing stop/close operations finish as successful.

This policy protects the primary test result, but it can hide the cause of locked state directories, live child processes, occupied ports, or stale remote sessions on the next run.

## Campaign implication

Keep the primary result intact and raise teardown failures to a visible secondary diagnostic. A useful patch would:

- collect disposal failures rather than dropping them after debug logging;
- emit one concise warning after teardown with component names;
- retain full error details in debug output;
- add unit tests for successful teardown, single failure, and multiple failures;
- avoid changing a passed test suite into a failed suite solely because cleanup rejected.

Validation here is a source-backed behaviour model. The package test suite was not run in the Fieldwork runtime because cloning and dependency installation were unavailable.
