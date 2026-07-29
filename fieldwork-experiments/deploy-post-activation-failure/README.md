# Post-activation deployment failure experiment

Source revision: `e09da32b58bc3f6808bce9696e80af0d5f8652b8`

Run:

```sh
node fieldwork-experiments/deploy-post-activation-failure/deploy-post-activation-failure.mjs
```

## Source trace

In `packages/deploy-helpers/src/deploy/deploy.ts`, the new versions path uploads a version and creates a deployment sending that version to 100% traffic before container rollout and trigger deployment. The legacy path performs the script `PUT` before trigger deployment. Container and trigger calls are awaited and their errors escape the function.

The code performs an early Docker-presence check to avoid one known disjoint state. It does not add compensation or a status-rich error for container or trigger failures after activation.

## Result

The source-order model passes for three cases:

1. New versions API: container rollout rejects after the new version is active.
2. New versions API: trigger deployment rejects after the new version is active.
3. Legacy `PUT`: trigger deployment rejects after the new Worker code is active.

Each case returns a failed command state while the model's active version remains `new`.

## Campaign implication

Automatic rollback is risky because a later step may be safely retryable and rollback can create another deployment. The first patch should improve state visibility:

- track whether code activation completed;
- include the activated version ID in post-activation errors;
- identify the failed phase (`containers` or `triggers`);
- print inspection, retry, and rollback commands;
- add tests asserting the enriched error after mocked post-activation failures.

Validation here is a source-backed ordering model, not an API integration test. A full campaign should run mocked deploy-helper tests and, if credentials are available in an authorized test account, a disposable end-to-end deployment.
