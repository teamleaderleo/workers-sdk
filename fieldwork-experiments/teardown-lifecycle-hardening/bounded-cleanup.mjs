import assert from "node:assert/strict";

async function runBoundedStep(name, run, timeoutMs) {
	let timeout;
	try {
		const value = await Promise.race([
			Promise.resolve().then(run),
			new Promise((_, reject) => {
				timeout = setTimeout(() => {
					reject(new Error(`cleanup deadline exceeded: ${name}`));
				}, timeoutMs);
			}),
		]);
		return { name, status: "fulfilled", value };
	} catch (error) {
		return {
			name,
			status: String(error).includes("cleanup deadline exceeded")
				? "timed-out"
				: "rejected",
			error,
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function boundedCleanup({ beforeRuntime, terminateRuntime, afterRuntime }) {
	const results = [];
	for (const step of beforeRuntime) {
		results.push(await runBoundedStep(step.name, step.run, step.timeoutMs));
	}

	// Runtime ownership is discharged even when an earlier component rejected or
	// exceeded its deadline.
	results.push(
		await runBoundedStep(
			"workerd-runtime",
			terminateRuntime,
			/* timeoutMs */ 100
		)
	);

	for (const step of afterRuntime) {
		results.push(await runBoundedStep(step.name, step.run, step.timeoutMs));
	}
	return results;
}

{
	let killed = false;
	const results = await boundedCleanup({
		beforeRuntime: [
			{
				name: "proxy-client",
				timeoutMs: 20,
				run: async () => {
					throw new Error("proxy termination rejected");
				},
			},
		],
		terminateRuntime: async () => {
			killed = true;
		},
		afterRuntime: [],
	});
	assert.equal(killed, true);
	assert.deepEqual(
		results.map(({ name, status }) => ({ name, status })),
		[
			{ name: "proxy-client", status: "rejected" },
			{ name: "workerd-runtime", status: "fulfilled" },
		]
	);
}

{
	let killed = false;
	const neverSettles = new Promise(() => {});
	const results = await boundedCleanup({
		beforeRuntime: [
			{
				name: "proxy-client",
				timeoutMs: 20,
				run: () => neverSettles,
			},
		],
		terminateRuntime: async () => {
			killed = true;
		},
		afterRuntime: [],
	});
	assert.equal(killed, true);
	assert.deepEqual(
		results.map(({ name, status }) => ({ name, status })),
		[
			{ name: "proxy-client", status: "timed-out" },
			{ name: "workerd-runtime", status: "fulfilled" },
		]
	);
}

{
	let killed = false;
	const results = await boundedCleanup({
		beforeRuntime: [],
		terminateRuntime: async () => {
			killed = true;
		},
		afterRuntime: [
			{
				name: "dev-registry",
				timeoutMs: 20,
				run: async () => {
					throw new Error("registry close rejected");
				},
			},
		],
	});
	assert.equal(killed, true);
	assert.deepEqual(
		results.map(({ name, status }) => ({ name, status })),
		[
			{ name: "workerd-runtime", status: "fulfilled" },
			{ name: "dev-registry", status: "rejected" },
		]
	);
}

console.log("PASS: an early rejection cannot skip bounded runtime termination");
console.log("PASS: an unresolved pre-runtime cleanup times out before runtime termination");
console.log("PASS: post-runtime failures remain secondary to an already completed kill phase");
