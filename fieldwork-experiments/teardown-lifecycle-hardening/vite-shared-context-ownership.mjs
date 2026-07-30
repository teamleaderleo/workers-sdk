import assert from "node:assert/strict";

function createGlobalSharedContextModel() {
	const shared = {
		runtime: undefined,
		restartCount: 0,
	};

	function createPlugin(name) {
		const events = [];
		return {
			name,
			events,
			startOrUpdateRuntime(options) {
				if (!shared.runtime) {
					shared.runtime = { options, disposed: false };
					events.push(`created:${options}`);
				} else {
					shared.runtime.options = options;
					events.push(`updated:${options}`);
				}
			},
			observedRuntimeOptions() {
				return shared.runtime?.options;
			},
			beginRestart() {
				shared.restartCount++;
			},
			endRestart() {
				shared.restartCount--;
			},
			finalClose() {
				if (shared.restartCount > 0) {
					events.push("skipped-final-close-as-restart");
					return;
				}
				if (shared.runtime) shared.runtime.disposed = true;
				events.push("disposed-runtime");
			},
		};
	}

	return { createPlugin, shared };
}

function createOwnerScopedRegistry() {
	const owners = new Map();

	function getOwner(ownerId) {
		let owner = owners.get(ownerId);
		if (!owner) {
			owner = { runtime: undefined, restartCount: 0 };
			owners.set(ownerId, owner);
		}
		return owner;
	}

	function createPlugin(ownerId, generation) {
		const owner = getOwner(ownerId);
		const events = [];
		return {
			ownerId,
			generation,
			events,
			startOrUpdateRuntime(options) {
				if (!owner.runtime) {
					owner.runtime = { options, disposed: false };
					events.push(`created:${options}`);
				} else {
					owner.runtime.options = options;
					events.push(`updated:${options}`);
				}
			},
			observedRuntimeOptions() {
				return owner.runtime?.options;
			},
			beginRestart() {
				owner.restartCount++;
			},
			endRestart() {
				owner.restartCount--;
			},
			finalClose() {
				if (owner.restartCount > 0) {
					events.push("skipped-final-close-as-restart");
					return;
				}
				if (owner.runtime) owner.runtime.disposed = true;
				events.push("disposed-runtime");
			},
			runtimeDisposed() {
				return owner.runtime?.disposed ?? false;
			},
		};
	}

	return { createPlugin };
}

{
	const model = createGlobalSharedContextModel();
	const first = model.createPlugin("first");
	const second = model.createPlugin("second");
	first.startOrUpdateRuntime("first-config");
	second.startOrUpdateRuntime("second-config");
	assert.equal(
		first.observedRuntimeOptions(),
		"second-config",
		"the second plugin mutates the runtime observed by the first plugin"
	);
}

{
	const model = createGlobalSharedContextModel();
	const restarting = model.createPlugin("restarting");
	const closing = model.createPlugin("closing");
	restarting.startOrUpdateRuntime("shared-config");
	restarting.beginRestart();
	closing.finalClose();
	restarting.endRestart();
	assert.deepEqual(closing.events, ["skipped-final-close-as-restart"]);
	assert.equal(model.shared.runtime.disposed, false);
}

{
	const registry = createOwnerScopedRegistry();
	const first = registry.createPlugin("server-a", 1);
	const second = registry.createPlugin("server-b", 1);
	first.startOrUpdateRuntime("first-config");
	second.startOrUpdateRuntime("second-config");
	assert.equal(first.observedRuntimeOptions(), "first-config");
	assert.equal(second.observedRuntimeOptions(), "second-config");
}

{
	const registry = createOwnerScopedRegistry();
	const restarting = registry.createPlugin("server-a", 1);
	const closing = registry.createPlugin("server-b", 1);
	restarting.startOrUpdateRuntime("first-config");
	closing.startOrUpdateRuntime("second-config");
	restarting.beginRestart();
	closing.finalClose();
	restarting.endRestart();
	assert.deepEqual(closing.events.slice(-1), ["disposed-runtime"]);
	assert.equal(closing.runtimeDisposed(), true);
	assert.equal(restarting.runtimeDisposed(), false);
}

{
	const registry = createOwnerScopedRegistry();
	const oldGeneration = registry.createPlugin("server-a", 1);
	oldGeneration.startOrUpdateRuntime("before-restart");
	oldGeneration.beginRestart();
	oldGeneration.finalClose();
	const newGeneration = registry.createPlugin("server-a", 2);
	newGeneration.startOrUpdateRuntime("after-restart");
	oldGeneration.endRestart();
	assert.equal(newGeneration.observedRuntimeOptions(), "after-restart");
	assert.equal(newGeneration.runtimeDisposed(), false);
}

console.log(
	"PASS: a global runtime lets one plugin overwrite another plugin runtime"
);
console.log(
	"PASS: a global restart counter can suppress an unrelated final close"
);
console.log("PASS: owner-scoped runtimes isolate concurrent servers");
console.log(
	"PASS: owner-scoped restart state does not suppress another owner cleanup"
);
console.log(
	"PASS: sequential generations of one logical server retain restart continuity"
);