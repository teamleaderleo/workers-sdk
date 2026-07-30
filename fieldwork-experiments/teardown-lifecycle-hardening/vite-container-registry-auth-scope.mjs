import assert from "node:assert/strict";

function createGlobalOpenApiModel() {
	const config = { base: "", token: undefined };
	return {
		configure(account, token) {
			config.base = `https://api.example/accounts/${account}/containers`;
			config.token = token;
		},
		requestCredentials(domain) {
			return {
				url: `${config.base}/registries/${domain}/credentials`,
				token: config.token,
			};
		},
	};
}

function createRegistryClient(account, token) {
	const config = {
		base: `https://api.example/accounts/${account}/containers`,
		token,
	};
	return {
		requestCredentials(domain) {
			return {
				url: `${config.base}/registries/${domain}/credentials`,
				token: config.token,
			};
		},
	};
}

{
	const api = createGlobalOpenApiModel();
	api.configure("account-a", "token-a");
	// A later external-only server skips configuration but still asks the shared
	// service for configured external-registry credentials.
	const laterRequest = api.requestCredentials("external.example");
	assert.deepEqual(laterRequest, {
		url: "https://api.example/accounts/account-a/containers/registries/external.example/credentials",
		token: "token-a",
	});
}

{
	const api = createGlobalOpenApiModel();
	api.configure("account-a", "token-a");
	let releaseFirst;
	const gate = new Promise((resolve) => {
		releaseFirst = resolve;
	});
	const first = (async () => {
		await gate;
		return api.requestCredentials("registry-a.example");
	})();
	api.configure("account-b", "token-b");
	releaseFirst();
	assert.deepEqual(await first, {
		url: "https://api.example/accounts/account-b/containers/registries/registry-a.example/credentials",
		token: "token-b",
	});
}

{
	const clientA = createRegistryClient("account-a", "token-a");
	const clientB = createRegistryClient("account-b", "token-b");
	const [requestA, requestB] = await Promise.all([
		Promise.resolve().then(() =>
			clientA.requestCredentials("registry-a.example")
		),
		Promise.resolve().then(() =>
			clientB.requestCredentials("registry-b.example")
		),
	]);
	assert.deepEqual(requestA, {
		url: "https://api.example/accounts/account-a/containers/registries/registry-a.example/credentials",
		token: "token-a",
	});
	assert.deepEqual(requestB, {
		url: "https://api.example/accounts/account-b/containers/registries/registry-b.example/credentials",
		token: "token-b",
	});
}

{
	const noClient = undefined;
	const request = noClient?.requestCredentials("external.example");
	assert.equal(request, undefined);
}

console.log("PASS: external-only later work inherits prior account and token");
console.log("PASS: concurrent configuration sends operation A through operation B identity");
console.log("PASS: per-operation clients isolate account, token, and endpoint");
console.log("PASS: absent per-operation credentials cannot fall back to stale global auth");