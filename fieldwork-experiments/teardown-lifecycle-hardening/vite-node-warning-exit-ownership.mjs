import assert from "node:assert/strict";

function createSingleWarningExitSlot() {
	let callback = () => {};
	return {
		register(next) {
			callback = next;
		},
		runExit() {
			callback();
		},
	};
}

function createWarningExitRegistry() {
	const callbacks = new Set();
	return {
		register(callback) {
			callbacks.add(callback);
			return () => callbacks.delete(callback);
		},
		runExit() {
			for (const callback of callbacks) callback();
		},
	};
}

{
	const exit = createSingleWarningExitSlot();
	const rendered = [];
	const firstWarnings = ["first:node:fs"];
	const secondWarnings = ["second:node:path"];
	exit.register(() => rendered.push(...firstWarnings));
	exit.register(() => rendered.push(...secondWarnings));
	exit.runExit();
	assert.deepEqual(rendered, ["second:node:path"]);
}

{
	const exit = createWarningExitRegistry();
	const rendered = [];
	exit.register(() => rendered.push("first:node:fs"));
	exit.register(() => rendered.push("second:node:path"));
	exit.runExit();
	assert.deepEqual(rendered, ["first:node:fs", "second:node:path"]);
}

{
	const exit = createWarningExitRegistry();
	const rendered = [];
	const unregisterFirst = exit.register(() => rendered.push("first"));
	exit.register(() => rendered.push("second"));
	unregisterFirst();
	exit.runExit();
	assert.deepEqual(rendered, ["second"]);
}

console.log("PASS: one global exit slot loses earlier server node warnings");
console.log("PASS: a per-owner registry renders every live server warnings");
console.log("PASS: final close can unregister only the intended warning owner");