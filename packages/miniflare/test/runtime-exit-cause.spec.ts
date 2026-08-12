import path from "node:path";
import { Miniflare, MiniflareCoreError } from "miniflare";
import { test } from "vitest";
import { FIXTURES_PATH } from "./test-shared";

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest(
	"Miniflare: startup failure loses the workerd exit signal",
	async ({ expect, onTestFinished }) => {
		const originalWorkerdPath = process.env.MINIFLARE_WORKERD_PATH;
		const originalCrashSignal = process.env.MINIFLARE_TEST_CRASH_SIGNAL;
		process.env.MINIFLARE_WORKERD_PATH = path.join(
			FIXTURES_PATH,
			"crashing-workerd.mjs"
		);
		process.env.MINIFLARE_TEST_CRASH_SIGNAL = "SIGTERM";
		onTestFinished(() => {
			if (originalWorkerdPath === undefined) {
				delete process.env.MINIFLARE_WORKERD_PATH;
			} else {
				process.env.MINIFLARE_WORKERD_PATH = originalWorkerdPath;
			}
			if (originalCrashSignal === undefined) {
				delete process.env.MINIFLARE_TEST_CRASH_SIGNAL;
			} else {
				process.env.MINIFLARE_TEST_CRASH_SIGNAL = originalCrashSignal;
			}
		});

		const mf = new Miniflare({ script: "" });
		onTestFinished(() => mf.dispose().catch(() => {}));

		let error: unknown;
		try {
			await mf.ready;
		} catch (cause) {
			error = cause;
		}

		expect(error).toBeInstanceOf(MiniflareCoreError);
		expect((error as Error).message).toContain(
			"There is likely additional logging output above."
		);
		expect((error as Error).message).not.toContain("SIGTERM");
	}
);
