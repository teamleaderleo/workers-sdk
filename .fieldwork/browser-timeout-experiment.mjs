import { readFile, writeFile } from "node:fs/promises";

const TEST_PATH = "packages/miniflare/test/plugins/browser/index.spec.ts";
const BINDING_PATH =
	"packages/miniflare/src/workers/browser-rendering/binding.worker.ts";
const PLUGIN_PATH =
	"packages/miniflare/src/plugins/browser-rendering/index.ts";

function replaceOnce(source, from, to, label) {
	const index = source.indexOf(from);
	if (index === -1) {
		throw new Error(`Unable to find ${label}`);
	}
	if (source.indexOf(from, index + from.length) !== -1) {
		throw new Error(`Found more than one ${label}`);
	}
	return source.slice(0, index) + to + source.slice(index + from.length);
}

async function applyObservedTestPolicy() {
	let source = await readFile(TEST_PATH, "utf8");

	const marker = "} satisfies TestOptions;\n\nconst BROWSER_WORKER_SCRIPT";
	const helper = `} satisfies TestOptions;\n\nconst BROWSER_SESSION_ACQUIRE_TIMEOUT_MS = Number(\n\tprocess.env.FIELDWORK_BROWSER_REQUEST_TIMEOUT_MS ?? 60_000\n);\nconst BROWSER_SESSION_TEST_TIMEOUT_MS = Number(\n\tprocess.env.FIELDWORK_BROWSER_TEST_TIMEOUT_MS ?? 75_000\n);\n\nconst BROWSER_SESSION_ACQUIRE_RETRY = {\n\ttimeout: BROWSER_SESSION_TEST_TIMEOUT_MS,\n\tretry: {\n\t\tcondition:\n\t\t\t/Chrome readiness probe .* timed out|Browser session acquisition timed out/i,\n\t\tcount: 3,\n\t\tdelay: 1_000,\n\t},\n} satisfies TestOptions;\n\nasync function acquireBrowserSession(mf: Miniflare): Promise<string> {\n\tconst startedAt = performance.now();\n\tconst signal = AbortSignal.timeout(BROWSER_SESSION_ACQUIRE_TIMEOUT_MS);\n\ttry {\n\t\tconst res = await mf.dispatchFetch(\"https://localhost/session\", { signal });\n\t\treturn await res.text();\n\t} catch (cause) {\n\t\tif (signal.aborted) {\n\t\t\tconst elapsedMs = Math.round(performance.now() - startedAt);\n\t\t\tthrow new Error(\n\t\t\t\t\`Browser session acquisition timed out after \${elapsedMs}ms (budget \${BROWSER_SESSION_ACQUIRE_TIMEOUT_MS}ms)\`,\n\t\t\t\t{ cause }\n\t\t\t);\n\t\t}\n\t\tthrow cause;\n\t}\n}\n\nconst BROWSER_WORKER_SCRIPT`;
	source = replaceOnce(source, marker, helper, "test timeout helper marker");

	source = replaceOnce(
		source,
		`\ttest(\n\t\t\"it creates a browser session\",\n\t\tBROWSER_RENDERING_RETRY,`,
		`\ttest(\n\t\t\"it creates a browser session\",\n\t\tBROWSER_SESSION_ACQUIRE_RETRY,`,
		"browser session test retry options"
	);

	source = replaceOnce(
		source,
		`\t\t\tconst res = await mf.dispatchFetch(\"https://localhost/session\");\n\t\t\tconst text = await res.text();\n\t\t\texpect(text.includes(\"sessionId\")).toBe(true);`,
		`\t\t\tconst text = await acquireBrowserSession(mf);\n\t\t\texpect(text.includes(\"sessionId\")).toBe(true);`,
		"browser session acquisition body"
	);

	await writeFile(TEST_PATH, source);
	console.log("Applied observed-test acquisition timeout candidate.");
}

async function applyConnectDeadline() {
	let source = await readFile(BINDING_PATH, "utf8");

	source = replaceOnce(
		source,
		`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t}: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}`,
		`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t\tperAttemptTimeoutMs = 2_000,\n\t}: {\n\t\tmaxAttempts?: number;\n\t\tbaseDelayMs?: number;\n\t\tmaxDelayMs?: number;\n\t\tperAttemptTimeoutMs?: number;\n\t} = {}`,
		"fetchWithConnectRetry options"
	);

	source = replaceOnce(
		source,
		`\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\ttry {\n\t\t\treturn await fetch(url, init);\n\t\t} catch (e) {\n\t\t\tlastError = e;\n\t\t\tif (!isRetryableFetchError(e) || attempt === maxAttempts - 1) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}`,
		`\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\tconst timeoutSignal = AbortSignal.timeout(perAttemptTimeoutMs);\n\t\tconst callerSignal = init?.signal;\n\t\tconst signal = callerSignal\n\t\t\t? AbortSignal.any([callerSignal, timeoutSignal])\n\t\t\t: timeoutSignal;\n\t\ttry {\n\t\t\treturn await fetch(url, { ...init, signal });\n\t\t} catch (e) {\n\t\t\tconst attemptTimedOut =\n\t\t\t\ttimeoutSignal.aborted && !(callerSignal?.aborted ?? false);\n\t\t\tlastError = attemptTimedOut\n\t\t\t\t? new Error(\n\t\t\t\t\t\`Chrome DevTools connection attempt timed out after \${perAttemptTimeoutMs}ms (attempt \${attempt + 1}/\${maxAttempts})\`,\n\t\t\t\t\t{ cause: e }\n\t\t\t\t)\n\t\t\t\t: e;\n\t\t\tif (\n\t\t\t\t(!attemptTimedOut && !isRetryableFetchError(e)) ||\n\t\t\t\tattempt === maxAttempts - 1\n\t\t\t) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}`,
		"fetchWithConnectRetry loop"
	);

	await writeFile(BINDING_PATH, source);
	console.log("Applied BrowserSession connect-deadline candidate.");
}

async function applyFaultInjection() {
	let source = await readFile(PLUGIN_PATH, "utf8");
	const marker = `}) {\n\tconst platform = detectBrowserPlatform();`;
	const replacement = `}) {\n\tconst fieldworkLaunchDelayMs = Number(\n\t\tprocess.env.FIELDWORK_BROWSER_LAUNCH_DELAY_MS ?? 0\n\t);\n\tif (fieldworkLaunchDelayMs > 0) {\n\t\tawait new Promise((resolve) => setTimeout(resolve, fieldworkLaunchDelayMs));\n\t}\n\tconst platform = detectBrowserPlatform();`;
	source = replaceOnce(source, marker, replacement, "launchBrowser fault hook");
	await writeFile(PLUGIN_PATH, source);
	console.log("Applied experiment-only browser launch delay hook.");
}

const command = process.argv[2];
switch (command) {
	case "test-policy":
		await applyObservedTestPolicy();
		break;
	case "connect-deadline":
		await applyConnectDeadline();
		break;
	case "combined":
		await applyObservedTestPolicy();
		await applyConnectDeadline();
		break;
	case "fault-injection":
		await applyFaultInjection();
		break;
	default:
		throw new Error(
			"Usage: node .fieldwork/browser-timeout-experiment.mjs <test-policy|connect-deadline|combined|fault-injection>"
		);
}
