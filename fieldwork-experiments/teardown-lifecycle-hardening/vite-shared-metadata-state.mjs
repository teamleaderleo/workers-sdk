import assert from "node:assert/strict";

function compareExportTypes(oldTypes, newTypes) {
	const oldKeys = Object.keys(oldTypes);
	const newKeys = Object.keys(newTypes);
	if (oldKeys.length !== newKeys.length) return true;
	return newKeys.some(
		(key) => !(key in oldTypes) || oldTypes[key] !== newTypes[key]
	);
}

function createGlobalMetadataModel() {
	const shared = {
		exportMap: undefined,
		hasShownWarnings: false,
	};
	return {
		createServer(name, initialExports, warning) {
			return {
				name,
				warning,
				setExportMap(map) {
					shared.exportMap = map;
				},
				onExportUpdate(workerName, newTypes) {
					const oldTypes = shared.exportMap?.get(workerName);
					assert(oldTypes, `missing export types for ${workerName}`);
					return compareExportTypes(oldTypes, newTypes);
				},
				showWarnings() {
					if (shared.hasShownWarnings) return [];
					shared.hasShownWarnings = true;
					return [warning];
				},
				buildStart() {
					shared.hasShownWarnings = false;
				},
				initialMap: new Map([[name, initialExports]]),
			};
		},
	};
}

function createOwnerMetadataRegistry() {
	const owners = new Map();
	return {
		createServer(ownerId, name, initialExports, warning) {
			const state = {
				exportMap: new Map([[name, initialExports]]),
				hasShownWarnings: false,
			};
			owners.set(ownerId, state);
			return {
				setExportMap(map) {
					state.exportMap = map;
				},
				onExportUpdate(workerName, newTypes) {
					const oldTypes = state.exportMap.get(workerName);
					assert(oldTypes, `missing export types for ${workerName}`);
					return compareExportTypes(oldTypes, newTypes);
				},
				showWarnings() {
					if (state.hasShownWarnings) return [];
					state.hasShownWarnings = true;
					return [warning];
				},
				buildStart() {
					state.hasShownWarnings = false;
				},
			};
		},
	};
}

{
	const model = createGlobalMetadataModel();
	const first = model.createServer(
		"worker-a",
		{ Api: "WorkerEntrypoint" },
		"warning-a"
	);
	const second = model.createServer(
		"worker-b",
		{ State: "DurableObject" },
		"warning-b"
	);
	first.setExportMap(first.initialMap);
	second.setExportMap(second.initialMap);
	assert.throws(
		() => first.onExportUpdate("worker-a", { Api: "WorkerEntrypoint" }),
		/missing export types for worker-a/
	);
}

{
	const model = createGlobalMetadataModel();
	const first = model.createServer(
		"shared-name",
		{ Api: "WorkerEntrypoint" },
		"warning-a"
	);
	const second = model.createServer(
		"shared-name",
		{ Api: "DurableObject" },
		"warning-b"
	);
	first.setExportMap(first.initialMap);
	second.setExportMap(second.initialMap);
	assert.equal(
		first.onExportUpdate("shared-name", { Api: "WorkerEntrypoint" }),
		true,
		"server A sees a false export change because server B replaced the old map"
	);
}

{
	const model = createGlobalMetadataModel();
	const first = model.createServer("worker-a", {}, "warning-a");
	const second = model.createServer("worker-b", {}, "warning-b");
	assert.deepEqual(first.showWarnings(), ["warning-a"]);
	assert.deepEqual(second.showWarnings(), []);
	first.buildStart();
	assert.deepEqual(second.showWarnings(), ["warning-b"]);
}

{
	const registry = createOwnerMetadataRegistry();
	const first = registry.createServer(
		"owner-a",
		"worker-a",
		{ Api: "WorkerEntrypoint" },
		"warning-a"
	);
	const second = registry.createServer(
		"owner-b",
		"worker-b",
		{ State: "DurableObject" },
		"warning-b"
	);
	assert.equal(
		first.onExportUpdate("worker-a", { Api: "WorkerEntrypoint" }),
		false
	);
	assert.equal(
		second.onExportUpdate("worker-b", { State: "DurableObject" }),
		false
	);
	assert.deepEqual(first.showWarnings(), ["warning-a"]);
	assert.deepEqual(second.showWarnings(), ["warning-b"]);
	first.buildStart();
	assert.deepEqual(first.showWarnings(), ["warning-a"]);
	assert.deepEqual(second.showWarnings(), []);
}

console.log("PASS: a global export map can remove another server worker entry");
console.log("PASS: same-name workers can cause false export-change restarts");
console.log("PASS: a global warning latch suppresses and re-enables another server warnings");
console.log("PASS: owner-scoped metadata isolates export and warning state");