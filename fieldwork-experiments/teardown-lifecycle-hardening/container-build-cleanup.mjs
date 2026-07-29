import assert from "node:assert/strict";

function createTrackedCleanup({ imageTags, cleanupContainers, warn }) {
	return () => {
		if (imageTags.size === 0) return true;
		const cleaned = cleanupContainers(imageTags);
		if (cleaned) {
			imageTags.clear();
		} else {
			warn();
		}
		return cleaned;
	};
}

async function prepareWithCleanupOwnership({ prepare, cleanup }) {
	try {
		await prepare();
	} catch (error) {
		cleanup();
		throw error;
	}
}

{
	const imageTags = new Set(["cloudflare-dev:first", "cloudflare-dev:second"]);
	const cleanupCalls = [];
	const warnings = [];
	const cleanup = createTrackedCleanup({
		imageTags,
		cleanupContainers(tags) {
			cleanupCalls.push([...tags]);
			return true;
		},
		warn() {
			warnings.push("cleanup failed");
		},
	});
	const buildError = new Error("second image failed");
	let observedError;
	try {
		await prepareWithCleanupOwnership({
			async prepare() {
				// The first image may already exist when a later build or validation fails.
				throw buildError;
			},
			cleanup,
		});
	} catch (error) {
		observedError = error;
	}
	assert.equal(observedError, buildError);
	assert.deepEqual(cleanupCalls, [["cloudflare-dev:first", "cloudflare-dev:second"]]);
	assert.deepEqual(warnings, []);
	assert.equal(imageTags.size, 0);
	assert.equal(cleanup(), true);
	assert.equal(cleanupCalls.length, 1);
}

{
	const imageTags = new Set(["cloudflare-dev:first"]);
	let attempts = 0;
	let warnings = 0;
	const cleanup = createTrackedCleanup({
		imageTags,
		cleanupContainers() {
			attempts += 1;
			return attempts > 1;
		},
		warn() {
			warnings += 1;
		},
	});
	assert.equal(cleanup(), false);
	assert.equal(imageTags.size, 1, "retain ownership for exit/close retry");
	assert.equal(warnings, 1);
	assert.equal(cleanup(), true);
	assert.equal(imageTags.size, 0);
	assert.equal(attempts, 2);
}

console.log("PASS: partial image-preparation failure triggers tracked cleanup");
console.log("PASS: cleanup preserves the original preparation error");
console.log("PASS: successful cleanup clears tags and becomes idempotent");
console.log("PASS: failed cleanup retains tags for a later retry and warns");
