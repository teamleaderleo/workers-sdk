import { EventEmitter } from "node:events";
import {
	getWorkersDevSubdomain,
	initDeployHelpersContext,
	runWithDeployHelpersContext,
} from "@cloudflare/deploy-helpers";
import { logger } from "@cloudflare/deploy-helpers/context";
import { describe, it, vi } from "vitest";

describe("deploy helper operation context", () => {
	it("keeps a real helper on its starting context", async ({ expect }) => {
		const events: string[] = [];
		let rejectFetchA: ((reason?: unknown) => void) | undefined;
		const contextA = {
			logger: {
				debug: vi.fn(),
				error: vi.fn(),
				info: vi.fn(),
				log: vi.fn(),
				warn: () => events.push("warn-A"),
			} as never,
			fetchResult: (() => {
				events.push("fetch-A");
				return new Promise((_, reject) => {
					rejectFetchA = reject;
				});
			}) as never,
			fetchListResult: vi.fn() as never,
			fetchPagedListResult: vi.fn() as never,
			fetchKVGetValue: vi.fn() as never,
			confirm: (async () => {
				events.push("confirm-A");
				return false;
			}) as never,
			prompt: vi.fn() as never,
			select: vi.fn() as never,
		};

		const pendingOperation = runWithDeployHelpersContext(contextA, () =>
			getWorkersDevSubdomain({}, "account-A")
		);

		initDeployHelpersContext({
			logger: {
				debug: vi.fn(),
				error: vi.fn(),
				info: vi.fn(),
				log: vi.fn(),
				warn: () => events.push("warn-B"),
			} as never,
			fetchResult: (() => {
				throw new Error("fetch-B should not run");
			}) as never,
			fetchListResult: vi.fn() as never,
			fetchPagedListResult: vi.fn() as never,
			fetchKVGetValue: vi.fn() as never,
			confirm: (async () => {
				events.push("confirm-B");
				return false;
			}) as never,
			prompt: vi.fn() as never,
			select: vi.fn() as never,
		});

		rejectFetchA?.(
			Object.assign(new Error("Subdomain not found"), { code: 10007 })
		);
		await expect(pendingOperation).rejects.toThrow(
			"You can either deploy your worker"
		);
		expect(events).toEqual(["fetch-A", "warn-A", "confirm-A"]);
	});

	it("restores an outer operation after a nested operation", ({ expect }) => {
		const logA = vi.fn();
		const logB = vi.fn();
		const contextA = {
			logger: { debug: vi.fn(), log: logA } as never,
			fetchResult: vi.fn() as never,
			fetchListResult: vi.fn() as never,
			fetchPagedListResult: vi.fn() as never,
			fetchKVGetValue: vi.fn() as never,
			confirm: vi.fn() as never,
			prompt: vi.fn() as never,
			select: vi.fn() as never,
		};
		const contextB = { ...contextA, logger: { debug: vi.fn(), log: logB } as never };

		runWithDeployHelpersContext(contextA, () => {
			logger.log("outer-before");
			runWithDeployHelpersContext(contextB, () => logger.log("inner"));
			logger.log("outer-after");
		});

		expect(logA.mock.calls).toEqual([["outer-before"], ["outer-after"]]);
		expect(logB).toHaveBeenCalledWith("inner");
	});

	it("uses invocation context for a detached callback", ({ expect }) => {
		const logA = vi.fn();
		const logB = vi.fn();
		const emitter = new EventEmitter();
		const base = {
			fetchResult: vi.fn() as never,
			fetchListResult: vi.fn() as never,
			fetchPagedListResult: vi.fn() as never,
			fetchKVGetValue: vi.fn() as never,
			confirm: vi.fn() as never,
			prompt: vi.fn() as never,
			select: vi.fn() as never,
		};
		const contextA = { ...base, logger: { debug: vi.fn(), log: logA } as never };
		const contextB = { ...base, logger: { debug: vi.fn(), log: logB } as never };

		runWithDeployHelpersContext(contextA, () => {
			emitter.on("result", () => logger.log("detached"));
		});
		runWithDeployHelpersContext(contextB, () => emitter.emit("result"));

		expect(logA).not.toHaveBeenCalled();
		expect(logB).toHaveBeenCalledWith("detached");
	});
});
