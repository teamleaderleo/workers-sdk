import { initDeployHelpersContext } from "@cloudflare/deploy-helpers";
import {
	confirm,
	fetchResult,
	logger,
} from "@cloudflare/deploy-helpers/context";
import { describe, it, vi } from "vitest";

describe("context singleton", () => {
	// Verifies that both package entry points (. and ./context) share the same
	// context module. This only holds if tsup's splitting is enabled — if it's
	// disabled, each entry bundles its own copy and this test will fail.
	it("init from main entry propagates to context entry", ({ expect }) => {
		const mockLogger = { debug: () => {}, log: () => {} };

		initDeployHelpersContext({
			logger: mockLogger as never,
			fetchResult: (() => {}) as never,
			fetchListResult: (() => {}) as never,
			fetchPagedListResult: (() => {}) as never,
			fetchKVGetValue: (() => {}) as never,
			confirm: (() => {}) as never,
			prompt: (() => {}) as never,
			select: (() => {}) as never,
		});

		expect(logger).toBe(mockLogger);
	});

	it("lets a later initialization replace a pending operation's live context", async ({
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
			accepted: true,
			response: "response-b",
		});
		expect(aFetch).not.toHaveBeenCalled();
		expect(aLog).not.toHaveBeenCalled();
		expect(aConfirm).not.toHaveBeenCalled();
		expect(bFetch).toHaveBeenCalledOnce();
		expect(bLog).toHaveBeenCalledWith("operation-a");
		expect(bConfirm).toHaveBeenCalledOnce();
	});
});
