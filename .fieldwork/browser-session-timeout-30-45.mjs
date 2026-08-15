import { readFile, writeFile } from "node:fs/promises";

const TEST_PATH = "packages/miniflare/test/plugins/browser/index.spec.ts";
const PLUGIN_PATH = "packages/miniflare/src/plugins/browser-rendering/index.ts";

function replaceOnce(source, from, to, label) {
	const index = source.indexOf(from);
	if (index === -1) throw new Error(`Unable to find ${label}`);
	if (source.indexOf(from, index + from.length) !== -1) {
		throw new Error(`Found more than one ${label}`);
	}
	return source.slice(0, index) + to + source.slice(index + from.length);
}

function replaceInTest(source, testName, from, to, label) {
	const start = source.indexOf(`\ttest(\n\t\t"${testName}",`);
	if (start === -1) throw new Error(`Unable to find test ${testName}`);
	const next = source.indexOf("\n\n\ttest(", start + 1);
	const end = next === -1 ? source.length : next;
	return source.slice(0, start) + replaceOnce(source.slice(start, end), from, to, label) + source.slice(end);
}

async function applyPolicy() {
	let source = await readFile(TEST_PATH, "utf8");
	const marker = "} satisfies TestOptions;\n\nconst BROWSER_WORKER_SCRIPT";
	const helper = `} satisfies TestOptions;\n\nconst BROWSER_SESSION_ACQUIRE_TIMEOUT_MS = Number(\n\tprocess.env.FIELDWORK_BROWSER_REQUEST_TIMEOUT_MS ?? 30_000\n);\nconst BROWSER_SESSION_TEST_TIMEOUT_MS = Number(\n\tprocess.env.FIELDWORK_BROWSER_TEST_TIMEOUT_MS ?? 45_000\n);\n\nconst BROWSER_SESSION_ACQUIRE_RETRY = {\n\ttimeout: BROWSER_SESSION_TEST_TIMEOUT_MS,\n\tretry: {\n\t\tcondition:\n\t\t\t/Chrome readiness probe .* timed out|Browser session acquisition timed out/i,\n\t\tcount: 3,\n\t\tdelay: 1_000,\n\t},\n} satisfies TestOptions;\n\nasync function acquireBrowserSession(mf: Miniflare): Promise<string> {\n\tconst startedAt = performance.now();\n\tconst signal = AbortSignal.timeout(BROWSER_SESSION_ACQUIRE_TIMEOUT_MS);\n\ttry {\n\t\tconst res = await mf.dispatchFetch(\"https://localhost/session\", { signal });\n\t\treturn await res.text();\n\t} catch (cause) {\n\t\tif (signal.aborted) {\n\t\t\tconst elapsedMs = Math.round(performance.now() - startedAt);\n\t\t\tthrow new Error(\n\t\t\t\t\`Browser session acquisition timed out after \${elapsedMs}ms (budget \${BROWSER_SESSION_ACQUIRE_TIMEOUT_MS}ms)\`,\n\t\t\t\t{ cause }\n\t\t\t);\n\t\t}\n\t\tthrow cause;\n\t}\n}\n\nconst BROWSER_WORKER_SCRIPT`;
	source = replaceOnce(source, marker, helper, "timeout helper marker");
	source = replaceInTest(source, "it creates a browser session", "\t\tBROWSER_RENDERING_RETRY,", "\t\tBROWSER_SESSION_ACQUIRE_RETRY,", "test options");
	source = replaceInTest(
		source,
		"it creates a browser session",
		`\t\t\tconst res = await mf.dispatchFetch(\"https://localhost/session\");\n\t\t\tconst text = await res.text();\n\t\t\texpect(text.includes(\"sessionId\")).toBe(true);`,
		`\t\t\tconst text = await acquireBrowserSession(mf);\n\t\t\texpect(text.includes(\"sessionId\")).toBe(true);`,
		"acquisition body"
	);
	await writeFile(TEST_PATH, source);
}

async function applyLaunchFault() {
	let source = await readFile(PLUGIN_PATH, "utf8");
	source = replaceOnce(
		source,
		`}) {\n\tconst platform = detectBrowserPlatform();`,
		`}) {\n\tconst fieldworkLaunchDelayMs = Number(\n\t\tprocess.env.FIELDWORK_BROWSER_LAUNCH_DELAY_MS ?? 0\n\t);\n\tif (fieldworkLaunchDelayMs > 0) {\n\t\tawait new Promise((resolve) => setTimeout(resolve, fieldworkLaunchDelayMs));\n\t}\n\tconst platform = detectBrowserPlatform();`,
		"launchBrowser fault hook"
	);
	await writeFile(PLUGIN_PATH, source);
}

switch (process.argv[2]) {
	case "policy":
		await applyPolicy();
		break;
	case "launch-fault":
		await applyLaunchFault();
		break;
	default:
		throw new Error("Usage: browser-session-timeout-30-45.mjs <policy|launch-fault>");
}
