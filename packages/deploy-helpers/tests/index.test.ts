import { initDeployHelpersContext } from "@cloudflare/deploy-helpers";
import {
	confirm,
	fetchResult,
	logger,
} from "@cloudflare/deploy-helpers/context";
import { describe, it, vi } from "vitest";

describe("context routing", () => {
	// Verifies that both package entry points (. and ./context) share the same
	// context module. This only holds if tsup's splitting is enabled — if it's
	// disabled, each entry bundles its own copy and this test will fail.
	it("forwards context-entry calls after initialization from the main entry", ({
		expect,
	}) => {
		const log = vi.fn();

		initDeployHelpersContext({
			logger: { debug: vi.fn(), log } as never,
			fetchResult: (() => {}) as never,
			fetchListResult: (() => {}) as never,
			fetchPagedListResult: (() => {}) as never,
			fetchKVGetValue: (() => {}) as never,
			confirm: (() => {}) as never,
			prompt: (() => {}) as never,
			select: (() => {}) as never,
		});

		logger.log("sentinel");
		expect(log).toHaveBeenCalledWith("sentinel");
	});

	it("retains the context active when an overlapping operation started", async ({
		expect,
	}) => {
		const { promise: operationGate, resolve: releaseOperation } =
			Promise.withResolvers<void>();

		const aLog = vi.fn();
		const aFetch = vi.fn(async () => "response-a");
		const aConfirm = vi.fn(async () => false);
		initDeployHelpersContext({
			logger: { debug: vi.fn(), log: aLog } as never,
			fetchResult: aFetch as never,
			fetchListResult: vi.fn() as never,
			fetchPagedListResult: vi.fn() as never,
			fetchKVGetValue: vi.fn() as never,
			confirm: aConfirm as never,
			prompt: vi.fn() as never,
			select: vi.fn() as never,
		});

		const pendingOperation = (async () => {
			await operationGate;
			const liveFetch = fetchResult as unknown as () => Promise<string>;
			const liveLogger = logger as unknown as {
				log(message: string): void;
			};
			const liveConfirm = confirm as unknown as () => Promise<boolean>;
			const response = await liveFetch();
			liveLogger.log("operation-a");
			const accepted = await liveConfirm();
			return { accepted, response };
		})();

		const bLog = vi.fn();
		const bFetch = vi.fn(async () => "response-b");
		const bConfirm = vi.fn(async () => true);
		initDeployHelpersContext({
			logger: { debug: vi.fn(), log: bLog } as never,
			fetchResult: bFetch as never,
			fetchListResult: vi.fn() as never,
			fetchPagedListResult: vi.fn() as never,
			fetchKVGetValue: vi.fn() as never,
			confirm: bConfirm as never,
			prompt: vi.fn() as never,
			select: vi.fn() as never,
		});

		releaseOperation();

		await expect(pendingOperation).resolves.toEqual({
			accepted: false,
			response: "response-a",
		});
		expect(aFetch).toHaveBeenCalledOnce();
		expect(aLog).toHaveBeenCalledWith("operation-a");
		expect(aConfirm).toHaveBeenCalledOnce();
		expect(bFetch).not.toHaveBeenCalled();
		expect(bLog).not.toHaveBeenCalled();
		expect(bConfirm).not.toHaveBeenCalled();
	});
});
