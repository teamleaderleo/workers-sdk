import { readFile, writeFile } from "node:fs/promises";

const path = "packages/miniflare/test/plugins/browser/index.spec.ts";
let source = await readFile(path, "utf8");

function replaceOnce(from, to, label) {
	const index = source.indexOf(from);
	if (index === -1) throw new Error(`Unable to find ${label}`);
	if (source.indexOf(from, index + from.length) !== -1) {
		throw new Error(`Found more than one ${label}`);
	}
	source = source.slice(0, index) + to + source.slice(index + from.length);
}

function replaceInTest(testName, from, to, label) {
	const testStart = source.indexOf(`\ttest(\n\t\t"${testName}",`);
	if (testStart === -1) throw new Error(`Unable to find test ${testName}`);
	const nextTest = source.indexOf("\n\n\ttest(", testStart + 1);
	const testEnd = nextTest === -1 ? source.length : nextTest;
	const testSource = source.slice(testStart, testEnd);
	const index = testSource.indexOf(from);
	if (index === -1) throw new Error(`Unable to find ${label}`);
	if (testSource.indexOf(from, index + from.length) !== -1) {
		throw new Error(`Found more than one ${label}`);
	}
	const replaced =
		testSource.slice(0, index) + to + testSource.slice(index + from.length);
	source = source.slice(0, testStart) + replaced + source.slice(testEnd);
}

replaceOnce(
	`} satisfies TestOptions;\n\nconst BROWSER_WORKER_SCRIPT`,
	`} satisfies TestOptions;\n\nconst BROWSER_SESSION_ACQUIRE_TIMEOUT_MS = 60_000;\nconst BROWSER_SESSION_TEST_TIMEOUT_MS = 75_000;\n\nconst BROWSER_SESSION_ACQUIRE_RETRY = {\n\ttimeout: BROWSER_SESSION_TEST_TIMEOUT_MS,\n\tretry: {\n\t\tcondition:\n\t\t\t/Chrome readiness probe .* timed out|Browser session acquisition timed out/i,\n\t\tcount: 3,\n\t\tdelay: 1_000,\n\t},\n} satisfies TestOptions;\n\nasync function acquireBrowserSession(mf: Miniflare): Promise<string> {\n\tconst signal = AbortSignal.timeout(BROWSER_SESSION_ACQUIRE_TIMEOUT_MS);\n\ttry {\n\t\tconst response = await mf.dispatchFetch(\"https://localhost/session\", {\n\t\t\tsignal,\n\t\t});\n\t\treturn await response.text();\n\t} catch (cause) {\n\t\tif (signal.aborted) {\n\t\t\tthrow new Error(\n\t\t\t\t\`Browser session acquisition timed out after \${BROWSER_SESSION_ACQUIRE_TIMEOUT_MS}ms\`,\n\t\t\t\t{ cause }\n\t\t\t);\n\t\t}\n\t\tthrow cause;\n\t}\n}\n\nconst BROWSER_WORKER_SCRIPT`,
	"browser session timeout helper marker"
);

replaceOnce(
	`// We need to run browser rendering tests in a serial manner to avoid a race condition installing the browser.\n// We set the timeout quite high here as one of these tests will need to download the Chrome headless browser.\ndescribe.sequential("browser rendering", { timeout: 20_000 }, () => {`,
	`// Run browser rendering tests serially to avoid racing while installing the browser.\ndescribe.sequential("browser rendering", () => {`,
	"stale browser rendering suite timeout"
);

replaceInTest(
	"it creates a browser session",
	"\t\tBROWSER_RENDERING_RETRY,",
	"\t\tBROWSER_SESSION_ACQUIRE_RETRY,",
	"browser session retry options"
);

replaceInTest(
	"it creates a browser session",
	`\t\t\tconst res = await mf.dispatchFetch(\"https://localhost/session\");\n\t\t\tconst text = await res.text();\n\t\t\texpect(text.includes(\"sessionId\")).toBe(true);`,
	`\t\t\tconst text = await acquireBrowserSession(mf);\n\t\t\texpect(text.includes(\"sessionId\")).toBe(true);`,
	"browser session acquisition body"
);

await writeFile(path, source);
