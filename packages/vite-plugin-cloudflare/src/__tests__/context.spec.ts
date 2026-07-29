import { test, vi } from "vitest";
import { PluginContext } from "../context";
import type { SharedContext } from "../context";
import type { Miniflare } from "miniflare";

function createSharedContext(miniflare: Miniflare): SharedContext {
	return {
		miniflare,
		hasShownWorkerConfigWarnings: false,
		restartingDevServerCount: 0,
		tunnelHostnames: new Set(),
	};
}

test("PluginContext: clears shared Miniflare state when disposal rejects", async ({
	expect,
}) => {
	const disposalError = new Error("injected Miniflare disposal failure");
	const miniflare = {
		dispose: vi.fn().mockRejectedValue(disposalError),
	} as unknown as Miniflare;
	const sharedContext = createSharedContext(miniflare);
	const context = new PluginContext(sharedContext);

	await expect(context.disposeMiniflare()).rejects.toBe(disposalError);

	expect(sharedContext.miniflare).toBeUndefined();
	expect(() => context.miniflare).toThrow("Expected `miniflare` to be defined");
});
