import assert from "node:assert/strict";

// Generated-request execution gate derived from
// packages/containers-shared/src/client/core/request.ts at
// e92165ac96cd0648a2c824920e7605128a82afb4.
// It preserves the generated helper's URL, auth-precedence, logging, and fetch
// dispatch boundaries while replacing network I/O with a deterministic mock.

const isDefined = (value) => value !== undefined && value !== null;
const resolve = async (options, resolver) =>
	typeof resolver === "function" ? resolver(options) : resolver;

const getUrl = (config, options) => {
	const encoder = config.ENCODE_PATH || encodeURI;
	const path = options.url
		.replace("{api-version}", config.VERSION)
		.replace(/{(.*?)}/g, (substring, group) =>
			Object.prototype.hasOwnProperty.call(options.path ?? {}, group)
				? encoder(String(options.path[group]))
				: substring
		);
	return `${config.BASE}${path}`;
};

const getHeaders = async (config, options) => {
	const token = await resolve(options, config.TOKEN);
	const username = await resolve(options, config.USERNAME);
	const password = await resolve(options, config.PASSWORD);
	const additionalHeaders = await resolve(options, config.HEADERS);
	const headers = Object.entries({
		Accept: "application/json",
		...additionalHeaders,
		...options.headers,
	})
		.filter(([, value]) => isDefined(value))
		.reduce((result, [key, value]) => {
			result[key] = String(value);
			return result;
		}, {});
	if (typeof token === "string" && token.length > 0) {
		headers.Authorization = `Bearer ${token}`;
	}
	if (
		typeof username === "string" &&
		username.length > 0 &&
		typeof password === "string" &&
		password.length > 0
	) {
		headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
	}
	if (options.body) headers["Content-Type"] = options.mediaType ?? "application/json";
	return new Headers(headers);
};

const debugLogRequest = async (config, url, headers, body) => {
	config.LOGGER?.debug(`-- START CF API REQUEST: ${url}`);
	const logHeaders = new Headers(headers);
	logHeaders.delete("Authorization");
	config.LOGGER?.debugWithSanitization(
		"HEADERS:",
		JSON.stringify(Object.fromEntries(logHeaders.entries()), null, 2)
	);
	config.LOGGER?.debugWithSanitization("BODY:", JSON.stringify(body, null, 2));
	config.LOGGER?.debug("-- END CF API REQUEST");
};

const request = async (config, options) => {
	const url = getUrl(config, options);
	const headers = await getHeaders(config, options);
	const body = options.body === undefined ? undefined : JSON.stringify(options.body);
	await debugLogRequest(config, url, headers, options.body ?? {});
	const response = await fetch(url, {
		headers,
		body,
		method: options.method,
		signal: new AbortController().signal,
	});
	const payload = await response.json();
	if (!response.ok || payload.success === false) {
		const error = new Error(payload.errors?.[0]?.message ?? "registry request failed");
		error.url = url;
		error.status = response.status;
		error.request = options;
		throw error;
	}
	return payload.result ?? {};
};

const createLogger = (owner) => {
	const entries = [];
	return {
		owner,
		entries,
		debug(...args) {
			entries.push({ method: "debug", args });
		},
		debugWithSanitization(...args) {
			entries.push({ method: "debugWithSanitization", args });
		},
	};
};

const createRegistryCredentialsClient = ({ accountId, apiToken, logger, apiBase }) => {
	const config = {
		BASE: `${apiBase ?? "https://api.cloudflare.com/client/v4"}/accounts/${accountId}/containers`,
		VERSION: "1.0.0",
		WITH_CREDENTIALS: false,
		CREDENTIALS: "omit",
		TOKEN: undefined,
		USERNAME: undefined,
		PASSWORD: undefined,
		HEADERS: { Authorization: `Bearer ${apiToken}` },
		ENCODE_PATH: encodeURI,
		LOGGER: logger,
	};
	return {
		generateImageRegistryCredentials(domain, requestBody) {
			return request(config, {
				method: "POST",
				url: "/registries/{domain}/credentials",
				path: { domain },
				body: requestBody,
				mediaType: "application/json",
			});
		},
	};
};

const pullImage = async ({ domain, cloudflareDomain, client, publicPull }) => {
	const external = domain !== cloudflareDomain;
	if (!client) {
		if (!external) {
			throw new Error("Cloudflare-managed images require operation-scoped registry credentials.");
		}
		return publicPull();
	}
	try {
		await client.generateImageRegistryCredentials(domain, {
			permissions: ["pull"],
		});
	} catch (error) {
		if (!external) throw error;
	}
	return publicPull();
};

const captured = [];
const releases = new Map();
globalThis.fetch = async (url, init) => {
	const authorization = new Headers(init.headers).get("Authorization");
	const parts = new URL(url).pathname.split("/");
	const account = parts[parts.indexOf("accounts") + 1];
	captured.push({ url, authorization, method: init.method, account });
	if (releases.has(account)) await releases.get(account);
	return new Response(
		JSON.stringify({ success: true, result: { username: account, password: "generated" } }),
		{ status: 200, headers: { "Content-Type": "application/json" } }
	);
};

const globalLogger = createLogger("global");
const contaminatedGlobal = {
	BASE: "https://global.invalid/accounts/global/containers",
	VERSION: "1.0.0",
	WITH_CREDENTIALS: true,
	CREDENTIALS: "include",
	TOKEN: "global-token-secret",
	USERNAME: "global-user-secret",
	PASSWORD: "global-password-secret",
	HEADERS: {
		Authorization: "Bearer global-header-secret",
		"X-Global-Leak": "present",
	},
	ENCODE_PATH: (value) => `global-${value}`,
	LOGGER: globalLogger,
};

const loggerA = createLogger("A");
const loggerB = createLogger("B");
const clientA = createRegistryCredentialsClient({
	accountId: "account-a",
	apiToken: "operation-token-a-secret",
	logger: loggerA,
	apiBase: "https://operation.example/client/v4",
});
const clientB = createRegistryCredentialsClient({
	accountId: "account-b",
	apiToken: "operation-token-b-secret",
	logger: loggerB,
	apiBase: "https://operation.example/client/v4",
});

let releaseA;
releases.set("account-a", new Promise((resolve) => (releaseA = resolve)));
const pendingA = clientA.generateImageRegistryCredentials("registry/a path", {
	permissions: ["pull"],
});
Object.assign(contaminatedGlobal, {
	TOKEN: "later-global-token-secret",
	LOGGER: createLogger("later-global"),
});
const pendingB = clientB.generateImageRegistryCredentials("registry-b.example", {
	permissions: ["pull"],
});
releaseA();
await Promise.all([pendingA, pendingB]);

assert.equal(captured.length, 2);
const requestA = captured.find(({ account }) => account === "account-a");
const requestB = captured.find(({ account }) => account === "account-b");
assert.deepEqual(requestA, {
	url: "https://operation.example/client/v4/accounts/account-a/containers/registries/registry/a%20path/credentials",
	authorization: "Bearer operation-token-a-secret",
	method: "POST",
	account: "account-a",
});
assert.deepEqual(requestB, {
	url: "https://operation.example/client/v4/accounts/account-b/containers/registries/registry-b.example/credentials",
	authorization: "Bearer operation-token-b-secret",
	method: "POST",
	account: "account-b",
});
assert.equal(globalLogger.entries.length, 0);
assert.equal(loggerA.entries.length, 4);
assert.equal(loggerB.entries.length, 4);

const secretCorpus = JSON.stringify({
	logsA: loggerA.entries,
	logsB: loggerB.entries,
	snapshot: captured.map(({ url, method, account }) => ({ url, method, account })),
});
for (const secret of [
	"global-token-secret",
	"global-user-secret",
	"global-password-secret",
	"global-header-secret",
	"operation-token-a-secret",
	"operation-token-b-secret",
]) {
	assert.equal(secretCorpus.includes(secret), false, `secret leaked: ${secret}`);
}

let publicPulls = 0;
const beforeExternal = captured.length;
await pullImage({
	domain: "external.example",
	cloudflareDomain: "registry.cloudflare.example",
	client: undefined,
	publicPull: async () => {
		publicPulls += 1;
		return "public-pull";
	},
});
assert.equal(captured.length - beforeExternal, 0);
assert.equal(publicPulls, 1);

let managedPreparationStarted = false;
await assert.rejects(
	pullImage({
		domain: "registry.cloudflare.example",
		cloudflareDomain: "registry.cloudflare.example",
		client: undefined,
		publicPull: async () => {
			managedPreparationStarted = true;
		},
	}),
	/operation-scoped registry credentials/
);
assert.equal(managedPreparationStarted, false);

console.log("PASS: generated dispatch captured operation A endpoint and bearer token");
console.log("PASS: generated dispatch captured operation B endpoint and bearer token");
console.log("PASS: contaminated global auth, headers, encoder, credentials, and logger stayed isolated");
console.log("PASS: concurrent operation clients retained endpoint, token, and logger ownership");
console.log("PASS: operation logs and retained snapshots contain no bearer or global secrets");
console.log("PASS: custom API base and generated path encoding stayed operation-scoped");
console.log("PASS: external-only fallback made zero Cloudflare credential requests");
console.log("PASS: managed-image work without exact authority failed before preparation");
