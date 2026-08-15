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

async function applyTestPolicy() {
	let source = await readFile(TEST_PATH, "utf8");

	source = replaceOnce(
		source,
		"condition: /Chrome readiness probe .* timed out|Test timed out/i,",
		"condition: /Chrome readiness probe .* timed out/i,",
		"Browser Rendering retry condition"
	);

	const marker = "} satisfies TestOptions;\n\nconst BROWSER_WORKER_SCRIPT";
	const helper = `} satisfies TestOptions;\n\nconst BROWSER_RENDERING_REQUEST_TIMEOUT_MS = Number(\n\tprocess.env.FIELDWORK_BROWSER_REQUEST_TIMEOUT_MS ?? 120_000\n);\nconst BROWSER_RENDERING_TEST_TIMEOUT_MS = Number(\n\tprocess.env.FIELDWORK_BROWSER_TEST_TIMEOUT_MS ?? 150_000\n);\n\nasync function dispatchBrowserRequest(\n\tmf: Miniflare,\n\tinput: Parameters<Miniflare[\"dispatchFetch\"]>[0]\n): Promise<Awaited<ReturnType<Miniflare[\"dispatchFetch\"]>>> {\n\tconst startedAt = performance.now();\n\tconst signal = AbortSignal.timeout(BROWSER_RENDERING_REQUEST_TIMEOUT_MS);\n\ttry {\n\t\treturn await mf.dispatchFetch(input, { signal });\n\t} catch (cause) {\n\t\tif (signal.aborted) {\n\t\t\tconst elapsedMs = Math.round(performance.now() - startedAt);\n\t\t\tthrow new Error(\n\t\t\t\t\`Browser Rendering request timed out during dispatch after \${elapsedMs}ms (budget \${BROWSER_RENDERING_REQUEST_TIMEOUT_MS}ms)\`,\n\t\t\t\t{ cause }\n\t\t\t);\n\t\t}\n\t\tthrow cause;\n\t}\n}\n\nconst BROWSER_WORKER_SCRIPT`;
	source = replaceOnce(source, marker, helper, "test timeout helper marker");

	source = replaceOnce(
		source,
		'describe.sequential("browser rendering", { timeout: 20_000 }, () => {',
		'describe.sequential("browser rendering", { timeout: BROWSER_RENDERING_TEST_TIMEOUT_MS }, () => {',
		"Browser Rendering suite timeout"
	);

	const dispatchPattern = "await mf.dispatchFetch(";
	const dispatchCount = source.split(dispatchPattern).length - 1;
	if (dispatchCount === 0) {
		throw new Error("No Browser Rendering dispatchFetch calls found");
	}
	source = source.replaceAll(
		dispatchPattern,
		"await dispatchBrowserRequest(mf, "
	);

	await writeFile(TEST_PATH, source);
	console.log(`Applied test-policy candidate to ${dispatchCount} dispatches.`);
}

async function applyConnectDeadline() {
	let source = await readFile(BINDING_PATH, "utf8");

	source = replaceOnce(
		source,
		`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t}: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}`,
		`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t\tperAttemptTimeoutMs = 5_000,\n\t}: {\n\t\tmaxAttempts?: number;\n\t\tbaseDelayMs?: number;\n\t\tmaxDelayMs?: number;\n\t\tperAttemptTimeoutMs?: number;\n\t} = {}`,
		"fetchWithConnectRetry options"
	);

	source = replaceOnce(
		source,
		`\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\ttry {\n\t\t\treturn await fetch(url, init);\n\t\t} catch (e) {\n\t\t\tlastError = e;\n\t\t\tif (!isRetryableFetchError(e) || attempt === maxAttempts - 1) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}`,
		`\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\tconst timeoutSignal = AbortSignal.timeout(perAttemptTimeoutMs);\n\t\ttry {\n\t\t\treturn await fetch(url, { ...init, signal: timeoutSignal });\n\t\t} catch (e) {\n\t\t\tconst attemptTimedOut = timeoutSignal.aborted;\n\t\t\tlastError = attemptTimedOut\n\t\t\t\t? new Error(\n\t\t\t\t\t\`Timed out connecting to Chrome DevTools after \${perAttemptTimeoutMs}ms (attempt \${attempt + 1}/\${maxAttempts})\`,\n\t\t\t\t\t{ cause: e }\n\t\t\t\t)\n\t\t\t\t: e;\n\t\t\tif (\n\t\t\t\t(!attemptTimedOut && !isRetryableFetchError(e)) ||\n\t\t\t\tattempt === maxAttempts - 1\n\t\t\t) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}`,
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
		await applyTestPolicy();
		break;
	case "connect-deadline":
		await applyConnectDeadline();
		break;
	case "combined":
		await applyTestPolicy();
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
