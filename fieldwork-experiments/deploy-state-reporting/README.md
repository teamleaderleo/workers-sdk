# A003: Post-activation deployment state reporting

Base revision: `609623ba8552a016f3c67cee7259e38d8431bd91`

Branch: `fieldwork/deploy-state-reporting`

Upstream contact authorized: `false`

## Confirmed mutation order

The deploy helper has several mutation boundaries before it returns success:

| Phase | Mutation | Later failure can leave it applied? |
| --- | --- | --- |
| pre-activation | asset sync, Workers Sites sync, resource provisioning, container image build | yes, but Worker code is not yet activated |
| activation, new API | upload version then create a 100% deployment | yes |
| activation, legacy API | `PUT` the Worker script | yes |
| post-activation settings | patch tags, tail consumers, logpush, observability | settings failure is currently warning-only on the new path |
| post-activation | deploy containers | yes; error escapes |
| post-activation | deploy routes, domains, schedules, and other triggers | yes; error escapes |

The command prints `Uploaded ...` after activation and before containers/triggers. It prints `Current Version ID` only after triggers succeed. A trigger failure therefore loses the most useful state identifier even though the new Worker code may already be active.

## Prototype

The branch adds a small `runPostActivationPhase()` helper and unit tests. The helper:

- reports the Worker name, activated version ID, and failed phase;
- warns that the new code may already be serving;
- tells the operator to inspect state before retry or rollback;
- rethrows the exact original error object;
- does not alter retry behavior, API error classification, telemetry, or rollback state.

`deploy-integration.patch` shows the bounded integration around only two operations:

- container rollout;
- trigger deployment.

The source patch is retained separately instead of being applied automatically because package execution is unavailable in this environment and the exact wording/logging channel still needs repository test review.

## Why not automatic rollback

Automatic rollback is not one safe generic action:

- trigger deployment may have partially applied routes or schedules;
- container rollout may be independently retryable;
- rollback creates another deployment and can itself fail;
- the previous version may not match prior non-versioned settings or triggers;
- a new client retry may race an automatic rollback.

The first repair should report known state without claiming the entire deployment is unchanged.

## Test surfaces still needed

1. New versions API: container callback rejects after `createDeployment()`.
2. New versions API: `triggersDeploy()` rejects after activation.
3. Legacy script `PUT`: `triggersDeploy()` rejects after activation.
4. Success cases emit no failure receipt.
5. The original `APIError` or `UserError` identity is preserved.
6. A null or malformed upload version identifier is reported as unavailable, not fabricated.
7. Output ordering makes the receipt visible before the original error is rendered.

## Validation

Executed successfully:

```sh
node fieldwork-experiments/deploy-state-reporting/post-activation-state-reporting.mjs
```

The package-level helper test and integration patch are committed but unexecuted because this environment cannot clone the workspace or install dependencies. No live deployment or upstream interaction occurred.
