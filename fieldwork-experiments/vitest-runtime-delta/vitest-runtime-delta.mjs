import assert from "node:assert/strict";

function effectiveVitestRuntime(user = {}) {
	const flags = new Set(user.compatibilityFlags ?? []);
	flags.add("no_handle_cross_request_promise_resolution");
	flags.delete("no_nodejs_compat_v2");
	flags.add("nodejs_compat_v2");
	flags.add("unsafe_module");
	for (const feature of [
		"nodejs_tty_module",
		"nodejs_fs_module",
		"nodejs_http_modules",
		"nodejs_perf_hooks_module",
		"nodejs_v8_module",
		"nodejs_process_v2",
	]) {
		flags.delete(`disable_${feature}`);
		flags.add(`enable_${feature}`);
	}
	return {
		compatibilityDate: user.compatibilityDate ?? "<today at test time>",
		compatibilityFlags: [...flags].sort(),
		unsafeEvalBinding: "__VITEST_POOL_WORKERS_UNSAFE_EVAL",
		moduleFallback: true,
		injectedModules: ["node:console", "node:vm"],
		runnerDurableObject: "ephemeral singleton",
	};
}

const deployed = {
	compatibilityDate: "2026-07-01",
	compatibilityFlags: ["nodejs_compat"],
	unsafeEvalBinding: undefined,
	moduleFallback: false,
	injectedModules: [],
	runnerDurableObject: undefined,
};
const tested = effectiveVitestRuntime(deployed);

const addedFlags = tested.compatibilityFlags.filter(
	(flag) => !deployed.compatibilityFlags.includes(flag)
);
assert(addedFlags.includes("nodejs_compat_v2"));
assert(addedFlags.includes("unsafe_module"));
assert.equal(tested.moduleFallback, true);
assert.deepEqual(tested.injectedModules, ["node:console", "node:vm"]);

console.log(JSON.stringify({ deployed, tested, addedFlags }, null, 2));
console.log(
	"PASS: the test runner intentionally adds runtime capabilities that the deployed Worker config does not declare."
);
