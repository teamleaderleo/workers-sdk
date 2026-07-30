import assert from "node:assert/strict";

class TunnelManagerModel {
	constructor(logger) {
		this.logger = logger;
		this.started = false;
	}
	start(name) {
		this.started = true;
		this.logger.push(`start:${name}`);
	}
	dispose() {
		if (this.started) this.logger.push("closed");
		this.started = false;
	}
}

function createGlobalManagerSlot() {
	let manager;
	return {
		configure(logger) {
			manager ??= new TunnelManagerModel(logger);
			return manager;
		},
		finalClose() {
			manager?.dispose();
		},
	};
}

function createOwnerManagerRegistry() {
	const managers = new Map();
	return {
		configure(owner, logger) {
			let manager = managers.get(owner);
			if (!manager) {
				manager = new TunnelManagerModel(logger);
				managers.set(owner, manager);
			}
			return manager;
		},
		finalClose(owner) {
			const manager = managers.get(owner);
			manager?.dispose();
			managers.delete(owner);
		},
		get size() {
			return managers.size;
		},
	};
}

{
	const global = createGlobalManagerSlot();
	const firstLogs = [];
	const secondLogs = [];
	const first = global.configure(firstLogs);
	first.start("first");
	global.finalClose();
	const second = global.configure(secondLogs);
	second.start("second");
	assert.equal(second, first, "the disposed module-global manager is reused");
	assert.deepEqual(firstLogs, ["start:first", "closed", "start:second"]);
	assert.deepEqual(secondLogs, []);
}

{
	const registry = createOwnerManagerRegistry();
	const firstLogs = [];
	const secondLogs = [];
	const first = registry.configure("server-a", firstLogs);
	const second = registry.configure("server-b", secondLogs);
	first.start("first");
	second.start("second");
	assert.notEqual(first, second);
	assert.deepEqual(firstLogs, ["start:first"]);
	assert.deepEqual(secondLogs, ["start:second"]);
	registry.finalClose("server-a");
	assert.equal(registry.size, 1);
	second.start("second-again");
	assert.deepEqual(secondLogs, ["start:second", "start:second-again"]);
}

{
	const registry = createOwnerManagerRegistry();
	const firstLogs = [];
	const secondLogs = [];
	const first = registry.configure("server-a", firstLogs);
	first.start("first");
	registry.finalClose("server-a");
	const second = registry.configure("server-b", secondLogs);
	second.start("second");
	assert.deepEqual(firstLogs, ["start:first", "closed"]);
	assert.deepEqual(secondLogs, ["start:second"]);
}

console.log("PASS: a disposed global tunnel manager is reused with the old logger");
console.log("PASS: owner-scoped tunnel managers keep concurrent loggers isolated");
console.log("PASS: final close removes only the intended tunnel owner");