import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";

const BUILD_MARKER = "CLOUDFLARE_VITE_BUILD";

function selectPreviewWorker({ hasPrerenderWorker }) {
	return process.env[BUILD_MARKER]
		? hasPrerenderWorker
			? "prerender"
			: "entry"
		: "entry";
}

async function runWithStickyBuildMarker(operation) {
	process.env[BUILD_MARKER] = "true";
	return operation();
}

const buildScope = new AsyncLocalStorage();

function isScopedBuild() {
	return buildScope.getStore() === true;
}

function selectScopedPreviewWorker({ hasPrerenderWorker }) {
	return isScopedBuild() && hasPrerenderWorker ? "prerender" : "entry";
}

function runInBuildScope(operation) {
	return buildScope.run(true, operation);
}

{
	delete process.env[BUILD_MARKER];
	await runWithStickyBuildMarker(async () => {
		assert.equal(selectPreviewWorker({ hasPrerenderWorker: true }), "prerender");
	});
	assert.equal(
		selectPreviewWorker({ hasPrerenderWorker: true }),
		"prerender",
		"a successful build leaves the process marker set for a later independent preview"
	);
}

{
	delete process.env[BUILD_MARKER];
	const originalError = new Error("build failed");
	let observed;
	try {
		await runWithStickyBuildMarker(async () => {
			throw originalError;
		});
	} catch (error) {
		observed = error;
	}
	assert.equal(observed, originalError);
	assert.equal(process.env[BUILD_MARKER], "true");
}

{
	delete process.env[BUILD_MARKER];
	let releaseBuild;
	const gate = new Promise((resolve) => {
		releaseBuild = resolve;
	});
	const build = runWithStickyBuildMarker(async () => {
		await gate;
	});
	assert.equal(
		selectPreviewWorker({ hasPrerenderWorker: true }),
		"prerender",
		"an unrelated concurrent preview observes the process-wide build marker"
	);
	releaseBuild();
	await build;
}

{
	const selections = [];
	await runInBuildScope(async () => {
		await Promise.resolve();
		selections.push(selectScopedPreviewWorker({ hasPrerenderWorker: true }));
	});
	selections.push(selectScopedPreviewWorker({ hasPrerenderWorker: true }));
	assert.deepEqual(selections, ["prerender", "entry"]);
}

{
	let releaseBuild;
	const gate = new Promise((resolve) => {
		releaseBuild = resolve;
	});
	const build = runInBuildScope(async () => {
		await gate;
		return selectScopedPreviewWorker({ hasPrerenderWorker: true });
	});
	assert.equal(
		selectScopedPreviewWorker({ hasPrerenderWorker: true }),
		"entry",
		"an unrelated concurrent preview must remain outside the build scope"
	);
	releaseBuild();
	assert.equal(await build, "prerender");
}

{
	const originalError = new Error("scoped build failed");
	let observed;
	try {
		await runInBuildScope(async () => {
			assert.equal(
				selectScopedPreviewWorker({ hasPrerenderWorker: true }),
				"prerender"
			);
			throw originalError;
		});
	} catch (error) {
		observed = error;
	}
	assert.equal(observed, originalError);
	assert.equal(selectScopedPreviewWorker({ hasPrerenderWorker: true }), "entry");
}

console.log("PASS: a successful build leaves the process-wide marker sticky");
console.log("PASS: a failed build also leaves the process-wide marker sticky");
console.log("PASS: a concurrent unrelated preview observes the sticky marker");
console.log("PASS: scoped build preview selects prerender only inside the build");
console.log("PASS: concurrent unrelated preview stays outside scoped build state");
console.log("PASS: scoped build failure preserves the error and clears the scope");