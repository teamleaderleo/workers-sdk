import assert from "node:assert";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import registerDevHotKeys from "../../dev/hotkeys";
import { startDev } from "../../dev/start-dev";
import { logger } from "../../logger";
import { requireAuth } from "../../user";
import { mockConsoleMethods } from "../helpers/mock-console";
import type { StartDevWorkerInput } from "../../api";
import type { StartDevOptions } from "../../dev";

const mocks = vi.hoisted(() => {
	const configSet = vi.fn();
	const fakeDevEnv = {
		config: { set: configSet },
		on: vi.fn(),
		proxy: { ready: { promise: new Promise(() => {}) } },
		teardown: vi.fn(),
	};

	return {
		configSet,
		fakeDevEnv,
	};
});

vi.mock("../../api", () => ({
	DevEnv: vi.fn(function () {
		return mocks.fakeDevEnv;
	}),
}));

vi.mock("../../dev/hotkeys", () => ({
	default: vi.fn(),
}));

vi.mock("@cloudflare/workers-utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cloudflare/workers-utils")>()),
	isInteractive: vi.fn(() => true),
	openInBrowser: vi.fn(),
}));

vi.mock("../../user", () => ({
	requireApiToken: vi.fn(() => "test-api-token"),
	requireAuth: vi.fn(async () => "test-account-id"),
}));

const std = mockConsoleMethods();

describe("startDev", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		logger.clearHistory();
		logger.resetLoggerLevel();
		mocks.configSet.mockResolvedValue(undefined);
		mocks.fakeDevEnv.proxy.ready.promise = new Promise(() => {});
	});

	afterEach(() => {
		logger.resetLoggerLevel();
	});

	it("unregisters the latest hotkey registration after auth re-registers hotkeys", async ({
		expect,
	}) => {
		logger.loggerLevel = "error";
		vi.mocked(requireAuth).mockImplementationOnce(async () => {
			logger.debug("sentinel auth hook log");
			return "test-account-id";
		});
		const unregisterHotKeys = [vi.fn(), vi.fn()];
		vi.mocked(registerDevHotKeys)
			.mockReturnValueOnce(unregisterHotKeys[0])
			.mockReturnValueOnce(unregisterHotKeys[1]);

		const result = await startDev({
			disableDevRegistry: true,
			showInteractiveDevSession: true,
			logLevel: "debug",
		} as StartDevOptions);

		expect(registerDevHotKeys).toHaveBeenCalledTimes(1);

		const startWorkerInput = mocks.configSet.mock
			.calls[0][0] as StartDevWorkerInput;
		const auth = startWorkerInput.dev?.auth;
		assert(auth);
		await (auth as (arg: { account_id?: string }) => Promise<unknown>)({});

		expect(requireAuth).toHaveBeenCalledOnce();
		expect(std.debug).toContain("sentinel auth hook log");
		expect(logger.loggerLevel).toBe("error");
		expect(unregisterHotKeys[0]).toHaveBeenCalledOnce();
		expect(registerDevHotKeys).toHaveBeenCalledTimes(2);

		result.unregisterHotKeys?.();

		expect(unregisterHotKeys[0]).toHaveBeenCalledOnce();
		expect(unregisterHotKeys[1]).toHaveBeenCalledOnce();
	});

	it("does not change the singleton logger after failed startup", async ({
		expect,
	}) => {
		logger.loggerLevel = "log";
		mocks.configSet.mockRejectedValueOnce(
			new Error("sentinel startup failure")
		);

		await expect(
			startDev({
				disableDevRegistry: true,
				showInteractiveDevSession: false,
				logLevel: "error",
			} as StartDevOptions)
		).rejects.toThrow("sentinel startup failure");

		expect(logger.loggerLevel).toBe("log");
	});

	it("does not change the singleton logger after session teardown", async ({
		expect,
	}) => {
		logger.loggerLevel = "log";

		const result = await startDev({
			disableDevRegistry: true,
			showInteractiveDevSession: false,
			logLevel: "debug",
		} as StartDevOptions);
		await result.devEnv.teardown();

		expect(logger.loggerLevel).toBe("log");
	});

	it("keeps overlapping startup continuations in their own log scopes", async ({
		expect,
	}) => {
		logger.loggerLevel = "error";
		let releaseFirstSetup: (() => void) | undefined;
		const firstSetup = new Promise<void>((resolve) => {
			releaseFirstSetup = resolve;
		});
		mocks.configSet
			.mockImplementationOnce(async () => {
				await firstSetup;
				logger.debug("sentinel first-session debug log");
			})
			.mockImplementationOnce(async () => {
				logger.debug("sentinel second-session debug log");
			});

		const firstSession = startDev({
			disableDevRegistry: true,
			showInteractiveDevSession: false,
			logLevel: "debug",
		} as StartDevOptions);
		await vi.waitFor(() => {
			expect(mocks.configSet).toHaveBeenCalledTimes(1);
		});

		await startDev({
			disableDevRegistry: true,
			showInteractiveDevSession: false,
			logLevel: "error",
		} as StartDevOptions);
		expect(std.debug).not.toContain("sentinel second-session debug log");

		releaseFirstSetup?.();
		await firstSession;

		expect(std.debug).toContain("sentinel first-session debug log");
		expect(logger.loggerLevel).toBe("error");
	});

	it("retains the session log level for a later ready callback", async ({
		expect,
	}) => {
		logger.loggerLevel = "error";
		let resolveReady: ((value: { url: URL }) => void) | undefined;
		const readyPromise = new Promise<{ url: URL }>((resolve) => {
			resolveReady = resolve;
		});
		mocks.fakeDevEnv.proxy.ready.promise = readyPromise;

		await startDev({
			disableDevRegistry: true,
			showLocalExplorerAgentHint: true,
			logLevel: "log",
		} as StartDevOptions);
		resolveReady?.({ url: new URL("http://127.0.0.1:8787") });
		await readyPromise;
		await Promise.resolve();

		expect(std.out).toContain(
			"Wrangler detected this dev session is running in an AI agent."
		);
		expect(logger.loggerLevel).toBe("error");
	});

	it("prints the Local Explorer API hint when the caller asks for it", async ({
		expect,
	}) => {
		const readyPromise = Promise.resolve({
			url: new URL("http://127.0.0.1:8787"),
		});
		mocks.fakeDevEnv.proxy.ready.promise = readyPromise;

		await startDev({
			disableDevRegistry: true,
			showLocalExplorerAgentHint: true,
		} as StartDevOptions);
		await readyPromise;
		await Promise.resolve();

		expect(std.out).toContain(
			"Wrangler detected this dev session is running in an AI agent."
		);
		expect(std.out).toContain(
			"The Local Explorer API is available at http://127.0.0.1:8787/cdn-cgi/local/explorer/api"
		);
		expect(std.out).toContain(
			"GET http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/workers - local Workers and bindings"
		);
		expect(std.out).toContain(
			"POST http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/observability/query - run a read-only SQL query (SELECT/WITH only) over captured request traces and console logs. Tables: spans, logs (read attributes via json(attributes)). Example:"
		);
		// The query route ships a copy-pasteable example that also documents the request body shape.
		expect(std.out).toContain(
			`curl -X POST http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/observability/query -H 'Content-Type: application/json' -d '{"sql":"SELECT service, name, outcome, duration_ms FROM spans WHERE parent_id IS NULL LIMIT 20"}'`
		);
		// The OpenAPI schema is demoted to a last-resort footer after the functional routes.
		expect(std.out).toContain(
			"fetch the full OpenAPI schema (large - use only as a last resort):"
		);
	});

	it("does not print the Local Explorer API hint when the caller has not opted in", async ({
		expect,
	}) => {
		const readyPromise = Promise.resolve({
			url: new URL("http://127.0.0.1:8787"),
		});
		mocks.fakeDevEnv.proxy.ready.promise = readyPromise;

		await startDev({
			disableDevRegistry: true,
		} as StartDevOptions);
		await readyPromise;
		await Promise.resolve();

		expect(std.out).not.toContain("The Local Explorer API is available");
	});
});
