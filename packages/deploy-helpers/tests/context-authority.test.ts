import { initDeployHelpersContext } from "@cloudflare/deploy-helpers";
import {
	fetchResult,
	logger,
} from "@cloudflare/deploy-helpers/context";
import { describe, it } from "vitest";

describe("operation context authority", () => {
	it("keeps a pending operation on its initiating context", async ({
		expect,
	}) => {
		const events: string[] = [];

		function installContext(owner: "A" | "B") {
			initDeployHelpersContext({
				logger: {
					debug: () => {},
					log: (message: string) => events.push(`${owner}:log:${message}`),
				} as never,
				fetchResult: (async (resource: string) => {
					events.push(`${owner}:fetch:${resource}`);
					return owner;
				}) as never,
				fetchListResult: (() => {}) as never,
				fetchPagedListResult: (() => {}) as never,
				fetchKVGetValue: (() => {}) as never,
				confirm: (() => {}) as never,
				prompt: (() => {}) as never,
				select: (() => {}) as never,
			});
		}

		let releaseOperation: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			releaseOperation = resolve;
		});

		installContext("A");
		const pendingOperation = (async () => {
			logger.log("start");
			await gate;
			const owner = await (
				fetchResult as unknown as (resource: string) => Promise<string>
			)("/operation-a");
			logger.log(`complete:${owner}`);
		})();

		installContext("B");
		releaseOperation?.();
		await pendingOperation;

		expect(events).toEqual([
			"A:log:start",
			"A:fetch:/operation-a",
			"A:log:complete:A",
		]);
	});
});
