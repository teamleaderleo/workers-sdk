import assert from "node:assert/strict";

function formatReceipt({ phase, activationMethod, scriptName, versionId }) {
	return {
		activationCompleted: true,
		activationMethod,
		phase,
		scriptName,
		versionId,
		phaseMayHavePartiallyApplied: true,
		recoveryBoundary: "inspect-before-retry-or-rollback",
	};
}

async function runPostActivationPhase(context, operation) {
	try {
		return await operation();
	} catch (error) {
		try {
			context.report(formatReceipt(context));
		} catch {
			// Receipt reporting is secondary to the authoritative operation failure.
		}
		throw error;
	}
}

const failureCases = [
	{
		name: "legacy upload followed by container rollout failure",
		phase: "container rollout",
		activationMethod: "legacy script upload",
	},
	{
		name: "versions deployment followed by trigger failure",
		phase: "trigger deployment",
		activationMethod: "versions deployment",
	},
	{
		name: "legacy upload followed by trigger failure",
		phase: "trigger deployment",
		activationMethod: "legacy script upload",
	},
];

for (const scenario of failureCases) {
	const originalError = new Error(`${scenario.phase} failed`);
	const receipts = [];
	const context = {
		phase: scenario.phase,
		activationMethod: scenario.activationMethod,
		scriptName: "example-worker",
		versionId: "11111111-1111-1111-1111-111111111111",
		report(receipt) {
			receipts.push(receipt);
		},
	};

	let observedError;
	try {
		await runPostActivationPhase(context, async () => {
			throw originalError;
		});
	} catch (error) {
		observedError = error;
	}

	assert.equal(observedError, originalError, scenario.name);
	assert.deepEqual(receipts, [
		{
			activationCompleted: true,
			activationMethod: scenario.activationMethod,
			phase: scenario.phase,
			scriptName: "example-worker",
			versionId: "11111111-1111-1111-1111-111111111111",
			phaseMayHavePartiallyApplied: true,
			recoveryBoundary: "inspect-before-retry-or-rollback",
		},
	]);
}

{
	const originalError = new Error("trigger deployment failed");
	const reportingError = new Error("receipt sink failed");
	let observedError;
	try {
		await runPostActivationPhase(
			{
				phase: "trigger deployment",
				activationMethod: "versions deployment",
				scriptName: "example-worker",
				versionId: "22222222-2222-2222-2222-222222222222",
				report() {
					throw reportingError;
				},
			},
			async () => {
				throw originalError;
			}
		);
	} catch (error) {
		observedError = error;
	}
	assert.equal(observedError, originalError);
	assert.notEqual(observedError, reportingError);
}

{
	const receipts = [];
	const context = {
		phase: "trigger deployment",
		activationMethod: "versions deployment",
		scriptName: "example-worker",
		versionId: "33333333-3333-3333-3333-333333333333",
		report(receipt) {
			receipts.push(receipt);
		},
	};
	const targets = await runPostActivationPhase(context, async () => [
		"example.com/*",
	]);
	assert.deepEqual(targets, ["example.com/*"]);
	assert.deepEqual(receipts, []);
}

console.log("PASS: post-activation failures retain the original error");
console.log("PASS: receipt failures cannot replace the operation error");
console.log("PASS: receipts identify legacy upload versus versions deployment");
console.log("PASS: container and trigger failures report possible partial state");
console.log("PASS: successful post-activation phases emit no failure receipt");
