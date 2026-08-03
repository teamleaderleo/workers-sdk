import {
	getWorkersDevSubdomain,
	initDeployHelpersContext,
} from "@cloudflare/deploy-helpers";
import {
	confirm,
	fetchResult,
	logger,
} from "@cloudflare/deploy-helpers/context";
import { describe, it } from "vitest";

describe("deploy helper operation context", () => {
	it("switches a pending operation to a later initialized context", async ({
		expect,
	}) => {
		const loggerA = { debug: () => {}, log: () => {} };
		const loggerB = { debug: () => {}, log: () => {} };
		const fetchA = () => {};
		const fetchB = () => {};
		const confirmA = () => {};
		const confirmB = () => {};

		const contextA = {
			logger: loggerA as never,
			fetchResult: fetchA as never,
			fetchListResult: (() => {}) as never,
			fetchPagedListResult: (() => {}) as never,
			fetchKVGetValue: (() => {}) as never,
			confirm: confirmA as never,
			prompt: (() => {}) as never,
			select: (() => {}) as never,
		};
		const contextB = {
			logger: loggerB as never,
			fetchResult: fetchB as never,
			fetchListResult: (() => {}) as never,
			fetchPagedListResult: (() => {}) as never,
			fetchKVGetValue: (() => {}) as never,
			confirm: confirmB as never,
			prompt: (() => {}) as never,
			select: (() => {}) as never,
		};

		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		initDeployHelpersContext(contextA);
		const pendingOperation = (async () => {
			const before = { logger, fetchResult, confirm };
			await gate;
			const after = { logger, fetchResult, confirm };
			return { before, after };
		})();

		initDeployHelpersContext(contextB);
		release?.();

		const observed = await pendingOperation;
		expect(observed.before).toEqual({
			logger: loggerA,
			fetchResult: fetchA,
			confirm: confirmA,
		});
		expect(observed.after).toEqual({
			logger: loggerB,
			fetchResult: fetchB,
			confirm: confirmB,
		});
	});

	it(
		"routes a helper's post-await work through the later context",
		async ({ expect }) => {
			const events: string[] = [];
			let rejectFetchA: ((reason?: unknown) => void) | undefined;
			const fetchA = () => {
				events.push("fetch-A");
				return new Promise((_, reject) => {
					rejectFetchA = reject;
				});
			};

			initDeployHelpersContext({
				logger: {
					debug: () => {},
					error: () => {},
					info: () => {},
					log: () => {},
					warn: () => events.push("warn-A"),
				} as never,
				fetchResult: fetchA as never,
				fetchListResult: (() => {}) as never,
				fetchPagedListResult: (() => {}) as never,
				fetchKVGetValue: (() => {}) as never,
				confirm: (async () => {
					events.push("confirm-A");
					return false;
				}) as never,
				prompt: (() => {}) as never,
				select: (() => {}) as never,
			});

			const pendingOperation = getWorkersDevSubdomain({}, "account-A");

			initDeployHelpersContext({
				logger: {
					debug: () => {},
					error: () => {},
					info: () => {},
					log: () => {},
					warn: () => events.push("warn-B"),
				} as never,
				fetchResult: (() => {
					throw new Error("fetch-B should not run");
				}) as never,
				fetchListResult: (() => {}) as never,
				fetchPagedListResult: (() => {}) as never,
				fetchKVGetValue: (() => {}) as never,
				confirm: (async () => {
					events.push("confirm-B");
					return false;
				}) as never,
				prompt: (() => {}) as never,
				select: (() => {}) as never,
			});

			rejectFetchA?.(
				Object.assign(new Error("Subdomain not found"), { code: 10007 })
			);

			await expect(pendingOperation).rejects.toThrow(
				"You can either deploy your worker"
			);
			expect(events).toEqual(["fetch-A", "warn-B", "confirm-B"]);
		}
	);

	it(
		"keeps ownership when the operation captures an explicit context",
		async ({ expect }) => {
			const explicitContext = {
				logger: { owner: "A" },
				fetchResult: { owner: "A" },
				confirm: { owner: "A" },
			};

			let release: (() => void) | undefined;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const pendingOperation = (async (context) => {
				await gate;
				return context;
			})(explicitContext);

			initDeployHelpersContext({
				logger: { debug: () => {}, log: () => {} } as never,
				fetchResult: (() => {}) as never,
				fetchListResult: (() => {}) as never,
				fetchPagedListResult: (() => {}) as never,
				fetchKVGetValue: (() => {}) as never,
				confirm: (() => {}) as never,
				prompt: (() => {}) as never,
				select: (() => {}) as never,
			});
			release?.();

			await expect(pendingOperation).resolves.toBe(explicitContext);
		}
	);
});
