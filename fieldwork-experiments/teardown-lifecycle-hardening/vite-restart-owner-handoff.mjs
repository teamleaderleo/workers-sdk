import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";

function createOwnerHandoffModel() {
	const handoff = new AsyncLocalStorage();
	const owners = new Set();
	let nextOwnerId = 1;

	function createOwner() {
		const owner = {
			id: nextOwnerId++,
			runtime: { disposed: false },
			restartCount: 0,
			generations: 0,
		};
		owners.add(owner);
		return owner;
	}

	function createPlugin() {
		const owner = handoff.getStore() ?? createOwner();
		owner.generations++;
		const generation = owner.generations;
		const events = [];

		return {
			owner,
			generation,
			events,
			close() {
				if (owner.restartCount > 0) {
					events.push("skip-close-for-owner-restart");
					return;
				}
				owner.runtime.disposed = true;
				events.push("dispose-owner-runtime");
			},
			async restart(createReplacement) {
				owner.restartCount++;
				try {
					return await handoff.run(owner, async () => {
						const replacement = await createReplacement();
						this.close();
						return replacement;
					});
				} finally {
					owner.restartCount--;
				}
			},
		};
	}

	return {
		createPlugin,
		get ownerCount() {
			return owners.size;
		},
	};
}

{
	const model = createOwnerHandoffModel();
	const first = model.createPlugin();
	const second = model.createPlugin();
	assert.notEqual(first.owner, second.owner);
	assert.equal(model.ownerCount, 2);
}

{
	const model = createOwnerHandoffModel();
	const oldGeneration = model.createPlugin();
	const replacement = await oldGeneration.restart(async () =>
		model.createPlugin()
	);
	assert.equal(replacement.owner, oldGeneration.owner);
	assert.equal(replacement.generation, 2);
	assert.deepEqual(oldGeneration.events, ["skip-close-for-owner-restart"]);
	assert.equal(replacement.owner.runtime.disposed, false);
}

{
	const model = createOwnerHandoffModel();
	const restarting = model.createPlugin();
	const unrelated = model.createPlugin();
	let releaseReplacement;
	const replacementGate = new Promise((resolve) => {
		releaseReplacement = resolve;
	});

	const restartPromise = restarting.restart(async () => {
		await replacementGate;
		return model.createPlugin();
	});

	unrelated.close();
	assert.deepEqual(unrelated.events, ["dispose-owner-runtime"]);
	releaseReplacement();
	const replacement = await restartPromise;
	assert.equal(replacement.owner, restarting.owner);
}

{
	const model = createOwnerHandoffModel();
	const first = model.createPlugin();
	const second = model.createPlugin();
	const [firstReplacement, secondReplacement] = await Promise.all([
		first.restart(async () => {
			await Promise.resolve();
			return model.createPlugin();
		}),
		second.restart(async () => {
			await Promise.resolve();
			return model.createPlugin();
		}),
	]);
	assert.equal(firstReplacement.owner, first.owner);
	assert.equal(secondReplacement.owner, second.owner);
	assert.notEqual(firstReplacement.owner, secondReplacement.owner);
}

{
	const model = createOwnerHandoffModel();
	const original = model.createPlugin();
	const originalError = new Error("replacement construction failed");
	let observed;
	try {
		await original.restart(async () => {
			throw originalError;
		});
	} catch (error) {
		observed = error;
	}
	assert.equal(observed, originalError);
	assert.equal(original.owner.restartCount, 0);
	assert.equal(original.owner.runtime.disposed, false);
	assert.equal(model.ownerCount, 1);
}

console.log(
	"PASS: independent first-generation servers receive distinct owners"
);
console.log(
	"PASS: replacement plugins inherit only the restarting server owner"
);
console.log(
	"PASS: unrelated final close proceeds during another server restart"
);
console.log("PASS: concurrent restarts keep owner handoffs isolated");
console.log(
	"PASS: failed replacement construction preserves the original server owner and error"
);