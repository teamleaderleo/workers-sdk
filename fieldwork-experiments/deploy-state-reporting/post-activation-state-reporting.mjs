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
		context.receipts.push(formatReceipt(context));
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
	const context = {
		phase: scenario.phase,
		activationMethod: scenario.activationMethod,
		scriptName: "example-worker",
		versionId: "11111111-1111-1111-1111-111111111111",
		receipts: [],
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
	assert.deepEqual(context.receipts, [
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
	const context = {
		phase: "trigger deployment",
		activationMethod: "versions deployment",
		scriptName: "example-worker",
		versionId: "22222222-2222-2222-2222-222222222222",
		receipts: [],
	};
	const targets = await runPostActivationPhase(context, async () => [
		"example.com/*",
	]);
	assert.deepEqual(targets, ["example.com/*"]);
	assert.deepEqual(context.receipts, []);
}

console.log("PASS: post-activation failures retain the original error");
console.log("PASS: receipts identify legacy upload versus versions deployment");
console.log("PASS: container and trigger failures report possible partial state");
console.log("PASS: successful post-activation phases emit no failure receipt");