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
index_text = index_text.replace(old_cleanup, new_cleanup, 1)

registry_try_anchor = '''\t\t\t// Remove exit hook, we're cleaning up what they would've cleaned up now
\t\t\tthis.#removeExitHook?.();

\t\t\t// Runtime.dispose() requests workerd termination synchronously before
'''
registry_try_replacement = '''\t\t\t// Remove exit hook, we're cleaning up what they would've cleaned up now
\t\t\tthis.#removeExitHook?.();

\t\t\ttry {
\t\t\t\t// Runtime.dispose() requests workerd termination synchronously before
'''
if index_text.count(registry_try_anchor) != 1:
    raise SystemExit(
        f"expected one disposal-registry try anchor, found {index_text.count(registry_try_anchor)}"
    )
index_text = index_text.replace(registry_try_anchor, registry_try_replacement, 1)

registry_tail = '''\t\t\t// Remove from instance registry as last step in `finally`, to make sure
\t\t\t// all dispose steps complete
\t\t\tmaybeInstanceRegistry?.delete(this);
'''
registry_tail_replacement = '''\t\t\t} finally {
\t\t\t\t// A disposal attempt is terminal for instance-registry bookkeeping even
\t\t\t\t// when a cleanup owner reports failure. The caller still receives that
\t\t\t\t// failure, but the instance was not left undisposed by the caller.
\t\t\t\tmaybeInstanceRegistry?.delete(this);
\t\t\t}
'''
if index_text.count(registry_tail) != 1:
    raise SystemExit(
        f"expected one instance-registry tail, found {index_text.count(registry_tail)}"
    )
index_text = index_text.replace(registry_tail, registry_tail_replacement, 1)
index_path.write_text(index_text, encoding="utf-8")

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

\tlet runtimeExitReleased = false;
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

\ttry {
\t\tawait runtimeExitObserved;
\t\tawait new Promise<void>((resolve) => setImmediate(resolve));
\t\texpect(firstDisposeSettled).toBe(false);

\t\tconst killedWorkerd = findKilledWorkerd(kill);
\t\texpect(killedWorkerd).toBeDefined();
\t\treleaseRuntimeExit();
\t\truntimeExitReleased = true;

\t\tconst firstDisposeError = await firstDisposeResult;
\t\texpect(firstDisposeError).toBeInstanceOf(Error);
\t\texpect((firstDisposeError as Error).message).toContain(
\t\t\t"injected proxy cleanup failure"
\t\t);
\t\tif (killedWorkerd === undefined) {
\t\t\tthrow new Error("expected workerd to receive SIGKILL");
\t\t}
\t\texpect(
\t\t\tkilledWorkerd.exitCode !== null || killedWorkerd.signalCode !== null
\t\t).toBe(true);
\t} finally {
\t\tif (!runtimeExitReleased) releaseRuntimeExit();
\t\temit.mockRestore();
\t\tproxyDispose.mockRestore();
\t\tawait firstDisposeResult;
\t\tawait mf.dispose().catch(() => {});
\t}
});

'''

test_text = test_text[:first_test_start] + replacement_test + test_text[second_test_start:]
test_path.write_text(test_text, encoding="utf-8")
