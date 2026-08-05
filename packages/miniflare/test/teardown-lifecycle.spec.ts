import childProcess from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { Miniflare, ProxyClient } from "miniflare";
import { afterEach, test, vi } from "vitest";
import { WebSocketServer } from "ws";

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

function findKilledWorkerd(
	kill: ReturnType<typeof vi.spyOn>
): childProcess.ChildProcess | undefined {
	for (let index = 0; index < kill.mock.calls.length; index++) {
		const [signal] = kill.mock.calls[index];
		const child = kill.mock.contexts[index];
		if (
			signal === "SIGKILL" &&
			child instanceof childProcess.ChildProcess &&
			path.basename(child.spawnfile).toLowerCase().startsWith("workerd")
		) {
			return child;
		}
	}
}

async function waitForChildExit(child: childProcess.ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	await once(child, "exit");
}

afterEach(() => {
	vi.restoreAllMocks();
});

test("Miniflare: dispose kills workerd after proxy cleanup rejects", async ({
	expect,
}) => {
	const mf = await createReadyMiniflare();
	const proxyDispose = vi
		.spyOn(ProxyClient.prototype, "dispose")
		.mockRejectedValueOnce(new Error("injected proxy cleanup failure"));
	const kill = vi.spyOn(childProcess.ChildProcess.prototype, "kill");

	await expect(mf.dispose()).rejects.toThrow("injected proxy cleanup failure");
	const killedWorkerd = findKilledWorkerd(kill);

	proxyDispose.mockRestore();
	await mf.dispose().catch(() => {});

	expect(killedWorkerd).toBeDefined();
	if (killedWorkerd !== undefined) await waitForChildExit(killedWorkerd);
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
	const killedWorkerdWhileProxyDisposePending =
		findKilledWorkerd(kill) !== undefined;

	releaseProxyDispose();
	proxyDispose.mockRestore();
	await disposePromise;

	expect(killedWorkerdWhileProxyDisposePending).toBe(true);
});

test("Miniflare: cleanup throw after runtime disposal keeps workerd terminated", async ({
	expect,
}) => {
	const mf = await createReadyMiniflare();
	const webSocketClose = vi
		.spyOn(WebSocketServer.prototype, "close")
		.mockImplementationOnce(() => {
			throw new Error("injected WebSocket cleanup failure");
		});
	const kill = vi.spyOn(childProcess.ChildProcess.prototype, "kill");

	await expect(mf.dispose()).rejects.toThrow(
		"injected WebSocket cleanup failure"
	);
	const killedWorkerdDuringFirstDispose = findKilledWorkerd(kill) !== undefined;

	webSocketClose.mockRestore();
	await mf.dispose().catch(() => {});

	expect(killedWorkerdDuringFirstDispose).toBe(true);
});
