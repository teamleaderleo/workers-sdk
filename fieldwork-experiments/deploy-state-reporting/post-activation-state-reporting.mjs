import assert from "node:assert/strict";

function formatReceipt({ phase, scriptName, versionId }) {
	return {
		activationCompleted: true,
		phase,
		scriptName,
		versionId,
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

for (const phase of ["container rollout", "trigger deployment"]) {
	const originalError = new Error(`${phase} failed`);
	const context = {
		phase,
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

	assert.equal(observedError, originalError);
	assert.deepEqual(context.receipts, [
		{
			activationCompleted: true,
			phase,
			scriptName: "example-worker",
			versionId: "11111111-1111-1111-1111-111111111111",
			recoveryBoundary: "inspect-before-retry-or-rollback",
		},
	]);
}

{
	const context = {
		phase: "trigger deployment",
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
console.log("PASS: container and trigger failures emit phase/version receipts");
console.log("PASS: successful post-activation phases emit no failure receipt");
