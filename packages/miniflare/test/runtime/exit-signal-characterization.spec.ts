import path from "node:path";
import { Miniflare, MiniflareCoreError } from "miniflare";
import { test } from "vitest";
import { singleModuleManifest } from "../test-shared";

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest(
	"startup failure does not report the workerd exit signal",
	async ({ expect, onTestFinished }) => {
		const originalWorkerdPath = process.env.MINIFLARE_WORKERD_PATH;
		const originalSignal = process.env.MINIFLARE_TEST_WORKERD_SIGNAL;
		process.env.MINIFLARE_WORKERD_PATH = path.join(
			import.meta.dirname,
			"../fixtures/crashing-workerd.mjs"
		);
		process.env.MINIFLARE_TEST_WORKERD_SIGNAL = "SIGTERM";
		onTestFinished(() => {
			if (originalWorkerdPath === undefined) {
				delete process.env.MINIFLARE_WORKERD_PATH;
			} else {
				process.env.MINIFLARE_WORKERD_PATH = originalWorkerdPath;
			}
			if (originalSignal === undefined) {
				delete process.env.MINIFLARE_TEST_WORKERD_SIGNAL;
			} else {
				process.env.MINIFLARE_TEST_WORKERD_SIGNAL = originalSignal;
			}
		});

		const mf = new Miniflare({
			workers: [
				{
					config: {
						type: "worker",
						name: "",
						compatibilityDate: "2025-05-01",
						manifest: singleModuleManifest(""),
					},
				},
			],
		});
		onTestFinished(() => mf.dispose().catch(() => {}));

		let error: unknown;
		try {
			await mf.ready;
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(MiniflareCoreError);
		expect((error as Error).message).toContain("Workers runtime failed to start");
		expect((error as Error).message).toContain("Address not available");
		expect((error as Error).message).not.toContain("SIGTERM");
	}
);
