import assert from "node:assert/strict";

async function currentSequentialCleanup(steps) {
	try {
		for (const step of steps) {
			await step.run();
		}
	} catch {
		// Models CloudflarePoolWorker.stop(): Miniflare disposal rejection is debug-only.
	}
}

async function failureIsolatedCleanup(steps) {
	const failures = [];
	for (const step of steps) {
		try {
			await step.run();
		} catch (error) {
			failures.push({ component: step.name, error: String(error) });
		}
	}
	return failures;
}

let workerdAlive = true;
const calls = [];
const rejectingSteps = [
	{
		name: "proxy-client",
		run: async () => {
			calls.push("proxy-client");
			throw new Error("proxy close failed");
		},
	},
	{
		name: "workerd-runtime",
		run: async () => {
			calls.push("workerd-runtime");
			workerdAlive = false;
		},
	},
	{
		name: "loopback-server",
		run: async () => {
			calls.push("loopback-server");
		},
	},
];

await currentSequentialCleanup(rejectingSteps);
assert.deepEqual(calls, ["proxy-client"]);
assert.equal(workerdAlive, true);

workerdAlive = true;
calls.length = 0;
const failures = await failureIsolatedCleanup(rejectingSteps);
assert.deepEqual(calls, ["proxy-client", "workerd-runtime", "loopback-server"]);
assert.equal(workerdAlive, false);
assert.deepEqual(
	failures.map((failure) => failure.component),
	["proxy-client"]
);

console.log(
	"PASS: an early rejection skips runtime termination under sequential cleanup"
);
console.log(
	"PASS: failure-isolated cleanup still terminates workerd and reports the failed component"
);
