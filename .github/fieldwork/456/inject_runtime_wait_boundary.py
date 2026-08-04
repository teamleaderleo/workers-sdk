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

new_cleanup = '''\t\t\t// Preserve the existing first cleanup error, but do not allow it to make
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

\t\t\tlet runtimeCleanupFailed = false;
\t\t\tlet runtimeCleanupError: unknown;
\t\t\ttry {
\t\t\t\tawait runtimeDisposePromise;
\t\t\t} catch (error) {
\t\t\t\truntimeCleanupFailed = true;
\t\t\t\truntimeCleanupError = error;
\t\t\t}

\t\t\tif (independentCleanupFailed) throw independentCleanupError;
\t\t\tif (runtimeCleanupFailed) throw runtimeCleanupError;
'''

if index_text.count(old_cleanup) != 1:
    raise SystemExit(
        f"expected exactly one Miniflare cleanup block, found {index_text.count(old_cleanup)}"
    )
index_path.write_text(index_text.replace(old_cleanup, new_cleanup, 1), encoding="utf-8")

test_path = Path("packages/miniflare/test/teardown-lifecycle.spec.ts")
test_text = test_path.read_text(encoding="utf-8")

old_import = 'import { Miniflare, ProxyClient } from "miniflare";'
new_import = 'import { Miniflare, ProxyClient, Runtime } from "miniflare";'
if test_text.count(old_import) != 1:
    raise SystemExit(
        f"expected exactly one Miniflare import, found {test_text.count(old_import)}"
    )
test_text = test_text.replace(old_import, new_import, 1)

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
\tconst mf = await createReadyMiniflare();
\tlet markRuntimeDisposeStarted!: () => void;
\tlet releaseRuntimeDispose!: () => void;
\tconst runtimeDisposeStarted = new Promise<void>((resolve) => {
\t\tmarkRuntimeDisposeStarted = resolve;
\t});
\tconst runtimeDisposeBlocked = new Promise<void>((resolve) => {
\t\treleaseRuntimeDispose = resolve;
\t});
\tconst originalRuntimeDispose = Runtime.prototype.dispose;
\tconst runtimeDispose = vi
\t\t.spyOn(Runtime.prototype, "dispose")
\t\t.mockImplementation(function (this: Runtime) {
\t\t\tconst result = originalRuntimeDispose.call(this);
\t\t\tmarkRuntimeDisposeStarted();
\t\t\treturn Promise.resolve(result).then(() => runtimeDisposeBlocked);
\t\t});
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

\tawait runtimeDisposeStarted;
\tawait new Promise<void>((resolve) => setImmediate(resolve));
\texpect(firstDisposeSettled).toBe(false);

\tconst killedWorkerd = findKilledWorkerd(kill);
\texpect(killedWorkerd).toBeDefined();
\treleaseRuntimeDispose();

\tconst firstDisposeError = await firstDisposeResult;
\texpect(firstDisposeError).toBeInstanceOf(Error);
\texpect((firstDisposeError as Error).message).toContain(
\t\t"injected proxy cleanup failure"
\t);
\texpect(
\t\tkilledWorkerd?.exitCode !== null || killedWorkerd?.signalCode !== null
\t).toBe(true);

\truntimeDispose.mockRestore();
\tproxyDispose.mockRestore();
\tawait mf.dispose().catch(() => {});
});

'''

test_text = test_text[:first_test_start] + replacement_test + test_text[second_test_start:]
test_path.write_text(test_text, encoding="utf-8")
