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

test("Miniflare: dispose waits for workerd exit before returning proxy cleanup failure", async ({
	expect,
}) => {
	let markRuntimeExitObserved!: () => void;
	let releaseRuntimeExit!: () => void;
	const runtimeExitObserved = new Promise<void>((resolve) => {
		markRuntimeExitObserved = resolve;
	});
	const runtimeExitBlocked = new Promise<void>((resolve) => {
		releaseRuntimeExit = resolve;
	});
	const originalEmit = childProcess.ChildProcess.prototype.emit;
	let interceptedRuntimeExit = false;
	const emit = vi
		.spyOn(childProcess.ChildProcess.prototype, "emit")
		.mockImplementation(function (
			this: childProcess.ChildProcess,
			event: string | symbol,
			...args: unknown[]
		) {
			if (
				!interceptedRuntimeExit &&
				event === "exit" &&
				path.basename(this.spawnfile).toLowerCase().startsWith("workerd")
			) {
				interceptedRuntimeExit = true;
				markRuntimeExitObserved();
				void runtimeExitBlocked.then(() => {
					Reflect.apply(originalEmit, this, [event, ...args]);
				});
				return true;
			}
			return Reflect.apply(originalEmit, this, [event, ...args]) as boolean;
		});
	const mf = await createReadyMiniflare();
	const proxyDispose = vi
		.spyOn(ProxyClient.prototype, "dispose")
		.mockRejectedValueOnce(new Error("injected proxy cleanup failure"));
	const kill = vi.spyOn(childProcess.ChildProcess.prototype, "kill");

	let runtimeExitReleased = false;
	let firstDisposeSettled = false;
	const firstDisposeResult = mf.dispose().then(
		() => {
			firstDisposeSettled = true;
			return undefined;
		},
		(error: unknown) => {
			firstDisposeSettled = true;
			return error;
		}
	);

	try {
		await runtimeExitObserved;
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(firstDisposeSettled).toBe(false);

		const killedWorkerd = findKilledWorkerd(kill);
		expect(killedWorkerd).toBeDefined();
		releaseRuntimeExit();
		runtimeExitReleased = true;

		const firstDisposeError = await firstDisposeResult;
		expect(firstDisposeError).toBeInstanceOf(Error);
		expect((firstDisposeError as Error).message).toContain(
			"injected proxy cleanup failure"
		);
		if (killedWorkerd === undefined) {
			throw new Error("expected workerd to receive SIGKILL");
		}
		expect(
			killedWorkerd.exitCode !== null || killedWorkerd.signalCode !== null
		).toBe(true);
	} finally {
		if (!runtimeExitReleased) releaseRuntimeExit();
		emit.mockRestore();
		proxyDispose.mockRestore();
		await firstDisposeResult;
		await mf.dispose().catch(() => {});
	}
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
