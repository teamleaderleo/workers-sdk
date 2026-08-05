import { afterEach, beforeEach, describe, it, vi, vitest } from "vitest";
import { DevEnv } from "../../api/startDevWorker/DevEnv";
import registerHotKeys from "../../cli-hotkeys";
import { logger, runWithLogLevel } from "../../logger";
import { mockConsoleMethods } from "../helpers/mock-console";
import type { WranglerStartDevWorkerInput } from "../../api/startDevWorker/types";
import type { Key } from "node:readline";

let keyPressCallback: (key: Key) => void;

vitest.mock("../../utils/onKeyPress", async () => ({
	onKeyPress(callback: (key: Key) => void) {
		keyPressCallback = callback;
		return () => {};
	},
}));

const press = (name: string) =>
	keyPressCallback({
		name,
		sequence: name,
		ctrl: false,
		meta: false,
		shift: false,
	});

describe("dev log-level session scope", () => {
	const std = mockConsoleMethods();

	beforeEach(() => {
		logger.clearHistory();
		logger.resetLoggerLevel();
	});

	afterEach(() => {
		logger.resetLoggerLevel();
	});

	it("runs externally triggered hotkey work in the owner context", async ({
		expect,
	}) => {
		logger.loggerLevel = "error";
		registerHotKeys(
			[
				{
					keys: ["d"],
					handler: async () => {
						await Promise.resolve();
						logger.debug("sentinel hotkey debug log");
					},
				},
			],
			false,
			(callback) => runWithLogLevel("debug", callback)
		);

		press("d");
		await vi.waitFor(() => {
			expect(std.debug).toContain("sentinel hotkey debug log");
		});
		expect(logger.loggerLevel).toBe("error");
	});

	it("keeps hotkey error reporting inside the owner context", async ({
		expect,
	}) => {
		logger.loggerLevel = "debug";
		registerHotKeys(
			[
				{
					keys: ["q"],
					handler: async () => {
						throw new Error("sentinel hotkey failure");
					},
				},
			],
			false,
			(callback) => runWithLogLevel("none", callback)
		);

		press("q");
		await Promise.resolve();
		await Promise.resolve();

		expect(std.err).not.toContain("Error while handling hotkey");
		expect(logger.loggerLevel).toBe("debug");
	});

	it("routes controller events through the owning DevEnv log scope", ({
		expect,
	}) => {
		logger.loggerLevel = "error";
		const devEnv = new DevEnv();
		devEnv.config.latestInput = {
			dev: { logLevel: "debug" },
		} as WranglerStartDevWorkerInput;

		devEnv.dispatch({
			type: "error",
			reason: "Failed to send message to sentinel runtime",
			cause: new Error("sentinel runtime failure"),
			source: "ProxyController",
			data: undefined,
		});

		expect(std.debug).toContain("sentinel runtime failure");
		expect(logger.loggerLevel).toBe("error");
	});
});
