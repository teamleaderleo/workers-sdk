import { EventEmitter } from "node:events";
import {
	getWorkersDevSubdomain,
	initDeployHelpersContext,
} from "@cloudflare/deploy-helpers";
import { logger } from "@cloudflare/deploy-helpers/context";
import { describe, it, vi } from "vitest";

describe("deploy helper async-scope candidate", () => {
	it("keeps a real helper's post-await work on its starting context", async ({
		expect,
	}) => {
		const events: string[] = [];
		let rejectFetchA: ((reason?: unknown) => void) | undefined;

		initDeployHelpersContext({
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
		});

		const pendingOperation = getWorkersDevSubdomain({}, "account-A");

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

	it("does not bind a detached event callback to its registration context", ({
		expect,
	}) => {
		const logA = vi.fn();
		const logB = vi.fn();
		const emitter = new EventEmitter();

		initDeployHelpersContext({
			logger: { debug: vi.fn(), log: logA } as never,
			fetchResult: vi.fn() as never,
			fetchListResult: vi.fn() as never,
			fetchPagedListResult: vi.fn() as never,
			fetchKVGetValue: vi.fn() as never,
			confirm: vi.fn() as never,
			prompt: vi.fn() as never,
			select: vi.fn() as never,
		});
		emitter.on("result", () => logger.log("detached"));

		initDeployHelpersContext({
			logger: { debug: vi.fn(), log: logB } as never,
			fetchResult: vi.fn() as never,
			fetchListResult: vi.fn() as never,
			fetchPagedListResult: vi.fn() as never,
			fetchKVGetValue: vi.fn() as never,
			confirm: vi.fn() as never,
			prompt: vi.fn() as never,
			select: vi.fn() as never,
		});
		emitter.emit("result");

		expect(logA).not.toHaveBeenCalled();
		expect(logB).toHaveBeenCalledWith("detached");
	});
});
