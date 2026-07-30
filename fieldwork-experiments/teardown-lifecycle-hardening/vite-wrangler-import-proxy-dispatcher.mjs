import assert from "node:assert/strict";

function createGlobalDispatcherRuntime() {
	let dispatcher = { owner: "host", route: "direct" };
	return {
		getDispatcher() {
			return dispatcher;
		},
		setDispatcher(next) {
			dispatcher = next;
		},
		fetch(label) {
			return `${label}:${dispatcher.owner}:${dispatcher.route}`;
		},
	};
}

function importWranglerLikeCurrent(runtime, proxy) {
	if (proxy) {
		runtime.setDispatcher({ owner: "wrangler", route: proxy });
	}
	return { unstable_readConfig: () => ({}) };
}

function importWranglerSideEffectFree() {
	return { unstable_readConfig: () => ({}) };
}

function runWranglerCli(runtime, proxy, operation) {
	const previous = runtime.getDispatcher();
	runtime.setDispatcher({ owner: "wrangler-cli", route: proxy });
	try {
		return operation();
	} finally {
		runtime.setDispatcher(previous);
	}
}

function fetchWithOperationDispatcher(label, dispatcher) {
	return `${label}:${dispatcher.owner}:${dispatcher.route}`;
}

{
	const runtime = createGlobalDispatcherRuntime();
	const hostBefore = runtime.getDispatcher();
	importWranglerLikeCurrent(runtime, "http://proxy-a.invalid");
	assert.notEqual(runtime.getDispatcher(), hostBefore);
	assert.equal(
		runtime.fetch("host-request"),
		"host-request:wrangler:http://proxy-a.invalid"
	);
}

{
	const runtime = createGlobalDispatcherRuntime();
	const hostBefore = runtime.getDispatcher();
	importWranglerSideEffectFree();
	assert.equal(runtime.getDispatcher(), hostBefore);
	assert.equal(runtime.fetch("host-request"), "host-request:host:direct");
}

{
	const runtime = createGlobalDispatcherRuntime();
	const result = runWranglerCli(runtime, "http://proxy-a.invalid", () =>
		runtime.fetch("cli-request")
	);
	assert.equal(
		result,
		"cli-request:wrangler-cli:http://proxy-a.invalid"
	);
	assert.equal(runtime.fetch("host-after"), "host-after:host:direct");
}

{
	const host = { owner: "host", route: "direct" };
	const viteA = { owner: "vite-a", route: "http://proxy-a.invalid" };
	const viteB = { owner: "vite-b", route: "http://proxy-b.invalid" };
	const [hostRequest, requestA, requestB] = await Promise.all([
		Promise.resolve().then(() => fetchWithOperationDispatcher("host", host)),
		Promise.resolve().then(() => fetchWithOperationDispatcher("a", viteA)),
		Promise.resolve().then(() => fetchWithOperationDispatcher("b", viteB)),
	]);
	assert.equal(hostRequest, "host:host:direct");
	assert.equal(requestA, "a:vite-a:http://proxy-a.invalid");
	assert.equal(requestB, "b:vite-b:http://proxy-b.invalid");
}

console.log("PASS: importing Wrangler can replace the host global dispatcher");
console.log("PASS: a side-effect-free library import preserves host routing");
console.log("PASS: CLI-owned dispatcher setup can restore the prior host dispatcher");
console.log("PASS: operation dispatchers isolate concurrent host and Vite routes");