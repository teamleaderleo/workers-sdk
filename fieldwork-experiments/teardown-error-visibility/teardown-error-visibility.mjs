import assert from "node:assert/strict";

async function vitestStop({ miniflareRejects, remoteRejects }) {
	const debug = [];
	const visible = [];
	const disposeMiniflare = async () => {
		if (miniflareRejects) throw new Error("miniflare dispose failed");
	};
	const disposeRemote = async () => {
		if (remoteRejects) throw new Error("remote proxy dispose failed");
	};

	await disposeMiniflare().catch((error) => debug.push(error.message));
	await disposeRemote().catch((error) => debug.push(error.message));
	return { returned: "success", debug, visible };
}

async function viteClose({ miniflareRejects }) {
	const debug = [];
	const visible = [];
	try {
		// Vite's original close succeeds.
	} finally {
		try {
			if (miniflareRejects) throw new Error("miniflare dispose failed");
		} catch (error) {
			debug.push(error.message);
		}
	}
	return { returned: "success", debug, visible };
}

const vitest = await vitestStop({ miniflareRejects: true, remoteRejects: true });
const vite = await viteClose({ miniflareRejects: true });

assert.equal(vitest.returned, "success");
assert.deepEqual(vitest.visible, []);
assert.equal(vitest.debug.length, 2);
assert.equal(vite.returned, "success");
assert.deepEqual(vite.visible, []);
assert.equal(vite.debug.length, 1);

console.table([
	{
		path: "Vitest pool stop()",
		returned: vitest.returned,
		visibleErrors: vitest.visible.length,
		debugErrors: vitest.debug.length,
	},
	{
		path: "Vite server close()",
		returned: vite.returned,
		visibleErrors: vite.visible.length,
		debugErrors: vite.debug.length,
	},
]);
console.log(
	"PASS: disposal failures are retained only in debug output and do not affect the caller-visible result."
);
