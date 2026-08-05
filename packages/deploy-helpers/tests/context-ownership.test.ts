import { describe, it, vi } from "vitest";
import {
	fetchResult,
	initDeployHelpersContext,
	logger,
} from "../src/shared/context";
import type { DeployHelpersContext } from "../src/shared/types";

function createContext(owner: string): DeployHelpersContext {
	return {
		fetchResult: vi.fn(
			async () => owner
		) as unknown as DeployHelpersContext["fetchResult"],
		fetchListResult: vi.fn(
			async () => []
		) as unknown as DeployHelpersContext["fetchListResult"],
		fetchPagedListResult: vi.fn(
			async () => []
		) as unknown as DeployHelpersContext["fetchPagedListResult"],
		fetchKVGetValue: vi.fn(
			async () => new ArrayBuffer(0)
		) as unknown as DeployHelpersContext["fetchKVGetValue"],
		logger: {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			log: vi.fn(),
			warn: vi.fn(),
		} as unknown as DeployHelpersContext["logger"],
		confirm: vi.fn(async () => true),
		prompt: vi.fn(async () => owner),
		select: vi.fn(
			async () => owner
		) as DeployHelpersContext["select"],
	};
}

describe("deploy helper context ownership", () => {
	it("keeps a pending operation bound to its starting context", async ({
		expect,
	}) => {
		const contextA = createContext("A");
		const contextB = createContext("B");
		let releaseOperation!: () => void;
		const gate = new Promise<void>((resolve) => {
			releaseOperation = resolve;
		});

		initDeployHelpersContext(contextA);
		const pending = (async () => {
			const startingFetch = fetchResult;
			const startingLogger = logger;
			await gate;
			return {
				startingFetch,
				startingLogger,
				resumedFetch: fetchResult,
				resumedLogger: logger,
			};
		})();

		initDeployHelpersContext(contextB);
		releaseOperation();
		const observed = await pending;

		expect(observed.resumedFetch).toBe(observed.startingFetch);
		expect(observed.resumedLogger).toBe(observed.startingLogger);
	});
});
