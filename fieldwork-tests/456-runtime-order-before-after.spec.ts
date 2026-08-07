import childProcess from "node:child_process";
import path from "node:path";
import { Miniflare, ProxyClient } from "miniflare";
import { afterEach, test, vi } from "vitest";

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

afterEach(() => {
	vi.restoreAllMocks();
});

test("Fieldwork 456: show runtime shutdown ordering while proxy cleanup is blocked", async ({
	expect,
}) => {
	const expectKillBeforeRelease =
		process.env.FIELDWORK_EXPECT_KILL_BEFORE_PROXY_RELEASE === "1";

	let workerdChild: childProcess.ChildProcess | undefined;
	const originalEmit = childProcess.ChildProcess.prototype.emit;
	const emit = vi
		.spyOn(childProcess.ChildProcess.prototype, "emit")
		.mockImplementation(function (
			this: childProcess.ChildProcess,
			event: string | symbol,
			...args: unknown[]
		) {
			if (
				workerdChild === undefined &&
				event === "spawn" &&
				path.basename(this.spawnfile).toLowerCase().startsWith("workerd")
			) {
				workerdChild = this;
			}
			return Reflect.apply(originalEmit, this, [event, ...args]) as boolean;
		});
	const kill = vi.spyOn(childProcess.ChildProcess.prototype, "kill");
	const mf = await createReadyMiniflare();

	expect(workerdChild).toBeDefined();

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

	let disposeSettled = false;
	const disposeResult = mf.dispose().then(
		() => {
			disposeSettled = true;
			return undefined;
		},
		(error: unknown) => {
			disposeSettled = true;
			return error;
		}
	);

	let released = false;
	try {
		await proxyDisposeStarted;
		const observedAt = Date.now();
		await new Promise<void>((resolve) => setTimeout(resolve, 1000));

		const killedWorkerd = findKilledWorkerd(kill);
		const killRequested = killedWorkerd !== undefined;
		const childStillAlive =
			workerdChild !== undefined &&
			workerdChild.exitCode === null &&
			workerdChild.signalCode === null;

		console.log(
			`[fieldwork-456] before-release ${JSON.stringify({
				expectKillBeforeRelease,
				observedForMs: Date.now() - observedAt,
				workerdPid: workerdChild?.pid,
				killRequested,
				childStillAlive,
				disposeSettled,
			})}`
		);

		expect(disposeSettled).toBe(false);
		expect(killRequested).toBe(expectKillBeforeRelease);
		if (!expectKillBeforeRelease) {
			expect(childStillAlive).toBe(true);
		}

		releaseProxyDispose();
		released = true;
		const disposeError = await disposeResult;
		expect(disposeError).toBeUndefined();

		console.log(
			`[fieldwork-456] after-release ${JSON.stringify({
				workerdPid: workerdChild?.pid,
				exitCode: workerdChild?.exitCode,
				signalCode: workerdChild?.signalCode,
				disposeSettled,
			})}`
		);
	} finally {
		if (!released) releaseProxyDispose();
		emit.mockRestore();
		proxyDispose.mockRestore();
		await disposeResult;
	}
});
