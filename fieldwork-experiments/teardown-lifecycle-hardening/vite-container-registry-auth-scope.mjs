import assert from "node:assert/strict";

function createGlobalOpenApiModel() {
	const config = {
		base: "",
		token: undefined,
		username: undefined,
		password: undefined,
		headers: undefined,
		logger: undefined,
		encodePath: undefined,
	};
	return {
		config,
		configure(account, token) {
			config.base = `https://api.example/accounts/${account}/containers`;
			config.token = token;
		},
		requestCredentials(domain) {
			return dispatchRequest(config, domain);
		},
	};
}

function resolveAuthorization(config) {
	let authorization = config.headers?.Authorization;
	if (config.token) authorization = `Bearer ${config.token}`;
	if (config.username && config.password) {
		authorization = `Basic ${config.username}:${config.password}`;
	}
	return authorization;
}

function dispatchRequest(config, domain) {
	const url = `${config.base}/registries/${
		config.encodePath ? config.encodePath(domain) : domain
	}/credentials`;
	const authorization = resolveAuthorization(config);
	config.logger?.push({
		url,
		headers: { Authorization: "[redacted]" },
	});
	return { url, authorization };
}

function createClosedRegistryClient({ account, token, logger, apiBase }) {
	const config = {
		base: `${apiBase ?? "https://api.example"}/accounts/${account}/containers`,
		version: "1.0.0",
		withCredentials: false,
		credentials: "omit",
		token: undefined,
		username: undefined,
		password: undefined,
		headers: { Authorization: `Bearer ${token}` },
		encodePath: encodeURI,
		logger,
	};
	return {
		requestCredentials(domain) {
			return dispatchRequest(config, domain);
		},
	};
}

function requireRegistryClient(client) {
	if (!client) throw new Error("operation-scoped registry client required");
	return client;
}

{
	const api = createGlobalOpenApiModel();
	api.configure("account-a", "token-a");
	const laterRequest = api.requestCredentials("external.example");
	assert.deepEqual(laterRequest, {
		url: "https://api.example/accounts/account-a/containers/registries/external.example/credentials",
		authorization: "Bearer token-a",
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
		authorization: "Bearer token-b",
	});
}

{
	const globalLogs = [];
	const operationLogs = [];
	const contaminated = createGlobalOpenApiModel();
	Object.assign(contaminated.config, {
		base: "https://global.invalid",
		token: "global-token",
		username: "global-user",
		password: "global-password",
		headers: {
			Authorization: "Bearer global-header-token",
			"X-Global": "leak",
		},
		logger: globalLogs,
		encodePath: (path) => `global-${path}`,
	});

	const client = createClosedRegistryClient({
		account: "operation-account",
		token: "operation-token",
		logger: operationLogs,
		apiBase: "https://operation.example",
	});

	// Mutating the global singleton after client construction cannot alter the
	// immutable operation config captured by the client.
	Object.assign(contaminated.config, {
		token: "later-global-token",
		logger: [],
	});

	const request = client.requestCredentials("registry/path");
	assert.deepEqual(request, {
		url: "https://operation.example/accounts/operation-account/containers/registries/registry/path/credentials",
		authorization: "Bearer operation-token",
	});
	assert.deepEqual(globalLogs, []);
	assert.deepEqual(operationLogs, [
		{
			url: "https://operation.example/accounts/operation-account/containers/registries/registry/path/credentials",
			headers: { Authorization: "[redacted]" },
		},
	]);
	assert.equal(JSON.stringify(operationLogs).includes("operation-token"), false);
}

{
	const logsA = [];
	const logsB = [];
	const clientA = createClosedRegistryClient({
		account: "account-a",
		token: "token-a",
		logger: logsA,
	});
	const clientB = createClosedRegistryClient({
		account: "account-b",
		token: "token-b",
		logger: logsB,
	});
	const [requestA, requestB] = await Promise.all([
		Promise.resolve().then(() =>
			clientA.requestCredentials("registry-a.example")
		),
		Promise.resolve().then(() =>
			clientB.requestCredentials("registry-b.example")
		),
	]);
	assert.equal(requestA.authorization, "Bearer token-a");
	assert.equal(requestB.authorization, "Bearer token-b");
	assert.equal(logsA.length, 1);
	assert.equal(logsB.length, 1);
}

{
	assert.throws(() => requireRegistryClient(undefined), /required/);
}

{
	const noClient = undefined;
	const request = noClient?.requestCredentials("external.example");
	assert.equal(request, undefined);
}

console.log("PASS: external-only later work inherits prior account and token");
console.log("PASS: concurrent configuration sends operation A through operation B identity");
console.log("PASS: a closed client inherits no global token, Basic auth, headers, encoder, or logger");
console.log("PASS: later global mutation cannot affect an in-flight operation client");
console.log("PASS: concurrent operation clients isolate endpoint, token, and logger");
console.log("PASS: operation diagnostics redact Authorization");
console.log("PASS: Cloudflare credential lookup cannot silently fall back to a global service");
console.log("PASS: external-only no-client work performs no credential request");