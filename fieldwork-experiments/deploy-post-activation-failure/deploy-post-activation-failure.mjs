import assert from "node:assert/strict";

async function runNewApiDeploy({ failAt }) {
	const state = { activeVersion: "old", events: [], command: "running" };
	try {
		state.events.push("upload-version:new");
		state.events.push("create-deployment:new@100%");
		state.activeVersion = "new";

		state.events.push("patch-settings");
		if (failAt === "containers") {
			state.events.push("deploy-containers:failed");
			throw new Error("container rollout failed");
		}
		state.events.push("deploy-containers:ok");

		if (failAt === "triggers") {
			state.events.push("deploy-triggers:failed");
			throw new Error("trigger update failed");
		}
		state.events.push("deploy-triggers:ok");
		state.command = "success";
	} catch (error) {
		state.command = "failure";
		state.error = error.message;
	}
	return state;
}

async function runLegacyDeploy({ failAt }) {
	const state = { activeVersion: "old", events: [], command: "running" };
	try {
		state.events.push("put-script:new");
		state.activeVersion = "new";

		if (failAt === "triggers") {
			state.events.push("deploy-triggers:failed");
			throw new Error("trigger update failed");
		}
		state.events.push("deploy-triggers:ok");
		state.command = "success";
	} catch (error) {
		state.command = "failure";
		state.error = error.message;
	}
	return state;
}

const cases = [
	["new API / container failure", await runNewApiDeploy({ failAt: "containers" })],
	["new API / trigger failure", await runNewApiDeploy({ failAt: "triggers" })],
	["legacy PUT / trigger failure", await runLegacyDeploy({ failAt: "triggers" })],
];

for (const [, result] of cases) {
	assert.equal(result.command, "failure");
	assert.equal(result.activeVersion, "new");
}

console.table(
	cases.map(([scenario, result]) => ({
		scenario,
		command: result.command,
		activeVersion: result.activeVersion,
		finalEvent: result.events.at(-1),
	}))
);
console.log(
	"PASS: a failed command can leave the new Worker active when a later container or trigger step rejects."
);
