import assert from "node:assert/strict";

function createSession({ identity, logger, connection }) {
	return {
		identity,
		logger,
		connection,
		disposed: false,
		bindings: { SERVICE: "remote" },
		updates: [],
		async updateBindings(bindings) {
			if (this.disposed) throw new Error("update on disposed session");
			this.bindings = bindings;
			this.updates.push(bindings);
		},
		async dispose() {
			this.disposed = true;
		},
	};
}

async function maybeReuseLikeCurrent({ existing, identity, bindings, logger, start }) {
	if (!existing) {
		const session = await start({ identity, bindings, logger });
		return { session, bindings, auth: undefined };
	}

	const bindingsSame = JSON.stringify(existing.bindings) === JSON.stringify(bindings);
	if (!bindingsSame) await existing.session.updateBindings(bindings);
	return {
		session: existing.session,
		bindings,
		auth: undefined,
	};
}

function createGlobalConfigPathCache() {
	const map = new Map();
	return {
		async acquire({ configPath, identity, bindings, logger, start }) {
			const existing = map.get(configPath);
			const data = await maybeReuseLikeCurrent({
				existing,
				identity,
				bindings,
				logger,
				start,
			});
			map.set(configPath, data);
			return data.session;
		},
		async closeWithoutSessionDisposal() {},
		async disposeButKeepCache(configPath) {
			await map.get(configPath)?.session.dispose();
		},
		get(configPath) {
			return map.get(configPath);
		},
	};
}

function createOwnerScopedRegistry() {
	const owners = new Map();
	return {
		async acquire({ owner, identity, bindings, logger, start }) {
			let data = owners.get(owner);
			const identityChanged =
				data && JSON.stringify(data.identity) !== JSON.stringify(identity);
			if (identityChanged) {
				await data.session.dispose();
				data = undefined;
			}
			if (!data) {
				const session = await start({ identity, bindings, logger });
				data = { session, identity, bindings };
				owners.set(owner, data);
				return session;
			}
			if (JSON.stringify(data.bindings) !== JSON.stringify(bindings)) {
				await data.session.updateBindings(bindings);
				data.bindings = bindings;
			}
			return data.session;
		},
		async finalClose(owner) {
			const data = owners.get(owner);
			await data?.session.dispose();
			owners.delete(owner);
		},
		get size() {
			return owners.size;
		},
	};
}

const starts = [];
const start = async ({ identity, bindings, logger }) => {
	const session = createSession({
		identity,
		logger,
		connection: `http://session-${starts.length + 1}.invalid`,
	});
	session.bindings = bindings;
	starts.push(session);
	return session;
};

{
	starts.length = 0;
	const cache = createGlobalConfigPathCache();
	const session = await cache.acquire({
		configPath: "/project/wrangler.jsonc",
		identity: { account: "account-a", profileDir: "/project" },
		bindings: { SERVICE: "remote" },
		logger: "logger-a",
		start,
	});
	await cache.closeWithoutSessionDisposal();
	assert.equal(session.disposed, false);
	assert.equal(cache.get("/project/wrangler.jsonc").session, session);
}

{
	starts.length = 0;
	const cache = createGlobalConfigPathCache();
	const first = await cache.acquire({
		configPath: "/project/wrangler.jsonc",
		identity: {
			worker: "worker-a",
			account: "account-a",
			compliance: "fedramp",
			profileDir: "/profile-a",
		},
		bindings: { SERVICE: "remote" },
		logger: "logger-a",
		start,
	});
	const second = await cache.acquire({
		configPath: "/project/wrangler.jsonc",
		identity: {
			worker: "worker-b",
			account: "account-b",
			compliance: "public",
			profileDir: "/profile-b",
		},
		bindings: { SERVICE: "remote" },
		logger: "logger-b",
		start,
	});
	assert.equal(second, first);
	assert.deepEqual(second.identity, {
		worker: "worker-a",
		account: "account-a",
		compliance: "fedramp",
		profileDir: "/profile-a",
	});
	assert.equal(second.logger, "logger-a");
	assert.equal(starts.length, 1);
}

{
	starts.length = 0;
	const cache = createGlobalConfigPathCache();
	const first = await cache.acquire({
		configPath: "/project/wrangler.jsonc",
		identity: { account: "account-a" },
		bindings: { SERVICE: "remote" },
		logger: "logger-a",
		start,
	});
	await cache.disposeButKeepCache("/project/wrangler.jsonc");
	const second = await cache.acquire({
		configPath: "/project/wrangler.jsonc",
		identity: { account: "account-a" },
		bindings: { SERVICE: "remote" },
		logger: "logger-b",
		start,
	});
	assert.equal(second, first);
	assert.equal(second.disposed, true);
	assert.equal(starts.length, 1);
}

{
	starts.length = 0;
	const registry = createOwnerScopedRegistry();
	const first = await registry.acquire({
		owner: "server-a",
		identity: { account: "account-a", profileDir: "/profile-a" },
		bindings: { SERVICE: "remote" },
		logger: "logger-a",
		start,
	});
	const second = await registry.acquire({
		owner: "server-b",
		identity: { account: "account-b", profileDir: "/profile-b" },
		bindings: { SERVICE: "remote" },
		logger: "logger-b",
		start,
	});
	assert.notEqual(first, second);
	assert.equal(first.logger, "logger-a");
	assert.equal(second.logger, "logger-b");
	await registry.finalClose("server-a");
	assert.equal(first.disposed, true);
	assert.equal(second.disposed, false);
	assert.equal(registry.size, 1);
}

{
	starts.length = 0;
	const registry = createOwnerScopedRegistry();
	const first = await registry.acquire({
		owner: "server-a",
		identity: { account: "account-a", profileDir: "/profile-a" },
		bindings: { SERVICE: "remote" },
		logger: "logger-a",
		start,
	});
	const replacement = await registry.acquire({
		owner: "server-a",
		identity: { account: "account-b", profileDir: "/profile-b" },
		bindings: { SERVICE: "remote" },
		logger: "logger-b",
		start,
	});
	assert.notEqual(first, replacement);
	assert.equal(first.disposed, true);
	assert.equal(replacement.logger, "logger-b");
}

console.log("PASS: Vite final close leaves a cached remote proxy session live");
console.log("PASS: same config path reuses stale account, profile, worker, and logger identity");
console.log("PASS: disposing without deleting the cache returns a disposed session later");
console.log("PASS: owner-scoped sessions isolate servers and dispose only on final close");
console.log("PASS: connection identity changes replace and dispose the old session");