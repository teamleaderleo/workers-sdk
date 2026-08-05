from pathlib import Path

index_path = Path("packages/miniflare/src/index.ts")
index_text = index_path.read_text(encoding="utf-8")

old_cleanup = '''\t\t\t// An earlier cleanup failure may prevent the final await. Observe the
\t\t\t// rejection immediately while preserving it for the normal await below.
\t\t\tvoid runtimeDisposePromise.catch(() => {});

\t\t\t// Cleanup as much as possible even if `#init()` threw.
\t\t\tawait this.#closeBrowserProcesses();
\t\t\tawait this.#proxyClient?.dispose();
\t\t\tawait runtimeDisposePromise;
'''

new_cleanup = '''\t\t\t// Attach a rejection handler immediately so a fast runtime failure cannot
\t\t\t// become unhandled while independent cleanup is still pending.
\t\t\tconst runtimeDisposeOutcome = runtimeDisposePromise.then(
\t\t\t\t() => ({ ok: true as const }),
\t\t\t\t(error: unknown) => ({ ok: false as const, error })
\t\t\t);

\t\t\t// Preserve the existing first cleanup error, but do not allow it to make
\t\t\t// the first dispose call return before the owned runtime exit settles.
\t\t\tlet independentCleanupFailed = false;
\t\t\tlet independentCleanupError: unknown;
\t\t\ttry {
\t\t\t\t// Cleanup as much as possible even if `#init()` threw.
\t\t\t\tawait this.#closeBrowserProcesses();
\t\t\t\tawait this.#proxyClient?.dispose();
\t\t\t} catch (error) {
\t\t\t\tindependentCleanupFailed = true;
\t\t\t\tindependentCleanupError = error;
\t\t\t}

\t\t\tconst runtimeCleanupOutcome = await runtimeDisposeOutcome;
\t\t\tif (independentCleanupFailed) throw independentCleanupError;
\t\t\tif (!runtimeCleanupOutcome.ok) throw runtimeCleanupOutcome.error;
'''

if index_text.count(old_cleanup) != 1:
    raise SystemExit(
        f"expected exactly one Miniflare cleanup block, found {index_text.count(old_cleanup)}"
    )
index_path.write_text(index_text.replace(old_cleanup, new_cleanup, 1), encoding="utf-8")

test_path = Path("packages/miniflare/test/teardown-lifecycle.spec.ts")
test_text = test_path.read_text(encoding="utf-8")

first_test_start = test_text.index(
    'test("Miniflare: dispose kills workerd after proxy cleanup rejects"'
)
second_test_start = test_text.index(
    'test("Miniflare: dispose requests workerd termination while proxy cleanup is pending"',
    first_test_start,
)

replacement_test = '''test("Miniflare: dispose waits for workerd exit before returning proxy cleanup failure", async ({
\texpect,
}) => {
\tlet markRuntimeExitObserved!: () => void;
\tlet releaseRuntimeExit!: () => void;
\tconst runtimeExitObserved = new Promise<void>((resolve) => {
\t\tmarkRuntimeExitObserved = resolve;
\t});
\tconst runtimeExitBlocked = new Promise<void>((resolve) => {
\t\treleaseRuntimeExit = resolve;
\t});
\tconst originalEmit = childProcess.ChildProcess.prototype.emit;
\tlet interceptedRuntimeExit = false;
\tconst emit = vi
\t\t.spyOn(childProcess.ChildProcess.prototype, "emit")
\t\t.mockImplementation(function (
\t\t\tthis: childProcess.ChildProcess,
\t\t\tevent: string | symbol,
\t\t\t...args: unknown[]
\t\t) {
\t\t\tif (
\t\t\t\t!interceptedRuntimeExit &&
\t\t\t\tevent === "exit" &&
\t\t\t\tpath.basename(this.spawnfile).toLowerCase().startsWith("workerd")
\t\t\t) {
\t\t\t\tinterceptedRuntimeExit = true;
\t\t\t\tmarkRuntimeExitObserved();
\t\t\t\tvoid runtimeExitBlocked.then(() => {
\t\t\t\t\tReflect.apply(originalEmit, this, [event, ...args]);
\t\t\t\t});
\t\t\t\treturn true;
\t\t\t}
\t\t\treturn Reflect.apply(originalEmit, this, [event, ...args]) as boolean;
\t\t});
\tconst mf = await createReadyMiniflare();
\tconst proxyDispose = vi
\t\t.spyOn(ProxyClient.prototype, "dispose")
\t\t.mockRejectedValueOnce(new Error("injected proxy cleanup failure"));
\tconst kill = vi.spyOn(childProcess.ChildProcess.prototype, "kill");

\tlet firstDisposeSettled = false;
\tconst firstDisposeResult = mf.dispose().then(
\t\t() => {
\t\t\tfirstDisposeSettled = true;
\t\t\treturn undefined;
\t\t},
\t\t(error: unknown) => {
\t\t\tfirstDisposeSettled = true;
\t\t\treturn error;
\t\t}
\t);

\tawait runtimeExitObserved;
\tawait new Promise<void>((resolve) => setImmediate(resolve));
\texpect(firstDisposeSettled).toBe(false);

\tconst killedWorkerd = findKilledWorkerd(kill);
\texpect(killedWorkerd).toBeDefined();
\treleaseRuntimeExit();

\tconst firstDisposeError = await firstDisposeResult;
\texpect(firstDisposeError).toBeInstanceOf(Error);
\texpect((firstDisposeError as Error).message).toContain(
\t\t"injected proxy cleanup failure"
\t);
\tif (killedWorkerd === undefined) {
\t\tthrow new Error("expected workerd to receive SIGKILL");
\t}
\texpect(
\t\tkilledWorkerd.exitCode !== null || killedWorkerd.signalCode !== null
\t).toBe(true);

\temit.mockRestore();
\tproxyDispose.mockRestore();
\tawait mf.dispose().catch(() => {});
});

'''

test_text = test_text[:first_test_start] + replacement_test + test_text[second_test_start:]

old_repeat_cleanup = '''\twebSocketClose.mockRestore();
\tawait mf.dispose().catch(() => {});
'''
new_repeat_cleanup = '''\twebSocketClose.mockRestore();
\tawait expect(mf.dispose()).resolves.toBeUndefined();
'''
if test_text.count(old_repeat_cleanup) != 1:
    raise SystemExit(
        f"expected exactly one WebSocket repeat-dispose cleanup, found {test_text.count(old_repeat_cleanup)}"
    )
test_text = test_text.replace(old_repeat_cleanup, new_repeat_cleanup, 1)
test_path.write_text(test_text, encoding="utf-8")
