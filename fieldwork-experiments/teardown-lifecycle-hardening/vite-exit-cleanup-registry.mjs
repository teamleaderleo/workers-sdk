import assert from "node:assert/strict";

function createSingleSlotExitHandler() {
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

function createExitRegistry() {
	const callbacks = new Set();
	return {
		register(callback) {
			callbacks.add(callback);
		},
		unregister(callback) {
			callbacks.delete(callback);
		},
		runExit() {
			for (const callback of callbacks) callback();
		},
		get size() {
			return callbacks.size;
		},
	};
}

function createContainerOwner({ name, registry, cleanupResults = [true] }) {
	const tags = new Set();
	const cleanedTags = [];
	const warnings = [];
	let cleanupIndex = 0;

	const cleanup = () => {
		if (!tags.size) return true;
		const cleaned =
			cleanupResults[Math.min(cleanupIndex++, cleanupResults.length - 1)];
		if (cleaned) {
			cleanedTags.push(...tags);
			tags.clear();
		} else {
			warnings.push(`${name}: cleanup failed`);
		}
		return cleaned;
	};

	const cleanupAndMaybeUnregister = () => {
		const cleaned = cleanup();
		if (cleaned) registry.unregister(cleanup);
		return cleaned;
	};

	return {
		name,
		tags,
		cleanedTags,
		warnings,
		async prepare(candidateTags, operation) {
			for (const tag of candidateTags) tags.add(tag);
			registry.register(cleanup);
			try {
				await operation();
			} catch (error) {
				cleanupAndMaybeUnregister();
				throw error;
			}
		},
		close() {
			cleanupAndMaybeUnregister();
		},
	};
}

{
	const exit = createSingleSlotExitHandler();
	const cleaned = [];
	exit.register(() => cleaned.push("first"));
	exit.register(() => cleaned.push("second"));
	exit.runExit();
	assert.deepEqual(cleaned, ["second"]);
}

{
	const registry = createExitRegistry();
	const first = createContainerOwner({ name: "first", registry });
	const second = createContainerOwner({ name: "second", registry });
	await first.prepare(["first:tag"], async () => {});
	await second.prepare(["second:tag"], async () => {});
	registry.runExit();
	assert.deepEqual(first.cleanedTags, ["first:tag"]);
	assert.deepEqual(second.cleanedTags, ["second:tag"]);
}

{
	const registry = createExitRegistry();
	const owner = createContainerOwner({
		name: "retry-owner",
		registry,
		cleanupResults: [false, true],
	});
	await owner.prepare(["retry:tag"], async () => {});
	owner.close();
	assert.equal(registry.size, 1, "failed cleanup must retain exit ownership");
	assert.deepEqual(owner.warnings, ["retry-owner: cleanup failed"]);
	registry.runExit();
	assert.deepEqual(owner.cleanedTags, ["retry:tag"]);
}

{
	const registry = createExitRegistry();
	const owner = createContainerOwner({ name: "closed-owner", registry });
	await owner.prepare(["closed:tag"], async () => {});
	owner.close();
	assert.equal(registry.size, 0, "successful close must release registry ownership");
	registry.runExit();
	assert.deepEqual(owner.cleanedTags, ["closed:tag"]);
}

{
	const registry = createExitRegistry();
	const owner = createContainerOwner({ name: "prepare-owner", registry });
	const originalError = new Error("image preparation failed");
	let observedError;
	try {
		await owner.prepare(["prepared-before-failure:tag"], async () => {
			throw originalError;
		});
	} catch (error) {
		observedError = error;
	}
	assert.equal(observedError, originalError);
	assert.deepEqual(owner.cleanedTags, ["prepared-before-failure:tag"]);
	assert.equal(registry.size, 0);
}

console.log("PASS: a single exit slot loses earlier cleanup ownership");
console.log("PASS: a per-instance registry cleans every live server owner");
console.log("PASS: failed cleanup retains ownership for an exit retry");
console.log("PASS: successful close unregisters and avoids duplicate cleanup");
console.log("PASS: preparation failure preserves its original error");
