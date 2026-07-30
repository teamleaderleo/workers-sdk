import assert from "node:assert/strict";

function createGlobalLoggerPackage() {
	let logger;
	return {
		startSession(ownerLogger) {
			logger = ownerLogger;
			return {
				emitError(message) {
					logger.push(`error:${message}`);
				},
				teardown() {
					logger.push("teardown");
				},
			};
		},
	};
}

function createCapturedLoggerPackage() {
	return {
		startSession(ownerLogger) {
			return {
				emitError(message) {
					ownerLogger.push(`error:${message}`);
				},
				teardown() {
					ownerLogger.push("teardown");
				},
			};
		},
	};
}

{
	const pkg = createGlobalLoggerPackage();
	const firstLogs = [];
	const secondLogs = [];
	const first = pkg.startSession(firstLogs);
	const second = pkg.startSession(secondLogs);
	first.emitError("first-session-failed");
	first.teardown();
	second.emitError("second-session-failed");
	assert.deepEqual(firstLogs, []);
	assert.deepEqual(secondLogs, [
		"error:first-session-failed",
		"teardown",
		"error:second-session-failed",
	]);
}

{
	const pkg = createCapturedLoggerPackage();
	const firstLogs = [];
	const secondLogs = [];
	const first = pkg.startSession(firstLogs);
	const second = pkg.startSession(secondLogs);
	first.emitError("first-session-failed");
	first.teardown();
	second.emitError("second-session-failed");
	assert.deepEqual(firstLogs, ["error:first-session-failed", "teardown"]);
	assert.deepEqual(secondLogs, ["error:second-session-failed"]);
}

console.log("PASS: a global live logger routes session A diagnostics to session B");
console.log("PASS: session-captured loggers preserve concurrent diagnostic ownership");