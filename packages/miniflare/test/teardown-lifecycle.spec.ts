import childProcess from "node:child_process";
import { Miniflare, ProxyClient } from "miniflare";
import { afterEach, test, vi } from "vitest";
import { DevRegistry } from "../src/shared/dev-registry";

async function createReadyMiniflare(): Promise<Miniflare> {
	const mf = new Miniflare({
		modules: true,
		script: `export default {
			fetch() {
				return new Response("ok");
			}
		}`,
	});
	await mf.ready;
	return mf;
}

afterEach(() => {
	vi.restoreAllMocks();
});

test("Miniflare: dispose kills workerd after proxy cleanup rejects", async ({
	expect,
}) => {
	const mf = await createReadyMiniflare();
	const injectedError = new Error("injected proxy cleanup failure");
	const proxyDispose = vi
		.spyOn(ProxyClient.prototype, "dispose")
		.mockRejectedValueOnce(injectedError);
	const kill = vi.spyOn(childProcess.ChildProcess.prototype, "kill");

	let disposeError: unknown;
	try {
		await mf.dispose();
	} catch (error) {
		disposeError = error;
	}

	const killedDuringFirstDispose = kill.mock.calls.some(
		([signal]) => signal === "SIGKILL"
	);

	// Restore the injected failure before cleanup. On the vulnerable path, the
	// first dispose() returns before Runtime.dispose(), leaving workerd alive.
	// A second call prevents this regression test from hanging its own process.
	proxyDispose.mockRestore();
	if (!killedDuringFirstDispose) {
		await mf.dispose();
	}

	expect(disposeError).toBeDefined();
	expect(killedDuringFirstDispose).toBe(true);
});

test("Miniflare: dispose requests workerd termination while proxy cleanup is pending", async ({
	expect,
}) => {
	const mf = await createReadyMiniflare();
	let markProxyDisposeStarted!: () => void;
	let releaseProxyDispose!: () => void;
	const proxyDisposeStarted = new Promise<void>((resolve) => {
		markProxyDisposeStarted = resolve;
	});
	const proxyDisposeBlocked = new Promise<void>((resolve) => {
		releaseProxyDispose = resolve;
	});
	const proxyDispose = vi
		.spyOn(ProxyClient.prototype, "dispose")
		.mockImplementationOnce(() => {
			markProxyDisposeStarted();
			return proxyDisposeBlocked;
		});
	const kill = vi.spyOn(childProcess.ChildProcess.prototype, "kill");

	const disposePromise = mf.dispose();
	await proxyDisposeStarted;
	const killedWhileProxyDisposePending = kill.mock.calls.some(
		([signal]) => signal === "SIGKILL"
	);

	// Unblock the injected operation before asserting, so the intentionally
	// failing pre-fix case still disposes its real workerd child and exits cleanly.
	releaseProxyDispose();
	proxyDispose.mockRestore();
	await disposePromise;

	expect(killedWhileProxyDisposePending).toBe(true);
});

test("Miniflare: a cleanup rejection after runtime disposal keeps workerd terminated", async ({
	expect,
}) => {
	const mf = await createReadyMiniflare();
	const injectedError = new Error("injected dev registry cleanup failure");
	const registryDispose = vi
		.spyOn(DevRegistry.prototype, "dispose")
		.mockRejectedValueOnce(injectedError);
	const kill = vi.spyOn(childProcess.ChildProcess.prototype, "kill");

	let disposeError: unknown;
	try {
		await mf.dispose();
	} catch (error) {
		disposeError = error;
	}

	const killedDuringFirstDispose = kill.mock.calls.some(
		([signal]) => signal === "SIGKILL"
	);

	registryDispose.mockRestore();
	await mf.dispose().catch(() => {});

	expect(disposeError).toBeDefined();
	expect(killedDuringFirstDispose).toBe(true);
});
