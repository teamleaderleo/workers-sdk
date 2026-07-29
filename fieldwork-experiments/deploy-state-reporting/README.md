# A003: Post-activation deployment state reporting

Base revision: `609623ba8552a016f3c67cee7259e38d8431bd91`

Branch: `fieldwork/deploy-state-reporting`

Upstream contact authorized: `false`

## Confirmed mutation order

The deploy helper has several mutation boundaries before it returns success:

| Phase | Applicable path | Mutation | Later failure can leave it applied? |
| --- | --- | --- | --- |
| pre-activation | both | asset sync, Workers Sites sync, resource provisioning, container image build | yes, but Worker code is not yet activated |
| activation | versions API | upload version then create a 100% deployment | yes |
| activation | legacy API | `PUT` the Worker script | yes |
| post-activation settings | versions API | patch tags, tail consumers, logpush, observability | settings failure is currently warning-only |
| post-activation | legacy container path | deploy containers | yes; error escapes |
| post-activation | both | deploy routes, domains, schedules, and other triggers | yes; error escapes |

At this source revision, container workers are explicitly excluded from the versions/deployments path. A container-rollout failure therefore follows a legacy script upload, not a versions deployment. Trigger failure can follow either activation path.

The command prints `Uploaded ...` after activation and before containers/triggers. It prints `Current Version ID` only after triggers succeed. A trigger failure therefore loses the most useful state identifier even though the new Worker code may already be active.

## Prototype

The branch adds a small `runPostActivationPhase()` helper and unit tests. The helper:

- reports the Worker name, activation method, activated version ID, and failed phase;
- warns that the new code may already be serving;
- warns that the failed phase may also have partially applied;
- tells the operator to inspect state before retry or rollback;
- rethrows the exact original error object;
- does not alter retry behavior, API error classification, telemetry, or rollback state.

`deploy-integration.patch` shows the bounded integration around only two operations:

- container rollout, identified as following the legacy script upload path;
- trigger deployment, identified as following either versions deployment or legacy script upload.

The source patch is retained separately instead of being applied automatically because package execution is unavailable in this environment and the exact wording/logging channel still needs repository test review.

## Why not automatic rollback

Automatic rollback is not one safe generic action:

- trigger deployment may have partially applied routes or schedules;
- container rollout may be independently retryable;
- rollback creates another deployment and can itself fail;
- the previous version may not match prior non-versioned settings or triggers;
- a new client retry may race an automatic rollback;
- the legacy path may not provide the same rollback identity and guarantees as the versions path.

The first repair should report known state without claiming the entire deployment is unchanged.

## Test surfaces still needed

1. Legacy script `PUT`: container callback rejects after code activation.
2. Versions API: `triggersDeploy()` rejects after a 100% deployment.
3. Legacy script `PUT`: `triggersDeploy()` rejects after code activation.
4. Success cases emit no failure receipt.
5. The original `APIError` or `UserError` identity is preserved.
6. A null or malformed upload version identifier is reported as unavailable, not fabricated.
7. Output ordering makes the receipt visible before the original error is rendered.
8. Machine-readable output receives a stable equivalent record.

## Validation

Executed successfully after correcting the activation-path matrix:

```sh
node fieldwork-experiments/deploy-state-reporting/post-activation-state-reporting.mjs
```

The model now covers legacy-upload/container failure, versions-deployment/trigger failure, legacy-upload/trigger failure, exact error preservation, and success without a receipt.

The package-level helper test and integration patch are committed but unexecuted because this environment cannot clone the workspace or install dependencies. No live deployment or upstream interaction occurred.